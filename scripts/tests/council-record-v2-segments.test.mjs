import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDnpCouncilRecordV2, DNP_API_BASE, sha256 } from '../lib/dnp-council-record-v2.mjs';
import { buildSegmentsForCouncil } from '../build-segments.mjs';
import { buildCouncilRecordV2Segments } from '../lib/council-record-v2-segments.mjs';

const generatedAt = '2026-09-07T10:00:00.000Z';
function fixture() {
  const municipality = { slug: 'example-town', system: 'dnp', tenant_id: 123 };
  const minute = (minute_id, title, minute_type, text) => ({ minute_id, title, minute_type, text });
  const legacyMinutes = { council_id: 10, name: '令和8年第1回定例会', year: '2026', japanese_year: '令和8年', type_label: '本会議', schedules: [
    { schedule_id: 2, name: '03月02日－01号', page_no: 1, minutes: [
      minute(1, '名簿', '名簿', '名簿原文'), minute(9, '山田議員', '◆質問', '◆山田議員　質問前半。'),
      minute(3, '山田議員', '◆質問', '◆山田議員　質問後半。'), minute(4, '日程第1', '△議題', '△日程第1'),
      minute(6, '山田議員', '◆質問', '◆山田議員　議題後。'), minute(7, '委員長', '◆質問', '報告いたします。'),
      minute(8, '市長', '◎答弁', '◎市長　答弁です。'),
    ] },
    { schedule_id: 5, name: '03月03日－02号', page_no: null, minutes: [minute(1, '山田議員', '◆質問', '◆山田議員　翌日。')] },
  ] };
  function capture(endpoint, schedule, data) {
    const bytes = Buffer.from(JSON.stringify(data));
    return { endpoint, request: { method: 'POST', url: `${DNP_API_BASE}/${endpoint}`, payload: { tenant_id: 123, council_id: 10,
      ...(schedule === undefined ? {} : { schedule_id: schedule }) } }, bytes, content_sha256: sha256(bytes), byte_size: bytes.length,
    observed_at: generatedAt, fetched_at: generatedAt, http_status: 200, mime_type: 'application/json', etag: null, last_modified: null,
    snapshot_path: `fixtures/${sha256(bytes)}.json` };
  }
  const captures = [capture('minutes/get_schedule', undefined, { council_schedules: legacyMinutes.schedules.map(({ minutes, ...s }) => s) }),
    ...legacyMinutes.schedules.map((s) => capture('minutes/get_minute', s.schedule_id, { tenant_minutes: s.minutes.map(({ text, ...m }) => ({ ...m, body: text })) }))];
  const { record, revisionContents } = buildDnpCouncilRecordV2({ municipality, legacyCouncil: legacyMinutes, captures, generatedAt,
    codeRevision: 'abcdef1234', pipelineRunId: 'example-town:run:test' });
  const members = [{ name: '山田 太郎', faction: '会派A' }];
  return { record, options: { municipality, legacyMinutes, members, revisionContents, generatedAt } };
}

test('v2 projection reuses legacy grouping, ID ordinals, procedural classification and source order', () => {
  const { record, options } = fixture();
  const before = JSON.stringify(record);
  const result = buildCouncilRecordV2Segments(record, options);
  const baseline = buildSegmentsForCouncil('example-town', options.legacyMinutes, { members: options.members });
  assert.deepEqual(result.segments, baseline.segments);
  assert.deepEqual(result.indexEntries, baseline.indexEntries);
  assert.equal(result.segments.length, 5);
  assert.deepEqual(result.segments[0].source.minute_ids, [9, 3]);
  assert.equal(result.segments[0].text, '質問前半。\n質問後半。');
  assert.equal(result.segments[1].id, 'example-town-10-2-002');
  assert.equal(result.segments[2].is_procedural, true);
  assert.equal(result.segments[2].speaker_role, '質問');
  assert.equal(result.segments[4].id, 'example-town-10-5-005');
  assert.equal(result.segments[0].member_faction, '会派A');
  assert.deepEqual(result.provenance.input_revision_ids, record.derivation.input_revision_ids);
  assert.equal(result.provenance.public_visible, false);
  assert.equal(result.provenance.question_block_extraction, 'not_implemented');
  assert.equal(JSON.stringify(record), before);
});

test('physical v2 collection order does not alter search IDs or source order', () => {
  const { record, options } = fixture();
  const baseline = buildCouncilRecordV2Segments(record, options);
  record.turns.reverse(); record.document_items.reverse(); record.sittings.reverse();
  const result = buildCouncilRecordV2Segments(record, options);
  assert.deepEqual(result.segments, baseline.segments);
  assert.deepEqual(result.indexEntries, baseline.indexEntries);
});

test('altered legacy input, source bytes, missing evidence and public records fail closed', () => {
  for (const change of [
    ({ options }) => { options.legacyMinutes.schedules[0].minutes[1].text += '変更'; },
    ({ options }) => { options.revisionContents.values().next().value.bytes = Buffer.from('{}'); },
    ({ options }) => { options.revisionContents = undefined; },
    ({ record }) => { record.publication.state = 'public'; record.publication.public_visible = true; },
    ({ options }) => { options.municipality.minutes_access = 'restricted'; },
  ]) {
    const input = fixture(); change(input);
    assert.throws(() => buildCouncilRecordV2Segments(input.record, input.options));
  }
});

test('member input is an explicit hashed dependency while original v2 identity remains unresolved', () => {
  const { record, options } = fixture();
  const first = buildCouncilRecordV2Segments(record, options);
  options.members = [{ name: '山田 太郎', faction: '会派B' }];
  const second = buildCouncilRecordV2Segments(record, options);
  assert.notEqual(first.provenance.members_sha256, second.provenance.members_sha256);
  assert.notEqual(first.provenance.segments_sha256, second.provenance.segments_sha256);
  assert.equal(record.speakers[0].person_id, null);
});
