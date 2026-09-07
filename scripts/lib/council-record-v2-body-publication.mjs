import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateCouncilRecordV2, COUNCIL_RECORD_V2_VALIDATOR_VERSION } from './council-record-v2-validation.mjs';
import { assertCouncilRecordV2CaptureBinding } from './council-record-v2-capture-binding.mjs';
import { assertMinutesV2PreviewValidation } from './council-record-v2-preview.mjs';
import { projectCouncilRecordV2ToMinutes } from './council-record-v2-projection.mjs';

export const BODY_PUBLICATION_VERSION = 'council-record-v2-body-publication.v1';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const jsonHash = (value) => hash(JSON.stringify(value));
function bytes(value, label) {
  assert.ok(Buffer.isBuffer(value) || value instanceof Uint8Array, `${label} must be original bytes`);
  return Buffer.from(value);
}
function timestamp(value, label) {
  assert.ok(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
    && Number.isFinite(Date.parse(value)), `${label} must be an explicit timestamp`);
  return Date.parse(value);
}
function jsonBytes(value, expected, label) {
  const result = bytes(value, label);
  assert.deepEqual(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result)), expected, `${label} differs from its parsed input`);
  return result;
}

// この許可は原文互換JSONだけに適用する。人物同定・質問解釈・v2全体の公開認証には使わない。
export function createCouncilRecordV2BodyPublication({ record, bundle, recordBytes, manifestBytes,
  baselineBytes, indexBytes, approval, freshness, generatedAt }) {
  const generatedTime = timestamp(generatedAt, 'generatedAt');
  const rb = jsonBytes(recordBytes, record, 'recordBytes');
  const mb = jsonBytes(manifestBytes, bundle.manifest, 'manifestBytes');
  const bb = jsonBytes(baselineBytes, bundle.legacyCouncil, 'baselineBytes');
  const ib = bytes(indexBytes, 'indexBytes');
  const index = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(ib));
  assert.ok(Array.isArray(index), 'publication index must be an array');
  assert.equal(record.publication.public_visible, false, 'canonical record must remain private');
  assert.equal(record.publication.state, 'internal_preview', 'canonical review status must remain internal_preview');
  assert.notEqual(bundle.municipality.minutes_access, 'restricted', 'restricted minutes cannot be published');
  const city = record.municipality_id;
  const councilId = bundle.legacyCouncil.council_id;
  assert.match(city, /^[a-z][a-z0-9_-]*$/u);
  assert.ok(Number.isSafeInteger(councilId) && councilId >= 0, 'invalid council ID');
  assert.equal(bundle.manifest.municipality_id, city, 'manifest municipality differs');
  assert.equal(bundle.manifest.council_id, councilId, 'manifest council differs');
  assert.equal(bundle.manifest.legacy_input.sha256, hash(bb), 'baseline bytes differ from capture baseline');
  assert.deepEqual(bundle.captures.map(({ bytes: _bytes, ...capture }) => capture), bundle.manifest.captures,
    'loaded captures differ from capture manifest');
  const matches = index.filter((item) => String(item.council_id) === String(councilId));
  assert.equal(matches.length, 1, 'meeting must appear exactly once in published index');
  assert.equal(matches[0].file, `${councilId}.json`, 'published index file differs from meeting');

  assert.equal(approval?.scope, 'body_only', 'approval must be limited to body_only');
  for (const field of ['approved_by', 'approval_ref']) assert.ok(typeof approval[field] === 'string' && approval[field].trim(), `approval.${field} is required`);
  assert.ok(timestamp(approval.approved_at, 'approved_at') <= generatedTime, 'approval cannot follow publication preparation');
  assert.equal(freshness?.method, 'new_capture_verified', 'a fresh capture verification declaration is required');
  assert.equal(freshness.manifest_sha256, hash(mb), 'freshness declaration belongs to another capture');
  const checkedTime = timestamp(freshness.checked_at, 'freshness.checked_at');
  assert.ok(checkedTime <= generatedTime, 'freshness verification cannot follow preparation');
  for (const capture of bundle.captures) {
    assert.ok(timestamp(capture.fetched_at, 'capture.fetched_at') <= checkedTime, 'freshness verification precedes capture');
    assert.equal(hash(bytes(capture.bytes, 'capture.bytes')), capture.content_sha256, 'capture bytes differ from manifest hash');
  }

  const validation = validateCouncilRecordV2(record, { revisionContents: bundle.revisionContents, municipality: bundle.municipality });
  assertMinutesV2PreviewValidation(validation);
  assert.equal(validation.publicationReady, false, 'body permission must not certify the canonical record');
  assertCouncilRecordV2CaptureBinding(record, bundle);
  const projection = projectCouncilRecordV2ToMinutes(record, { municipality: bundle.municipality,
    publicationIndex: index, generatedAt, mode: 'preview', revisionContents: bundle.revisionContents });
  assert.deepEqual(projection.minutes, bundle.legacyCouncil, 'body projection differs from the existing complete minutes');
  assert.equal(matches[0].content_sha256, jsonHash(projection.minutes), 'published index content hash differs from body projection');
  const revisions = record.source_artifacts.flatMap((source) => source.revisions.map((revision) => {
    const content = bundle.revisionContents.get(revision.id);
    const contentBytes = bytes(content?.bytes, 'revision bytes');
    assert.equal(hash(contentBytes), revision.content_sha256, 'revision bytes differ from source hash');
    return { source_artifact_id: source.id, source_revision_id: revision.id,
      content_sha256: hash(contentBytes), byte_size: contentBytes.length };
  }));
  // 完全一致済みの旧JSON整形を維持し、原文と無関係な大量の差分を避ける。
  const minutesBytes = Buffer.from(bb);
  const publication = {
    schema_version: BODY_PUBLICATION_VERSION,
    municipality_id: city, council_id: String(councilId), record_id: record.record_id,
    scope: 'body_only', state: 'approved', public_visible: true,
    canonical_public_visible: false, generated_at: generatedAt,
    approval: { scope: 'body_only', approved_by: approval.approved_by, approved_at: approval.approved_at, approval_ref: approval.approval_ref },
    freshness: { method: freshness.method, manifest_sha256: freshness.manifest_sha256, checked_at: freshness.checked_at,
      limitation: 'Verification declaration at checked_at only; future source freshness is not certified.' },
    inputs: { record_sha256: hash(rb), manifest_sha256: hash(mb), baseline_sha256: hash(bb), index_sha256: hash(ib),
      index_item_sha256: jsonHash(matches[0]), municipality_sha256: jsonHash(bundle.municipality), revisions },
    output: { file: `${councilId}.json`, sha256: hash(minutesBytes), json_sha256: jsonHash(projection.minutes), byte_size: minutesBytes.length },
    validation: { validator_version: COUNCIL_RECORD_V2_VALIDATOR_VERSION, legacy_equivalence: true,
      errors: [], warnings: [], gate_results: validation.gateResults, canonical_publication_ready: false },
    excluded_scopes: ['person_identity', 'question_blocks', 'topics', 'member_activity', 'canonical_record_publication'],
  };
  return { minutes: projection.minutes, minutesBytes, publication };
}

export function verifyCouncilRecordV2BodyPublication({ publication, minutesBytes, ...inputs }) {
  const expected = createCouncilRecordV2BodyPublication(inputs);
  assert.deepEqual(publication, expected.publication, 'body publication receipt no longer matches its inputs');
  assert.deepEqual(bytes(minutesBytes, 'minutesBytes'), expected.minutesBytes, 'published minutes bytes differ from approved projection');
  return { ok: true, publication: expected.publication };
}
