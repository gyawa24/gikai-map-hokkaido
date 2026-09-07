import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDnpCouncilRecordV2, captureDnpResponse, cleanDnpText, dnpRevisionContent,
  DNP_API_BASE, loadDnpSnapshotBundle, sha256, verifyDnpLegacyParity, writeImmutable } from '../lib/dnp-council-record-v2.mjs';
import { validateCouncilRecordV2 } from '../lib/council-record-v2-validation.mjs';

function fixture() {
  const municipality = { slug: 'sample-town', system: 'dnp', tenant_id: 123 };
  const legacyCouncil = { council_id: 10, name: '令和8年第1回定例会', year: '2026', japanese_year: '令和8年', type_label: '本会議',
    schedules: [{ schedule_id: 2, name: '03月02日－01号', page_no: 1, minutes: [
      { minute_id: 1, title: '名簿', minute_type: '名簿', text: '' },
      { minute_id: 3, title: '議題', minute_type: '△議題', text: '△議題' },
      { minute_id: 9, title: '原文議員', minute_type: '◆質問', text: '◆原文議員　質問です。\n\n　続き。' },
    ] }] };
  const response = { tenant_minutes: legacyCouncil.schedules[0].minutes.map(({ text, ...m }) => ({ ...m, body: `<p>${text}</p>` })) };
  function capture(endpoint, payload, json) {
    const bytes = Buffer.from(JSON.stringify(json));
    return { endpoint, request: { method: 'POST', url: `${DNP_API_BASE}/${endpoint}`, payload },
      bytes, observed_at: '2026-09-07T10:00:00.000Z', fetched_at: '2026-09-07T10:00:01.000Z',
      content_sha256: sha256(bytes), byte_size: bytes.length, mime_type: 'application/json', http_status: 200,
      etag: null, last_modified: null, snapshot_path: `reports/snapshots/${sha256(bytes)}.json` };
  }
  const payload = { tenant_id: 123, council_id: 10 };
  const captures = [capture('minutes/get_schedule', payload, { council_schedules: [{ schedule_id: 2, name: '03月02日－01号', page_no: 1 }] }),
    capture('minutes/get_minute', { ...payload, schedule_id: 2 }, response)];
  return { municipality, legacyCouncil, captures, generatedAt: '2026-09-07T11:00:00.000Z', codeRevision: 'abcdef123456', pipelineRunId: 'sample-town:run:abc' };
}

test('DNP cleanup matches existing scraper whitespace and retains entities and full speaker prefix', () => {
  assert.equal(cleanDnpText('<p>　◆氏名　&amp;\r\n\r\n\r\n  続き　</p>\u0085'), '◆氏名　&amp;\n\n  続き');
  assert.equal(cleanDnpText('\ufeff原文\ufeff'), '\ufeff原文\ufeff');
});

test('registered municipality slugs including underscores survive canonical validation', () => {
  const municipalities = JSON.parse(fs.readFileSync(new URL('../../data/municipalities.json', import.meta.url), 'utf8'));
  const schema = JSON.parse(fs.readFileSync(new URL('../../schemas/council-record.v2.schema.json', import.meta.url), 'utf8'));
  const slugPattern = new RegExp(schema.$defs.municipalityId.pattern);
  assert.ok(municipalities.some((municipality) => municipality.slug.includes('_')));
  for (const municipality of municipalities) assert.match(municipality.slug, slugPattern);
  const input = fixture();
  input.municipality.slug = 'sample_town';
  input.pipelineRunId = 'sample_town:run:abc';
  const { record, revisionContents } = buildDnpCouncilRecordV2(input);
  const validation = validateCouncilRecordV2(record, { revisionContents });
  assert.deepEqual(validation.errors, []);
  assert.deepEqual(validation.warnings, []);
  assert.equal(record.municipality_id, 'sample_town');
});

test('lossless items retain original ID/title/type/text and shared order without fictitious speakers', () => {
  const input = fixture();
  const { record, revisionContents } = buildDnpCouncilRecordV2(input);
  assert.equal(record.turns.length, 1);
  assert.equal(record.document_items.length, 2);
  assert.equal(record.speakers.length, 1);
  assert.equal(record.publication.state, 'internal_preview');
  assert.equal(record.publication.public_visible, false);
  assert.deepEqual(record.question_blocks, []);
  assert.equal(record.document_items[0].text_status, 'empty_in_source');
  assert.equal(Object.hasOwn(record.document_items[0], 'speaker_id'), false);
  const ordered = [...record.turns, ...record.document_items].sort((a, b) => a.order_index - b.order_index);
  assert.deepEqual(ordered.map((item) => ({ minute_id: item.legacy_ids.minute_id, ...item.legacy_presentation, text: item.text_original })), input.legacyCouncil.schedules[0].minutes);
  assert.equal(record.turns[0].id, 'sample-town:turn:dnp:10:2:minute:9');
  assert.equal(record.turns[0].turn_type, 'unknown');
  const rev = record.source_artifacts[1].revisions[0];
  assert.equal(rev.fetched_at, input.captures[1].fetched_at);
  assert.equal(sha256(revisionContents.get(rev.id).text), rev.extracted_text_sha256);
});

test('body, title, order, tenant, and snapshot tampering stop conversion', () => {
  for (const mutate of [
    (x) => { x.legacyCouncil.schedules[0].minutes[2].text += '改変'; },
    (x) => { x.legacyCouncil.schedules[0].minutes[2].title = '別名'; },
    (x) => { x.legacyCouncil.schedules[0].minutes.reverse(); },
    (x) => { x.captures[1].request.payload.tenant_id = 999; },
    (x) => { x.captures[1].bytes = Buffer.from('{}'); },
  ]) {
    const input = fixture(); mutate(input);
    assert.throws(() => buildDnpCouncilRecordV2(input));
  }
});

test('added or duplicate schedules and provider minute IDs fail closed', () => {
  const input = fixture();
  input.legacyCouncil.schedules.push(input.legacyCouncil.schedules[0]);
  assert.throws(() => verifyDnpLegacyParity(input), /Schedule list differs/);
  assert.throws(() => dnpRevisionContent(Buffer.from(JSON.stringify({ tenant_minutes: [
    { minute_id: 2, body: 'one' }, { minute_id: 2, body: 'two' },
  ] }))), /Duplicate provider/);
});

test('provider IDs retain response order when numeric IDs are not ascending', () => {
  const content = dnpRevisionContent(Buffer.from(JSON.stringify({ tenant_minutes: [
    { minute_id: 9, body: '先' }, { minute_id: 3, body: '後' },
  ] })));
  assert.deepEqual(content.providerMinuteIds, ['9', '3']);
  assert.equal(content.text, '["先","後"]');
});

test('capture preserves exact response bytes and real observation times; snapshots cannot be overwritten', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnp-v2-'));
  try {
    const bytes = Buffer.from('{"tenant_minutes":[]}\n');
    const before = Date.now();
    const capture = await captureDnpResponse({ endpoint: 'minutes/get_minute', payload: { tenant_id: 1, council_id: 2, schedule_id: 3 },
      snapshotDir: path.join(dir, 'snapshots'), repoRoot: dir,
      fetchImpl: async (url, options) => {
        assert.equal(url, `${DNP_API_BASE}/minutes/get_minute`);
        assert.equal(options.method, 'POST');
        return new Response(bytes, { status: 200, headers: { 'Content-Type': 'application/json', ETag: 'actual-etag' } });
      } });
    assert.deepEqual(fs.readFileSync(path.join(dir, capture.snapshot_path)), bytes);
    assert.ok(Date.parse(capture.observed_at) >= before);
    assert.ok(Date.parse(capture.fetched_at) <= Date.now());
    assert.equal(capture.etag, 'actual-etag');
    writeImmutable(path.join(dir, capture.snapshot_path), bytes);
    assert.throws(() => writeImmutable(path.join(dir, capture.snapshot_path), 'different'), /Immutable snapshot differs/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('failed HTTP response is retained as evidence and cannot be accepted as successful capture', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnp-v2-'));
  try {
    await assert.rejects(captureDnpResponse({ endpoint: 'minutes/get_schedule', payload: {}, snapshotDir: dir, repoRoot: dir,
      fetchImpl: async () => new Response('unavailable', { status: 503 }) }), (error) => {
      assert.equal(error.capture.http_status, 503);
      assert.equal(fs.readFileSync(path.join(dir, error.capture.snapshot_path), 'utf8'), 'unavailable');
      return true;
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('offline loading uses original capture timestamps and rejects altered legacy input', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnp-v2-'));
  try {
    const input = fixture();
    const legacyPath = 'data/sample-town/minutes/10.json';
    const legacyBytes = Buffer.from(JSON.stringify(input.legacyCouncil));
    writeImmutable(path.join(dir, legacyPath), legacyBytes);
    writeImmutable(path.join(dir, 'data/municipalities.json'), JSON.stringify([input.municipality]));
    for (const capture of input.captures) writeImmutable(path.join(dir, capture.snapshot_path), capture.bytes);
    const manifest = { format: 'dnp-capture-manifest/1', council_id: 10, municipality_id: input.municipality.slug, legacy_input: { path: legacyPath, sha256: sha256(legacyBytes) },
      captures: input.captures.map(({ bytes, ...c }) => c) };
    const manifestPath = path.join(dir, 'manifest.json');
    writeImmutable(manifestPath, JSON.stringify(manifest));
    const loaded = loadDnpSnapshotBundle(manifestPath, dir);
    assert.equal(loaded.captures[0].fetched_at, input.captures[0].fetched_at);
    assert.equal(loaded.revisionContents.size, 2);
    fs.appendFileSync(path.join(dir, legacyPath), '\n');
    assert.throws(() => loadDnpSnapshotBundle(manifestPath, dir), /Legacy input changed/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
