import assert from 'node:assert/strict';

function presentation(entity, required, optional) {
  const fields = {};
  for (const key of required) {
    assert.ok(Object.hasOwn(entity, key), `Missing legacy ${key}`);
    fields[key] = entity[key];
  }
  for (const key of optional) if (Object.hasOwn(entity, key)) fields[key] = entity[key];
  return fields;
}

function assertKnownFields(value, allowed) {
  for (const key of Object.keys(value)) assert.ok(allowed.includes(key), `Unmapped legacy field: ${key}`);
}

/** Whole documents retain legacy containers; this adapter does not infer meeting days or speakers. */
export function buildDocumentCouncilRecordV2({ municipality, legacyCouncil, providerNamespace, sourceArtifacts,
  documents, generatedAt, codeRevision, pipelineRunId }) {
  assert.match(municipality.slug, /^[a-z0-9][a-z0-9_-]*$/);
  assert.notEqual(municipality.minutes_access, 'restricted');
  assert.match(providerNamespace, /^[a-z][a-z0-9_-]*$/);
  assert.ok(Number.isSafeInteger(legacyCouncil.council_id));
  assert.ok(Array.isArray(legacyCouncil.schedules) && legacyCouncil.schedules.length > 0);
  assert.equal(documents.length, legacyCouncil.schedules.length);
  assert.ok(sourceArtifacts.length > 0);
  assertKnownFields(legacyCouncil, ['council_id', 'name', 'year', 'japanese_year', 'type_label', 'schedules', 'source_url']);
  const slug = municipality.slug;
  const councilId = legacyCouncil.council_id;
  const meetingId = `${slug}:meeting:${providerNamespace}:${councilId}`;
  const documentItems = [];
  const providerIds = new Set();
  const extraction = () => ({ method: 'rule_based', confidence: 1, extractor_name: 'document-council-record-v2',
    extractor_version: '1.0.0', pipeline_run_id: pipelineRunId, warnings: ['全文文書の互換変換。発言・議題・会議日を抽出していません。'] });
  const review = () => ({ status: 'auto', reviewed_by: null, reviewed_at: null, notes: ['目次を含む原文資料。内容区分は未確認。'] });
  const sittings = legacyCouncil.schedules.map((schedule, position) => {
    assertKnownFields(schedule, ['schedule_id', 'name', 'page_no', 'date', 'source_url', 'source_fino', 'minutes']);
    const matches = documents.filter((document) => document.legacy_schedule_id === schedule.schedule_id);
    assert.equal(matches.length, 1, 'Each legacy container requires one verified document');
    const document = matches[0];
    const providerId = String(document.provider_document_id);
    assert.match(providerId, /^[A-Za-z0-9][A-Za-z0-9:._~-]*$/);
    assert.ok(!providerIds.has(providerId), 'Provider document ID is duplicated'); providerIds.add(providerId);
    assert.equal(schedule.minutes.length, 1, 'Whole-document adapter requires one minute per legacy container');
    const minute = schedule.minutes[0];
    assertKnownFields(minute, ['minute_id', 'title', 'minute_type', 'text', 'source_url']);
    assert.equal(typeof minute.text, 'string');
    assert.equal(minute.text, document.text, 'Verified source text differs from original');
    assert.ok(Number.isSafeInteger(schedule.schedule_id) && Number.isSafeInteger(minute.minute_id));
    const source = sourceArtifacts.find((artifact) => artifact.id === document.source_artifact_id);
    assert.ok(source && source.current_revision_id === document.source_revision_id, 'Document source revision is not current');
    const sittingId = `${slug}:sitting:${providerNamespace}:${councilId}:document:${providerId}`;
    documentItems.push({ id: `${slug}:document-item:${providerNamespace}:${councilId}:${providerId}`,
      municipality_id: slug, meeting_id: meetingId, sitting_id: sittingId, order_index: 1, kind: 'other',
      text_original: minute.text, text_status: minute.text ? 'present' : 'empty_in_source',
      empty_reason: minute.text ? null : '取得した原典から既存parserが導出した本文は空です。',
      source_span: { source_artifact_id: source.id, source_revision_id: source.current_revision_id,
        document_char_start: 0, document_char_end: document.text.length },
      extraction: extraction(), review: review(),
      legacy_ids: { council_id: councilId, schedule_id: schedule.schedule_id, minute_id: minute.minute_id },
      legacy_presentation: presentation(minute, ['title', 'minute_type'], ['source_url']) });
    return { id: sittingId, municipality_id: slug, meeting_id: meetingId, order_index: position + 1,
      title_original: schedule.name, unit_kind: 'document', date: null, date_status: 'unknown',
      date_note: '既存scheduleは目次を含む文書単位の容器です。見出しから開催日を推定していません。',
      source_artifact_ids: [source.id], external_ids: document.external_ids,
      legacy_ids: { council_id: councilId, schedule_id: schedule.schedule_id },
      legacy_presentation: presentation(schedule, ['name'], ['page_no', 'date', 'source_url', 'source_fino']) };
  });
  return { schema_version: '2.0', record_id: `${slug}:record:${providerNamespace}:${councilId}`,
    municipality_id: slug, record_status: 'official',
    meeting: { id: meetingId, municipality_id: slug, title_original: legacyCouncil.name, kind: 'unknown',
      year: Number(legacyCouncil.year), sequence: null, start_date: null, end_date: null, date_status: 'unknown',
      date_note: '全文文書の互換変換であり、会議開催期間を原典から認定していません。',
      sitting_ids: sittings.map((sitting) => sitting.id), external_ids: { council_id: councilId },
      legacy_ids: { council_id: councilId },
      legacy_presentation: presentation(legacyCouncil, ['name', 'year', 'japanese_year', 'type_label'], ['source_url']) },
    sittings, source_artifacts: sourceArtifacts, speakers: [], turns: [], document_items: documentItems,
    question_blocks: [], topic_blocks: [], topic_snippets: [], reconciliations: [],
    derivation: { pipeline_run_id: pipelineRunId, generated_at: generatedAt, code_revision: codeRevision,
      generator: { name: 'document-council-record-v2', version: '1.0.0' },
      input_revision_ids: sourceArtifacts.map((source) => source.current_revision_id),
      validation: { status: 'fail', checked_at: generatedAt, validator_version: 'pending', errors: ['Validation has not run'], warnings: [] } },
    publication: { state: 'internal_preview', public_visible: false, checked_at: generatedAt, published_at: null,
      gate_results: [{ gate: 'review', status: 'fail', detail: '原文全文の内部互換試験。目次/発言/質問/開催日は未認定。' }] } };
}
