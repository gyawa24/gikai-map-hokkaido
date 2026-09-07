import { createHash } from "node:crypto";
import { validateCouncilRecordV2 } from "./council-record-v2-validation.mjs";

const GENERATOR = { name: "council-record-v2-projection", version: "1.0.0" };

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(`Compatibility projection: ${message}`);
}

function legacyId(entity, key) {
  const value = entity.legacy_ids?.[key];
  assert(Number.isSafeInteger(value), `${entity.id}: legacy ${key} must be a safe integer`);
  return value;
}

function presentation(entity, required, optional = []) {
  const value = entity.legacy_presentation;
  assert(value && typeof value === "object", `${entity.id}: legacy_presentation is required`);
  const result = {};
  for (const key of required) {
    assert(typeof value[key] === "string", `${entity.id}: legacy ${key} must be a string`);
    result[key] = value[key];
  }
  for (const key of optional) {
    if (!Object.hasOwn(value, key)) continue;
    assert(key === "page_no" || key === "source_fino"
      ? (key === "page_no" && value[key] === null) || Number.isSafeInteger(value[key])
      : typeof value[key] === "string", `${entity.id}: invalid legacy ${key}`);
    result[key] = value[key];
  }
  return result;
}

function uniqueOrder(entities, label) {
  const orders = new Set();
  for (const entity of entities) {
    assert(Number.isSafeInteger(entity.order_index) && entity.order_index >= 1, `${label}: invalid order_index`);
    assert(!orders.has(entity.order_index), `${label}: duplicate order_index ${entity.order_index}`);
    orders.add(entity.order_index);
  }
  return [...entities].sort((a, b) => a.order_index - b.order_index);
}

/**
 * Preview projections never authorize publication. Callers must independently verify
 * the schema, source snapshots and current revisions before using the public mode.
 */
export function projectCouncilRecordV2ToMinutes(record, {
  municipality,
  publicationIndex = [],
  generatedAt,
  mode = "preview",
  revisionContents,
  currentRevisionIds,
} = {}) {
  assert(mode === "preview" || mode === "public", "unknown projection mode");
  assert(record?.schema_version === "2.0", "unsupported schema_version");
  assert(record.meeting && Array.isArray(record.sittings) && Array.isArray(record.turns)
    && Array.isArray(record.document_items), "meeting, sittings, turns and document_items are required");
  assert(typeof generatedAt === "string" && Number.isFinite(Date.parse(generatedAt)), "generatedAt is required");
  const meeting = record.meeting;
  const councilId = legacyId(meeting, "council_id");
  const sittings = uniqueOrder(record.sittings, "sittings");
  const sittingIds = new Set(sittings.map((sitting) => sitting.id));
  assert(sittingIds.size === sittings.length, "duplicate sitting id");
  assert(Array.isArray(meeting.sitting_ids) && meeting.sitting_ids.length === sittings.length
    && new Set(meeting.sitting_ids).size === sittings.length
    && meeting.sitting_ids.every((id) => sittingIds.has(id)), "meeting sitting references differ");
  const entities = [
    ...record.turns.map((item) => ({ item, isDocument: false })),
    ...record.document_items.map((item) => ({ item, isDocument: true })),
  ];
  const entityIds = new Set();
  for (const { item, isDocument } of entities) {
    assert(!entityIds.has(item.id), `duplicate item id ${item.id}`);
    entityIds.add(item.id);
    assert(sittingIds.has(item.sitting_id), `${item.id}: missing sitting`);
    assert(item.meeting_id === meeting.id && item.municipality_id === record.municipality_id, `${item.id}: wrong meeting or municipality`);
    assert(typeof item.text_original === "string", `${item.id}: text_original must be a string`);
    if (isDocument) {
      assert(item.text_original === ""
        ? item.text_status === "empty_in_source" && typeof item.empty_reason === "string" && item.empty_reason.length > 0
        : item.text_status === "present" && item.empty_reason === null, `${item.id}: empty source state is inconsistent`);
    } else {
      assert(item.text_original.length > 0, `${item.id}: an empty speech must not be fabricated`);
    }
  }

  const scheduleIds = new Set();
  const minutes = {
    council_id: councilId,
    ...presentation(meeting, ["name", "year", "japanese_year", "type_label"], ["source_url"]),
    schedules: sittings.map((sitting) => {
      assert(sitting.meeting_id === meeting.id && sitting.municipality_id === record.municipality_id, `${sitting.id}: wrong meeting or municipality`);
      const scheduleId = legacyId(sitting, "schedule_id");
      assert(!scheduleIds.has(scheduleId), `duplicate legacy schedule_id ${scheduleId}`);
      scheduleIds.add(scheduleId);
      const items = uniqueOrder(entities.filter(({ item }) => item.sitting_id === sitting.id).map(({ item }) => item), sitting.id);
      const minuteIds = new Set();
      return {
        schedule_id: scheduleId,
        ...presentation(sitting, ["name"], ["page_no", "date", "source_url", "source_fino"]),
        minutes: items.map((item) => {
          const minuteId = legacyId(item, "minute_id");
          assert(!minuteIds.has(minuteId), `${sitting.id}: duplicate legacy minute_id ${minuteId}`);
          minuteIds.add(minuteId);
          return {
            minute_id: minuteId,
            ...presentation(item, ["title", "minute_type"], ["source_url"]),
            text: item.text_original,
          };
        }),
      };
    }),
  };

  const inputIds = record.derivation?.input_revision_ids ?? [];
  const artifacts = record.source_artifacts ?? [];
  const revisions = artifacts.flatMap((artifact) => artifact.revisions.map((revision) => ({
    source_artifact_id: artifact.id,
    source_revision_id: revision.id,
    content_sha256: revision.content_sha256,
  })));
  const provenance = {
    schema_version: "council-record-v2-projection.v1",
    record_id: record.record_id,
    municipality_id: record.municipality_id,
    record_sha256: sha256(record),
    input_revision_ids: [...inputIds],
    input_revisions: revisions.filter((revision) => inputIds.includes(revision.source_revision_id)),
    generated_at: generatedAt,
    generator: { ...GENERATOR },
    minutes_sha256: sha256(minutes),
  };
  const reasons = [];
  const validationResult = mode === "public" ? validateCouncilRecordV2(record, { revisionContents }) : null;
  if (mode === "preview") reasons.push("preview_only");
  if (!municipality || municipality.slug !== record.municipality_id) reasons.push("municipality_not_verified");
  if (municipality?.minutes_access === "restricted") reasons.push("restricted");
  const indexItem = publicationIndex.find((item) => String(item.council_id) === String(councilId));
  if (!indexItem) reasons.push("outside_publication_index");
  else if (indexItem.content_sha256 !== provenance.minutes_sha256) reasons.push("publication_index_hash_not_verified");
  if (!inputIds.length || new Set(inputIds).size !== inputIds.length
    || provenance.input_revisions.length !== inputIds.length
    || artifacts.some((artifact) => !inputIds.includes(artifact.current_revision_id))) reasons.push("stale_source_revision");
  if (!Array.isArray(currentRevisionIds) || new Set(currentRevisionIds).size !== currentRevisionIds.length
    || currentRevisionIds.length !== inputIds.length || inputIds.some((id) => !currentRevisionIds.includes(id))) reasons.push("external_revisions_not_verified");
  if (!validationResult?.ok || !validationResult?.publicationReady) reasons.push("validation_not_publication_ready");
  if (record.publication?.state !== "public" || record.publication?.public_visible !== true) reasons.push("record_not_public");
  const gates = record.publication?.gate_results ?? [];
  if (!gates.length || gates.some((gate) => !["pass", "not_applicable"].includes(gate.status))) reasons.push("publication_gate_failed");
  if (mode === "public") assert(reasons.length === 0, `public mode blocked: ${reasons.join(", ")}`);
  return {
    minutes,
    provenance,
    publication: {
      state: mode === "public" ? "public" : "internal_preview",
      public_visible: mode === "public",
      reason_codes: reasons,
    },
  };
}
