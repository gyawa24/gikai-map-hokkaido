import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deriveGijirokuRevisionContent, loadGijirokuSnapshotBundle } from '../lib/gijiroku-council-record-v2.mjs';
import { buildDocumentCouncilRecordV2 } from '../lib/document-council-record-v2.mjs';
import { projectCouncilRecordV2ToMinutes } from '../lib/council-record-v2-projection.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const timestamp = '2026-09-07T10:00:00.000Z';

test('the same Python parser derives Shift-JIS text, entities, line endings and replacement decoding', () => {
  const bytes = Buffer.concat([Buffer.from('<script>ignore</script><p>'), Buffer.from([0x82, 0xa0]), Buffer.from('</p><br> &amp; <b>text</b>')]);
  const content = deriveGijirokuRevisionContent(bytes, { act: 'ACT203' });
  assert.equal(content.text, 'あ\n\n & text');
  assert.deepEqual(content.bytes, bytes);
  assert.equal(deriveGijirokuRevisionContent(Buffer.from([0x87, 0x40]), { act: 'ACT203' }).text, '\ufffd@');
  assert.throws(() => deriveGijirokuRevisionContent(bytes, { act: 'arbitrary-command' }), /Unsupported/);
});

function documentFixture() {
  const municipality = { slug: 'example', system: 'html_inhouse' };
  const legacyCouncil = { council_id: 5, name: 'meeting', year: '2026', japanese_year: '令和8年', type_label: '本会議',
    schedules: [{ schedule_id: 9, name: '03月02日-目次', page_no: null, date: '', source_fino: 13,
      minutes: [{ minute_id: 1, title: '目次', minute_type: '本会議', text: '文書全文', source_url: 'https://example.test/document' }] }] };
  const sourceArtifacts = [{ id: 'example:source:13', current_revision_id: 'example:source:13:revision:one', revisions: [] }];
  const documents = [{ legacy_schedule_id: 9, provider_document_id: 13, source_artifact_id: sourceArtifacts[0].id,
    source_revision_id: sourceArtifacts[0].current_revision_id, text: '文書全文', external_ids: { fino: 13 } }];
  return { municipality, legacyCouncil, providerNamespace: 'html', sourceArtifacts, documents, generatedAt: timestamp,
    codeRevision: 'abcdef1234', pipelineRunId: 'example:run:document-test' };
}

test('whole document preserves optional fields while inventing no speaker, turn or meeting day', () => {
  const input = documentFixture();
  const record = buildDocumentCouncilRecordV2(input);
  const projection = projectCouncilRecordV2ToMinutes(record, { municipality: input.municipality, generatedAt: timestamp });
  assert.deepEqual(projection.minutes, input.legacyCouncil);
  assert.equal(record.sittings[0].unit_kind, 'document');
  assert.equal(record.sittings[0].date, null);
  assert.equal(record.sittings[0].date_status, 'unknown');
  assert.deepEqual(record.speakers, []);
  assert.deepEqual(record.turns, []);
  assert.deepEqual(record.question_blocks, []);
  assert.equal(record.document_items[0].kind, 'other');
  assert.equal(record.publication.public_visible, false);
});

test('whole-document adapter fails on unmapped fields, changed text and ambiguous document mappings', () => {
  for (const mutate of [
    (x) => { x.legacyCouncil.schedules[0].new_metadata = 'must not disappear'; },
    (x) => { x.documents[0].text = 'different'; },
    (x) => { x.documents.push(x.documents[0]); },
    (x) => { x.municipality.minutes_access = 'restricted'; },
  ]) { const input = documentFixture(); mutate(input); assert.throws(() => buildDocumentCouncilRecordV2(input)); }
});

function manifestFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gijiroku-snapshot-'));
  function save(relative, bytes) { const p = path.join(directory, relative); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, bytes); }
  const municipality = { slug: 'sample', system: 'gijiroku_com' };
  const legacy = { council_id: 5, year: '2026', schedules: [{ schedule_id: 9, name: 'contents',
    minutes: [{ minute_id: 1, minute_type: '本会議', title: 'contents', text: 'Contents\nBody' }] }] };
  const legacyBytes = Buffer.from(JSON.stringify(legacy)); const indexBytes = Buffer.from(JSON.stringify([{ council_id: 5 }]));
  save('data/municipalities.json', JSON.stringify([municipality])); save('data/sample/minutes/5.json', legacyBytes);
  save('site/data/sample/minutes/index.json', indexBytes);
  const parserBytes = fs.readFileSync(path.join(repo, 'scraper/scrape_minutes_gijiroku.py'));
  save('scraper/scrape_minutes_gijiroku.py', parserBytes);
  const definitions = [
    ['list', 'ACT=100&FYY=2026&TYY=2026', `<A onClick="winopen('voiweb.exe?ACT=200&KGNO=5&FINO=13&UNID=u&TITL_SUBT=meeting')">contents</A>`, { kgno: 5, year: 2026 }],
    ['frameset', 'ACT=200&FYY=2026&TYY=2026&KGNO=5&FINO=13&UNID=u', '<frame src="?HUID=7">', { kgno: 5, fino: 13, unid: 'u' }],
    ['body', 'ACT=203&FYY=2026&TYY=2026&FINO=13&HUID=7', '<p>Contents</p>Body', { kgno: 5, fino: 13, unid: 'u', huid: '7' }],
  ];
  const captures = definitions.map(([role, query, html, external_ids]) => {
    const bytes = Buffer.from(html); const snapshot_path = `reports/snapshots/${sha(bytes)}.html`; save(snapshot_path, bytes);
    return { role, request: { method: 'GET', url: `https://sample.gijiroku.com/voices/cgi/voiweb.exe?${query}` }, external_ids,
      encoding: 'shift_jis', observed_at: timestamp, fetched_at: timestamp, http_status: 200, content_sha256: sha(bytes),
      byte_size: bytes.length, snapshot_path, mime_type: 'text/html', etag: null, last_modified: null };
  });
  const manifest = { format: 'gijiroku-capture-manifest/1', status: 'complete', municipality_id: 'sample', council_id: 5,
    legacy_input: { path: 'data/sample/minutes/5.json', sha256: sha(legacyBytes) },
    publication_index: { path: 'site/data/sample/minutes/index.json', sha256: sha(indexBytes) },
    parser: { source_path: 'scraper/scrape_minutes_gijiroku.py', source_sha256: sha(parserBytes) }, captures,
    schedule_sources: [{ legacy_schedule_id: 9, kgno: 5, fino: 13, unid: 'u', huid: '7', list_sha256: captures[0].content_sha256,
      frameset_sha256: captures[1].content_sha256, body_sha256: captures[2].content_sha256 }] };
  const manifestPath = path.join(directory, 'manifest.json'); fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  return { directory, manifestPath, manifest, save };
}

test('offline bundle reconstructs provider inventory and all text from captured bytes', () => {
  const input = manifestFixture();
  try {
    const bundle = loadGijirokuSnapshotBundle(input.manifestPath, input.directory);
    assert.equal(bundle.documents.length, 1);
    assert.equal(bundle.documents[0].mapping.fino, 13);
    assert.equal(bundle.documents[0].body.content.text, 'Contents\nBody');
    assert.equal(bundle.revisionContents.size, 3);
  } finally { fs.rmSync(input.directory, { recursive: true, force: true }); }
});

test('changed public index, original bytes and FINO mappings cannot pass offline replay', () => {
  for (const change of [
    (x) => x.save('site/data/sample/minutes/index.json', '[]'),
    (x) => x.save(x.manifest.captures[2].snapshot_path, 'changed'),
    (x) => { x.manifest.schedule_sources[0].fino = 99; fs.writeFileSync(x.manifestPath, JSON.stringify(x.manifest)); },
  ]) {
    const input = manifestFixture();
    try { change(input); assert.throws(() => loadGijirokuSnapshotBundle(input.manifestPath, input.directory)); }
    finally { fs.rmSync(input.directory, { recursive: true, force: true }); }
  }
});

test('snapshot symlinks cannot escape repository even when their bytes would match', () => {
  const input = manifestFixture(); const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-snapshot-'));
  try {
    const snapshot = path.join(input.directory, input.manifest.captures[0].snapshot_path);
    const external = path.join(outside, 'source.html'); fs.copyFileSync(snapshot, external);
    fs.unlinkSync(snapshot); fs.symlinkSync(external, snapshot);
    assert.throws(() => loadGijirokuSnapshotBundle(input.manifestPath, input.directory), /symlink escapes/);
  } finally { fs.rmSync(input.directory, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});
