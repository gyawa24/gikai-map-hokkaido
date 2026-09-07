import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { buildDnpCouncilRecordV2, DNP_API_BASE } from '../lib/dnp-council-record-v2.mjs';
import { createCouncilRecordV2BodyPublication, verifyCouncilRecordV2BodyPublication } from '../lib/council-record-v2-body-publication.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const encode = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
function fixture() {
  const generatedAt = '2026-09-07T00:00:00Z';
  const municipality = { slug: 'sample-town', system: 'dnp', tenant_id: 1 };
  const schedule = { schedule_id: 2, name: '3月2日（第1号）', page_no: 1 };
  const minute = { minute_id: 4, title: '◆議員（原表記君）', minute_type: '本会議' };
  const legacyCouncil = { council_id: 10, name: '合成検証会議', year: '2026', japanese_year: '令和8年', type_label: '定例会',
    schedules: [{ ...schedule, minutes: [{ ...minute, text: '原文を保持。' }] }] };
  const captures = [
    ['minutes/get_schedule', {}, { council_schedules: [schedule] }],
    ['minutes/get_minute', { schedule_id: 2 }, { tenant_minutes: [{ ...minute, body: '原文を保持。' }] }],
  ].map(([endpoint, payload, data]) => {
    const bytes = Buffer.from(JSON.stringify(data));
    const digest = hash(bytes);
    return { endpoint, request: { method: 'POST', url: `${DNP_API_BASE}/${endpoint}`, payload: { tenant_id: 1, council_id: 10, ...payload } },
      bytes, content_sha256: digest, observed_at: generatedAt, fetched_at: generatedAt, byte_size: bytes.length,
      mime_type: 'application/json', http_status: 200, etag: null, last_modified: null, snapshot_path: `fixtures/${digest}.json` };
  });
  const { record, revisionContents } = buildDnpCouncilRecordV2({ municipality, legacyCouncil, captures, generatedAt,
    codeRevision: 'abcdef123', pipelineRunId: 'sample-town:run:test' });
  const baselineBytes = encode(legacyCouncil);
  const manifest = { format: 'dnp-capture-manifest/1', municipality_id: municipality.slug, council_id: 10,
    legacy_input: { path: 'data/sample-town/minutes/10.json', sha256: hash(baselineBytes) },
    captures: captures.map(({ bytes: _bytes, ...capture }) => capture) };
  const manifestBytes = encode(manifest);
  return { record, recordBytes: encode(record), bundle: { municipality, legacyCouncil, captures, revisionContents, manifest },
    baselineBytes, manifestBytes,
    indexBytes: encode([{ council_id: 10, file: '10.json', content_sha256: hash(JSON.stringify(legacyCouncil)) }]),
    approval: { scope: 'body_only', approved_by: 'fixture-user', approved_at: '2026-09-06T23:59:00Z', approval_ref: 'fixture:explicit-body-approval' },
    freshness: { method: 'new_capture_verified', manifest_sha256: hash(manifestBytes), checked_at: generatedAt }, generatedAt };
}

function refresh(input) {
  input.recordBytes = encode(input.record);
  input.manifestBytes = encode(input.bundle.manifest);
  input.freshness.manifest_sha256 = hash(input.manifestBytes);
}

test('body-only permission preserves bytes and unresolved canonical observations without mutation', () => {
  const input = fixture();
  const before = JSON.stringify(input.record);
  const output = createCouncilRecordV2BodyPublication(input);
  assert.deepEqual(output.minutesBytes, input.baselineBytes);
  assert.deepEqual(output.minutes, input.bundle.legacyCouncil);
  assert.equal(JSON.stringify(input.record), before);
  assert.equal(input.record.publication.public_visible, false);
  assert.deepEqual(input.record.question_blocks, []);
  assert.ok(input.record.speakers.every((speaker) => speaker.person_id === null));
  assert.equal(output.publication.canonical_public_visible, false);
  assert.equal(output.publication.scope, 'body_only');
  assert.equal(output.publication.validation.canonical_publication_ready, false);
  assert.equal(verifyCouncilRecordV2BodyPublication({ ...input, ...output }).ok, true);
});

test('approval scope and capture-time declarations are explicit and bound to the manifest', () => {
  for (const mutate of [
    (x) => { x.approval.scope = 'full_record'; },
    (x) => { x.approval.approval_ref = ''; },
    (x) => { x.approval.approved_at = '2026-09-08T00:00:00Z'; },
    (x) => { x.freshness.manifest_sha256 = '0'.repeat(64); },
    (x) => { x.freshness.checked_at = '2026-09-06T00:00:00Z'; },
    (x) => { x.freshness.checked_at = '2026-09-08T00:00:00Z'; },
  ]) { const input = fixture(); mutate(input); assert.throws(() => createCouncilRecordV2BodyPublication(input)); }
});

test('unlisted, duplicate, wrong-file, wrong-content and restricted meetings cannot receive body permission', () => {
  for (const mutate of [
    (x) => { x.indexBytes = encode([]); },
    (x) => { const item = JSON.parse(x.indexBytes)[0]; x.indexBytes = encode([item, item]); },
    (x) => { const items = JSON.parse(x.indexBytes); items[0].file = '11.json'; x.indexBytes = encode(items); },
    (x) => { const items = JSON.parse(x.indexBytes); items[0].content_sha256 = '0'.repeat(64); x.indexBytes = encode(items); },
    (x) => { x.bundle.municipality.minutes_access = 'restricted'; },
  ]) { const input = fixture(); mutate(input); assert.throws(() => createCouncilRecordV2BodyPublication(input)); }
});

test('source and serialized-input tampering cannot pass through caller-supplied parsed objects', () => {
  for (const mutate of [
    (x) => { x.recordBytes = encode({ ...x.record, municipality_id: 'other-town' }); },
    (x) => { x.manifestBytes = encode({ ...x.bundle.manifest, council_id: 11 }); },
    (x) => { x.baselineBytes = encode({ ...x.bundle.legacyCouncil, name: '別の会議' }); },
    (x) => { x.bundle.captures[0].bytes = Buffer.from('{}'); },
    (x) => { x.bundle.captures[0].request.url = 'https://example.test/other'; refresh(x); },
    (x) => { x.record.turns[0].text_original = '原典にない本文'; refresh(x); },
    (x) => { x.record.publication.public_visible = true; refresh(x); },
    (x) => { x.bundle.revisionContents.get(x.record.source_artifacts[1].current_revision_id).bytes = Buffer.from('{}'); },
  ]) { const input = fixture(); mutate(input); assert.throws(() => createCouncilRecordV2BodyPublication(input)); }
});

test('receipt re-verification detects modified output, evidence, scope and current index', () => {
  const input = fixture();
  const output = createCouncilRecordV2BodyPublication(input);
  for (const mutate of [
    (x) => { x.minutesBytes = Buffer.from('{}'); },
    (x) => { x.publication.scope = 'full_record'; },
    (x) => { x.publication.inputs.revisions = []; },
    (x) => { x.publication.validation.warnings = ['unverified']; },
    (x) => { x.indexBytes = encode([...JSON.parse(input.indexBytes), { council_id: 20, file: '20.json' }]); },
  ]) {
    const x = { ...input, minutesBytes: output.minutesBytes, publication: structuredClone(output.publication) };
    mutate(x);
    assert.throws(() => verifyCouncilRecordV2BodyPublication(x));
  }
});
