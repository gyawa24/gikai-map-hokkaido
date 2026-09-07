import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gijirokuSourceId } from './gijiroku-council-record-v2.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');

// 本文の完全一致だけでは検知できない、原典URLや取得時刻の差替えを止める。
export function assertCouncilRecordV2CaptureBinding(record, bundle) {
  const { municipality, legacyCouncil, captures, revisionContents, manifest } = bundle;
  assert.equal(record.municipality_id, municipality.slug, 'Record municipality differs from capture registry');
  assert.equal(record.meeting.legacy_ids.council_id, legacyCouncil.council_id, 'Record meeting differs from capture');
  assert.equal(record.source_artifacts.length, captures.length, 'Record source inventory differs from capture');
  const bound = new Set();
  for (const capture of captures) {
    let sourceId, externalIds, title, landingUrl;
    if (manifest.format === 'dnp-capture-manifest/1') {
      const sid = capture.request.payload.schedule_id;
      sourceId = `${municipality.slug}:source:dnp:${legacyCouncil.council_id}:${sid ?? 'schedules'}`;
      externalIds = { tenant_id: municipality.tenant_id, council_id: legacyCouncil.council_id,
        ...(sid === undefined ? {} : { schedule_id: sid }) };
      title = sid === undefined ? legacyCouncil.name : legacyCouncil.schedules.find((sitting) => sitting.schedule_id === sid)?.name;
      landingUrl = null;
    } else if (manifest.format === 'gijiroku-capture-manifest/1') {
      sourceId = gijirokuSourceId(municipality.slug, legacyCouncil.council_id, capture);
      externalIds = { provider: 'gijiroku_com', act: capture.act, ...capture.external_ids };
      const document = bundle.documents.find((item) => item.mapping.fino === capture.external_ids.fino);
      title = document?.schedule.name || legacyCouncil.name;
      landingUrl = document?.frame.request.url || capture.request.url;
    } else throw new Error(`Unsupported capture manifest: ${manifest.format}`);
    assert.ok(!bound.has(sourceId), 'Capture source identity is duplicated');
    bound.add(sourceId);
    const sources = record.source_artifacts.filter((source) => source.id === sourceId);
    assert.equal(sources.length, 1, 'Captured source must appear exactly once in record');
    const source = sources[0];
    assert.equal(source.content_url, capture.request.url, 'Record source URL differs from captured request');
    assert.equal(source.landing_url, landingUrl, 'Record landing URL differs from captured source');
    assert.equal(source.title, title, 'Record source title differs from capture input');
    assert.deepEqual(source.external_ids, externalIds, 'Record provider IDs differ from capture');
    assert.equal(source.kind, manifest.format === 'dnp-capture-manifest/1' ? 'api_json' : 'html');
    assert.equal(source.authority, 'official');
    assert.equal(source.record_status, 'official');
    assert.equal(source.revisions.length, 1, 'Pilot source requires its captured revision only');
    const revision = source.revisions[0];
    const revisionId = `${sourceId}:revision:${capture.content_sha256}`;
    assert.equal(source.current_revision_id, revisionId, 'Record current revision differs from capture');
    assert.equal(revision.id, revisionId, 'Record revision identity differs from capture');
    assert.equal(revision.retrieval_status, 'fetched');
    assert.equal(revision.parse_status, 'parsed');
    for (const field of ['observed_at', 'fetched_at', 'content_sha256', 'byte_size', 'mime_type',
      'http_status', 'etag', 'last_modified', 'snapshot_path']) {
      assert.equal(revision[field], capture[field], `Record revision ${field} differs from capture`);
    }
    const content = revisionContents.get(revisionId);
    assert.ok(content, 'Capture revision content is missing');
    assert.equal(revision.extracted_text_sha256, content.text === null ? null : hash(content.text), 'Record extracted text hash differs from capture');
  }
}
