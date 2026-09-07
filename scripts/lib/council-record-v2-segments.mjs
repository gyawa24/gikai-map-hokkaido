import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildSegmentsForCouncil } from '../build-segments.mjs';
import { projectCouncilRecordV2ToMinutes } from './council-record-v2-projection.mjs';
import { validateCouncilRecordV2 } from './council-record-v2-validation.mjs';
import { assertMinutesV2PreviewValidation } from './council-record-v2-preview.mjs';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function buildCouncilRecordV2Segments(record, { municipality, legacyMinutes, members = [], revisionContents, generatedAt } = {}) {
  assert.equal(record?.publication?.state, 'internal_preview', 'segments trial requires an internal_preview record');
  assert.equal(record.publication.public_visible, false, 'segments trial cannot publish records');
  assert.equal(municipality?.slug, record.municipality_id, 'municipality differs from the record');
  assert.notEqual(municipality.minutes_access, 'restricted', 'restricted municipality is outside this trial');
  assert.ok(Array.isArray(members), 'members must be an array');
  const validation = validateCouncilRecordV2(record, { revisionContents });
  assertMinutesV2PreviewValidation(validation);
  const projection = projectCouncilRecordV2ToMinutes(record, { municipality, generatedAt, mode: 'preview' });
  assert.deepEqual(projection.minutes, legacyMinutes, 'v2 compatibility minutes differ from legacy input');
  const projected = buildSegmentsForCouncil(record.municipality_id, projection.minutes, { members });
  const baseline = buildSegmentsForCouncil(record.municipality_id, legacyMinutes, { members });
  assert.deepEqual(projected, baseline, 'v2 segments differ from legacy conversion');
  return {
    segments: projected.segments,
    indexEntries: projected.indexEntries,
    provenance: {
      ...projection.provenance,
      schema_version: 'council-record-v2-segments-preview.v1',
      generator: { name: 'council-record-v2-segments', version: '1.0.0' },
      projection_generator: projection.provenance.generator,
      segments_sha256: hash(projected.segments),
      index_sha256: hash(projected.indexEntries),
      members_sha256: hash(members),
      original_records: legacyMinutes.schedules.reduce((count, sitting) => count + sitting.minutes.length, 0),
      segment_count: projected.segments.length,
      matched_member_count: projected.matchedMemberCount,
      legacy_equivalence: true,
      state: 'internal_preview',
      public_visible: false,
      question_block_extraction: 'not_implemented',
      classification_note: '既存segmentsの検索分類を維持。質問というラベルは一般質問やQuestionBlockの認定を意味しません。',
    },
    validation,
  };
}
