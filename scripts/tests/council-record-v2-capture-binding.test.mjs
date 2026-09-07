import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { buildDnpCouncilRecordV2, DNP_API_BASE } from '../lib/dnp-council-record-v2.mjs';
import { assertCouncilRecordV2CaptureBinding } from '../lib/council-record-v2-capture-binding.mjs';

function fixture() {
  const generatedAt = '2026-09-07T00:00:00Z';
  const municipality = { slug: 'sample-town', system: 'dnp', tenant_id: 1 };
  const schedule = { schedule_id: 2, name: '3月2日（第1号）', page_no: 1 };
  const minute = { minute_id: 4, title: '原文の見出し', minute_type: '本会議' };
  const legacyCouncil = { council_id: 10, name: '合成検証会議', year: '2026', japanese_year: '令和8年', type_label: '定例会',
    schedules: [{ ...schedule, minutes: [{ ...minute, text: '原文を保持。' }] }] };
  const captures = [
    ['minutes/get_schedule', {}, { council_schedules: [schedule] }],
    ['minutes/get_minute', { schedule_id: 2 }, { tenant_minutes: [{ ...minute, body: '原文を保持。' }] }],
  ].map(([endpoint, payload, data]) => {
    const bytes = Buffer.from(JSON.stringify(data));
    const digest = createHash('sha256').update(bytes).digest('hex');
    return { endpoint, request: { method: 'POST', url: `${DNP_API_BASE}/${endpoint}`, payload: { tenant_id: 1, council_id: 10, ...payload } },
      bytes, content_sha256: digest, observed_at: generatedAt, fetched_at: generatedAt, byte_size: bytes.length,
      mime_type: 'application/json', http_status: 200, etag: null, last_modified: null, snapshot_path: `fixtures/${digest}.json` };
  });
  const { record, revisionContents } = buildDnpCouncilRecordV2({ municipality, legacyCouncil, captures, generatedAt,
    codeRevision: 'abcdef123', pipelineRunId: 'sample-town:run:test' });
  return { record, bundle: { municipality, legacyCouncil, captures, revisionContents, manifest: { format: 'dnp-capture-manifest/1' } } };
}

test('captured request and observation metadata stay attached to unchanged original text', () => {
  const { record, bundle } = fixture();
  assertCouncilRecordV2CaptureBinding(record, bundle);
  for (const mutate of [
    (value) => { value.source_artifacts[0].content_url = 'https://example.test/wrong'; },
    (value) => { value.source_artifacts[0].landing_url = 'https://example.test/wrong'; },
    (value) => { value.source_artifacts[0].external_ids.tenant_id = 999; },
    (value) => { value.source_artifacts[0].title = '別の原典'; },
    (value) => { value.source_artifacts[0].revisions[0].observed_at = '2026-09-06T00:00:00Z'; },
    (value) => { value.source_artifacts[0].revisions[0].snapshot_path = 'fixtures/another.json'; },
    (value) => { value.source_artifacts[0].revisions[0].http_status = 201; },
    (value) => { value.source_artifacts[0].current_revision_id += ':other'; },
    (value) => { value.source_artifacts[1] = structuredClone(value.source_artifacts[0]); },
  ]) {
    const changed = structuredClone(record);
    mutate(changed);
    assert.deepEqual(changed.document_items, record.document_items);
    assert.throws(() => assertCouncilRecordV2CaptureBinding(changed, bundle));
  }
});
