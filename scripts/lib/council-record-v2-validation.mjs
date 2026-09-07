import fs from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dnpRevisionContent } from "./dnp-council-record-v2.mjs";
import { deriveGijirokuRevisionContent } from "./gijiroku-council-record-v2.mjs";

const requireSite = createRequire(new URL("../../site/package.json", import.meta.url));
const Ajv2020 = requireSite("ajv/dist/2020.js").default;
const addFormats = requireSite("ajv-formats");
const defaultSchema = JSON.parse(fs.readFileSync(new URL("../../schemas/council-record.v2.schema.json", import.meta.url), "utf8"));
const validators = new WeakMap();
const GATES = ["schema", "graph", "provenance", "content", "quality", "freshness", "review", "reconciliation"];
export const COUNCIL_RECORD_V2_VALIDATOR_VERSION = "1.0.0";

function schemaValidator(schema) {
  if (!validators.has(schema)) {
    const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, strictRequired: false, allowUnionTypes: true });
    ajv.addKeyword({ keyword: "x-referential-integrity", valid: true });
    addFormats(ajv);
    validators.set(schema, ajv.compile(schema));
  }
  return validators.get(schema);
}

const entries = (record) => [
  ["meeting", [record.meeting]], ["sittings", record.sittings], ["source_artifacts", record.source_artifacts],
  ["speakers", record.speakers], ["turns", record.turns], ["document_items", record.document_items ?? []],
  ["question_blocks", record.question_blocks], ["topic_blocks", record.topic_blocks],
  ["topic_snippets", record.topic_snippets], ["reconciliations", record.reconciliations],
];
const sameSet = (a, b) => a.length === b.length && new Set(a).size === a.length && a.every((id) => b.includes(id));
const lookup = (values, key) => values instanceof Map ? values.get(key) : values?.[key];
const canonical = (value) => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function deriveCouncilRecordRevisionContent(source, bytes) {
  if (source.kind === "text") return { bytes, text: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(bytes)), extractionVerified: true };
  if (source.kind === "html" && source.external_ids?.provider === "gijiroku_com") {
    return { ...deriveGijirokuRevisionContent(bytes, { act: source.external_ids.act }), extractionVerified: true };
  }
  if (source.kind === "api_json") {
    const raw = JSON.parse(Buffer.from(bytes).toString("utf8"));
    if (Array.isArray(raw.tenant_minutes)) return { ...dnpRevisionContent(bytes), extractionVerified: true,
      providerMetadata: new Map(raw.tenant_minutes.map((minute) => [String(minute.minute_id), minute])) };
    if (Array.isArray(raw.council_schedules)) return { bytes, text: null, providerSchedules: raw.council_schedules, extractionVerified: true };
  }
  return { bytes, extractionVerified: false };
}

/** Read-only verification. Missing evidence never becomes fabricated review or publication approval. */
export function validateCouncilRecordV2(record, { schema = defaultSchema, revisionContents, previousRecord, municipality } = {}) {
  const errors = [];
  let schemaPassed = false;
  const verifiedContents = new Map();
  const warnings = [];
  const error = (gate, path, message) => errors.push({ gate, path, message });
  const warn = (gate, path, message) => warnings.push({ gate, path, message });
  const finish = () => {
    const gateResults = GATES.map((gate) => ({
      gate,
      status: errors.some((item) => item.gate === gate) || warnings.some((item) => item.gate === gate) ? "fail" : "pass",
      detail: [...errors, ...warnings].filter((item) => item.gate === gate).map((item) => `${item.path}: ${item.message}`).join("; ") || "checked",
    }));
    for (const gate of gateResults) {
      if (gate.status !== "pass") continue;
      if (!schemaPassed && gate.gate !== "schema") { Object.assign(gate, { status: "not_applicable", detail: "Not run because schema validation failed." }); continue; }
      if (gate.gate === "provenance") gate.detail = "Stored snapshot hashes and parser derivation checked; publisher authority and live URL status are not independently certified.";
      if (gate.gate === "content") gate.detail = "Stored-source text, speaker labels, positions and record metadata consistency checked; calendar facts are not independently certified.";
      if (gate.gate === "freshness") gate.detail = "Current revision references and recorded retrieval/generation chronology checked; HTTP observation times are not independently certified.";
      if (gate.gate === "quality") Object.assign(gate, { status: "not_applicable", detail: "Semantic/OCR quality is not certified by this offline pilot validator." });
      if (gate.gate === "review" && !record?.publication?.public_visible) Object.assign(gate, { status: "not_applicable", detail: "Private record: review metadata consistency checked; human review not certified." });
      if (gate.gate === "reconciliation" && record?.record_status === "official" && !record.reconciliations?.length) Object.assign(gate, { status: "not_applicable", detail: "No provisional evidence in this record." });
    }
    return { ok: errors.length === 0, publicationReady: record?.publication?.public_visible === true && record.publication.state === "public" && errors.length === 0 && warnings.length === 0, errors, warnings, gateResults };
  };
  const validate = schemaValidator(schema);
  if (!validate(record)) {
    for (const item of validate.errors ?? []) error("schema", item.instancePath || "/", `${item.message} (${item.keyword})`);
    return finish();
  }

  schemaPassed = true;
  const indexes = {};
  for (const [collection, items] of entries(record)) {
    const index = new Map();
    const legacy = new Map();
    for (const [i, item] of items.entries()) {
      const location = `/${collection}/${i}`;
      if (index.has(item.id)) error("graph", `${location}/id`, `duplicate ID ${item.id}`);
      index.set(item.id, item);
      if ("municipality_id" in item && item.municipality_id !== record.municipality_id) error("graph", location, "municipality mismatch");
      if (item.legacy_ids && Object.keys(item.legacy_ids).length) {
        const key = canonical(item.legacy_ids);
        if (legacy.has(key)) error("graph", `${location}/legacy_ids`, `legacy identity also belongs to ${legacy.get(key)}`);
        legacy.set(key, item.id);
      }
    }
    indexes[collection] = index;
  }
  if (!sameSet(record.meeting.sitting_ids, record.sittings.map((item) => item.id))) error("graph", "/meeting/sitting_ids", "must identify exactly the record's sittings");
  const revisions = new Map();
  for (const source of record.source_artifacts) {
    for (const revision of source.revisions) {
      const location = `/source_artifacts/${source.id}/revisions/${revision.id}`;
      if (revisions.has(revision.id)) error("graph", location, "revision ID is not unique");
      revisions.set(revision.id, { revision, source });
      let evidence = lookup(revisionContents, revision.id);
      if (typeof evidence?.text === "string" && revision.extracted_text_sha256 != null && sha256(evidence.text) !== revision.extracted_text_sha256) error("provenance", location, "supplied extracted text hash mismatch");
      // Caller-provided text and inventories cannot replace extraction from retained bytes.
      if (evidence?.bytes != null) {
        try {
          const derived = deriveCouncilRecordRevisionContent(source, evidence.bytes);
          if (derived.extractionVerified && evidence.text != null && evidence.text !== derived.text) error("provenance", location, "supplied extracted text differs from snapshot bytes");
          evidence = derived;
          if (!derived.extractionVerified && revision.retrieval_status === "fetched") warn("provenance", location, "no independent parser is implemented for this source; caller text is unverified");
        } catch (cause) {
          error("provenance", location, `invalid source snapshot: ${cause.message}`);
          evidence = { bytes: evidence.bytes, extractionVerified: false };
        }
      } else if (evidence) evidence = { extractionVerified: false };
      verifiedContents.set(revision.id, evidence);
      if (revision.retrieval_status === "fetched") {
        if (!revision.snapshot_path && !source.content_url) error("provenance", location, "fetched revision needs snapshot or content URL");
        if (evidence?.bytes == null) warn("provenance", location, "snapshot bytes were not supplied for hash verification");
        else {
          if (sha256(evidence.bytes) !== revision.content_sha256) error("provenance", location, "snapshot content hash mismatch");
          if (revision.byte_size != null && Buffer.byteLength(evidence.bytes) !== revision.byte_size) error("provenance", location, "snapshot byte size mismatch");
        }
        if (revision.extracted_text_sha256 != null) {
          if (typeof evidence?.text !== "string") warn("provenance", location, "extracted text unavailable for hash verification");
          else if (sha256(evidence.text) !== revision.extracted_text_sha256) error("provenance", location, "extracted text hash mismatch");
        }
      }
      if (["failed", "blocked", "unavailable"].includes(revision.retrieval_status) && !revision.failure) error("provenance", location, "failed retrieval needs a reason");
      if (revision.supersedes_revision_id != null && !source.revisions.some((item) => item.id === revision.supersedes_revision_id)) error("graph", location, "superseded revision is outside this artifact");
    }
    if (source.current_revision_id != null && !source.revisions.some((item) => item.id === source.current_revision_id)) error("graph", `/source_artifacts/${source.id}`, "current revision does not belong to artifact");
  }
  if (municipality && municipality.slug !== record.municipality_id) error("graph", "/municipality_id", "registered municipality differs from record");
  const gijirokuOrigins = new Set();
  for (const source of record.source_artifacts) {
    const external = source.external_ids;
    const content = verifiedContents.get(source.current_revision_id);
    const location = `/source_artifacts/${source.id}`;
    const isDnp = source.kind === "api_json" && (external.tenant_id != null || content?.providerMetadata || content?.providerSchedules);
    const isGijiroku = source.kind === "html" && external.provider === "gijiroku_com";
    if (!isDnp && !isGijiroku) continue;
    try {
      const url = new URL(source.content_url);
      if (isDnp) {
        const endpoint = content?.providerSchedules || external.schedule_id == null ? "get_schedule" : "get_minute";
        if (url.href !== `https://ssp.kaigiroku.net/dnp/search/minutes/${endpoint}`) error("provenance", location, "DNP content URL differs from its API endpoint");
        if (external.tenant_id == null) error("provenance", location, "DNP source has no tenant ID");
        if (String(external.council_id) !== String(record.meeting.legacy_ids?.council_id)) error("graph", location, "DNP external council differs from meeting");
        if (content?.providerMetadata && external.schedule_id == null) error("graph", location, "DNP minute source has no schedule ID");
        if (municipality && (municipality.system !== "dnp" || String(external.tenant_id) !== String(municipality.tenant_id))) error("provenance", location, "DNP tenant differs from registered municipality");
        if (record.meeting.external_ids?.council_id != null && String(record.meeting.external_ids.council_id) !== String(external.council_id)) error("graph", location, "DNP source council differs from meeting external ID");
        if (record.meeting.external_ids?.tenant_id != null && String(record.meeting.external_ids.tenant_id) !== String(external.tenant_id)) error("graph", location, "DNP tenant differs from meeting");
        if (source.landing_url) {
          const landing = new URL(source.landing_url);
          if (landing.origin !== "https://ssp.kaigiroku.net" || !landing.pathname.startsWith(`/tenant/${record.municipality_id}/`)) error("provenance", location, "DNP landing URL belongs to another tenant");
        }
      } else {
        gijirokuOrigins.add(url.origin);
        if (String(external.kgno) !== String(record.meeting.legacy_ids?.council_id)) error("graph", location, "gijiroku source KGNO differs from meeting");
        if (external.year != null && String(external.year) !== String(record.meeting.year)) error("graph", location, "gijiroku source year differs from meeting");
        if (url.protocol !== "https:" || !url.hostname.endsWith(".gijiroku.com") || url.pathname !== "/voices/cgi/voiweb.exe") error("provenance", location, "invalid gijiroku provider URL");
        if (municipality && (municipality.system !== "gijiroku_com" || url.hostname !== `${municipality.gijiroku_subdomain || municipality.slug}.gijiroku.com`)) error("provenance", location, "gijiroku origin differs from registered municipality");
        const query = url.searchParams;
        if (`ACT${query.get("ACT")}` !== external.act) error("provenance", location, "gijiroku URL ACT differs from source metadata");
        const requiredKeys = external.act === "ACT200" ? ["KGNO", "FINO", "UNID"] : external.act === "ACT203" ? ["FINO", "HUID"] : [];
        for (const key of ["KGNO", "FINO", "UNID", "HUID"]) {
          if (requiredKeys.includes(key) || query.has(key)) if (query.get(key) !== String(external[key.toLowerCase()])) error("provenance", location, `gijiroku URL ${key} differs from source metadata`);
        }
        for (const key of ["FYY", "TYY"]) if (query.get(key) !== String(record.meeting.year)) error("provenance", location, "gijiroku URL year differs from meeting");
        if (source.landing_url && new URL(source.landing_url).origin !== url.origin) error("provenance", location, "gijiroku landing URL belongs to another origin");
      }
    } catch { error("provenance", location, "provider content or landing URL is invalid"); }
  }
  if (gijirokuOrigins.size > 1) error("provenance", "/source_artifacts", "gijiroku sources must share the same origin");
  const gijirokuSources = record.source_artifacts.filter((source) => source.kind === "html" && source.external_ids?.provider === "gijiroku_com");
  const gijirokuInventory = gijirokuSources.filter((source) => source.external_ids.act === "ACT100")
    .flatMap((source) => verifiedContents.get(source.current_revision_id)?.meetings ?? []);
  const gijirokuBodies = gijirokuSources.filter((source) => source.external_ids.act === "ACT203");
  for (const source of gijirokuBodies) {
    const external = source.external_ids;
    const location = `/source_artifacts/${source.id}`;
    if (String(external.kgno) !== String(record.meeting.legacy_ids?.council_id)) error("graph", location, "gijiroku KGNO differs from meeting");
    if (!gijirokuInventory.length) warn("provenance", location, "gijiroku document inventory is unavailable");
    else if (gijirokuInventory.filter((item) => String(item.kgno) === String(external.kgno) && String(item.fino) === String(external.fino) && item.unid === external.unid).length !== 1) error("graph", location, "gijiroku body is absent or ambiguous in captured inventory");
    const frames = gijirokuSources.filter((frame) => frame.external_ids.act === "ACT200" && String(frame.external_ids.kgno) === String(external.kgno) && String(frame.external_ids.fino) === String(external.fino) && frame.external_ids.unid === external.unid);
    if (frames.length !== 1) error("graph", location, "gijiroku body needs exactly one matching frameset");
    else {
      const frame = verifiedContents.get(frames[0].current_revision_id);
      if (!frame?.huid) warn("provenance", location, "gijiroku frameset HUID is unverified");
      else if (frame.huid !== external.huid) error("graph", location, "gijiroku body HUID differs from captured frameset");
    }
  }
  for (const item of gijirokuInventory.filter((item) => String(item.kgno) === String(record.meeting.legacy_ids?.council_id))) {
    if (gijirokuBodies.filter((source) => String(source.external_ids.fino) === String(item.fino)).length !== 1) error("graph", "/source_artifacts", "each captured inventory document needs exactly one body source");
  }
  const sittingOrders = new Set();
  for (const sitting of record.sittings) {
    if (sittingOrders.has(sitting.order_index)) error("graph", `/sittings/${sitting.id}`, "duplicate sitting order_index");
    sittingOrders.add(sitting.order_index);
    if (sitting.legacy_presentation?.name != null && sitting.title_original !== sitting.legacy_presentation.name) error("content", `/sittings/${sitting.id}`, "sitting title differs from legacy presentation");
    if (sitting.legacy_ids?.schedule_id != null) for (const evidence of verifiedContents.values()) {
      const original = evidence?.providerSchedules?.find((item) => String(item.schedule_id) === String(sitting.legacy_ids.schedule_id));
      if (original && original.name !== sitting.title_original) error("content", `/sittings/${sitting.id}`, "sitting title differs from provider schedule");
    }
    for (const sourceId of sitting.source_artifact_ids) {
      const source = indexes.source_artifacts.get(sourceId);
      if (source?.kind === "api_json" && source.external_ids?.schedule_id != null && sitting.external_ids?.schedule_id != null && String(source.external_ids.schedule_id) !== String(sitting.external_ids.schedule_id)) error("graph", `/sittings/${sitting.id}`, "DNP source schedule differs from sitting external ID");
      if (source?.kind === "api_json" && source.external_ids?.schedule_id != null && String(source.external_ids.schedule_id) !== String(sitting.legacy_ids?.schedule_id)) error("graph", `/sittings/${sitting.id}`, "DNP source schedule differs from parent sitting");
      if (source?.external_ids?.provider !== "gijiroku_com" || source.external_ids.act !== "ACT203") continue;
      const external = source.external_ids;
      for (const key of ["kgno", "fino", "unid", "huid"]) if (sitting.external_ids?.[key] != null && String(sitting.external_ids[key]) !== String(external[key])) error("graph", `/sittings/${sitting.id}`, `sitting ${key} differs from source metadata`);
      const inventory = gijirokuInventory.find((item) => String(item.kgno) === String(external.kgno) && String(item.fino) === String(external.fino));
      if (inventory && inventory.schedule_name !== sitting.title_original) error("content", `/sittings/${sitting.id}`, "document title differs from captured inventory");
      if (sitting.legacy_presentation?.source_fino != null && String(sitting.legacy_presentation.source_fino) !== String(external.fino)) error("graph", `/sittings/${sitting.id}`, "legacy source_fino differs from source FINO");
    }
    if (sitting.meeting_id !== record.meeting.id) error("graph", `/sittings/${sitting.id}`, "meeting mismatch");
    for (const id of sitting.source_artifact_ids) if (!indexes.source_artifacts.has(id)) error("graph", `/sittings/${sitting.id}`, `missing source artifact ${id}`);
    if (sitting.date_status === "unknown" && (sitting.date !== null || !sitting.date_note?.trim())) error("content", `/sittings/${sitting.id}/date`, "unknown date must be null with a reason");
    if (sitting.date_status === "exact" && sitting.date === null) error("content", `/sittings/${sitting.id}/date`, "exact date cannot be null");
    if (sitting.date && record.meeting.start_date && sitting.date < record.meeting.start_date) error("content", `/sittings/${sitting.id}/date`, "date precedes meeting range");
    if (sitting.date && record.meeting.end_date && sitting.date > record.meeting.end_date) error("content", `/sittings/${sitting.id}/date`, "date follows meeting range");
  }
  if (record.meeting.legacy_presentation) {
    if (record.meeting.title_original !== record.meeting.legacy_presentation.name) error("content", "/meeting", "meeting title differs from legacy presentation");
    if (record.meeting.year !== Number(record.meeting.legacy_presentation.year)) error("content", "/meeting", "meeting year differs from legacy presentation");
  }
  if (record.meeting.start_date && record.meeting.end_date && record.meeting.start_date > record.meeting.end_date) error("content", "/meeting", "reversed meeting dates");
  if (record.meeting.date_status === "exact" && (!record.meeting.start_date || !record.meeting.end_date)) error("content", "/meeting", "exact meeting dates cannot be null");
  if (record.meeting.date_status === "unknown" && (record.meeting.start_date !== null || record.meeting.end_date !== null || !record.meeting.date_note?.trim())) error("content", "/meeting", "unknown meeting dates must be null with a reason");

  const usedRevisions = new Set();
  function spanCheck(span, location, entity, sittingId) {
    const target = revisions.get(span.source_revision_id);
    if (!target || target.source.id !== span.source_artifact_id) {
      error("graph", location, "source revision does not belong to referenced artifact"); return;
    }
    usedRevisions.add(span.source_revision_id);
    const sitting = indexes.sittings.get(sittingId);
    if (sitting && !sitting.source_artifact_ids.includes(span.source_artifact_id)) error("graph", location, "source is not attached to this sitting");
    if (target.revision.retrieval_status !== "fetched") error("provenance", location, "content refers to an unfetched revision");
    const evidence = verifiedContents.get(span.source_revision_id);
    for (const [start, end, limit, inclusive] of [
      ["page_start", "page_end", evidence?.pageCount ?? target.revision.page_count, true],
      ["raw_start_line", "raw_end_line", typeof evidence?.text === "string" ? evidence.text.split(/\r?\n/u).length : null, true],
      ["media_start_ms", "media_end_ms", evidence?.mediaDurationMs, false],
      ["document_char_start", "document_char_end", evidence?.text?.length, false],
    ]) {
      if (span[start] == null) continue;
      const sourceEmpty = start === "document_char_start" && entity?.text_original === "" && entity?.text_status === "empty_in_source";
      if (inclusive || sourceEmpty ? span[start] > span[end] : span[start] >= span[end]) error("content", location, `invalid ${start}/${end} range`);
      if (limit == null) warn("content", location, `upper bound unavailable for ${end}`);
      else if (span[end] > limit) error("content", location, `${end} exceeds source bounds`);
    }
    if (span.bbox && (span.bbox[0] > span.bbox[2] || span.bbox[1] > span.bbox[3])) error("content", location, "reversed bounding box");
    if (span.provider_minute_id != null) {
      const id = String(span.provider_minute_id);
      if (entity?.legacy_ids?.minute_id != null && String(entity.legacy_ids.minute_id) !== id) error("graph", location, "legacy minute ID differs from provider minute locator");
      if (!evidence?.providerMetadata) warn("content", location, "provider extraction was not independently verified from snapshot bytes");
      const providerIds = evidence?.providerMinuteIds ?? (evidence?.providerMinutes instanceof Map ? [...evidence.providerMinutes.keys()] : Object.keys(evidence?.providerMinutes ?? {}));
      if (!providerIds || Array.from(providerIds).length === 0) warn("content", location, "provider minute inventory unavailable");
      else if (!Array.from(providerIds, String).includes(id)) error("content", location, `provider minute ${id} not in snapshot`);
      const original = lookup(evidence?.providerMinutes, id);
      if (entity?.text_original != null) {
        if (original == null) warn("content", location, "provider original text unavailable for exact comparison");
        else if (original !== entity.text_original) error("content", location, "text_original differs from provider minute text");
      }
      const metadata = evidence?.providerMetadata?.get(id);
      if (entity?.speaker_name_original != null && metadata) {
        if (typeof metadata.title !== "string") warn("content", location, "provider speaker title unavailable for exact comparison");
        else if (entity.speaker_name_original !== metadata.title) error("content", location, "speaker_name_original differs from provider title");
      }
      if (entity?.legacy_presentation && metadata && (entity.legacy_presentation.title !== metadata.title || entity.legacy_presentation.minute_type !== metadata.minute_type)) error("content", location, "legacy presentation differs from provider metadata");
    }
    if (entity?.text_original != null && span.provider_minute_id == null && span.document_char_start == null) warn("content", location, "original text comparison requires a verified provider item or source character range");
    if (span.document_char_start != null && typeof evidence?.text === "string" && entity?.text_original != null
      && evidence.text.slice(span.document_char_start, span.document_char_end) !== entity.text_original) error("content", location, "text_original differs from source character range");
  }
  function contextCheck(entity, location) {
    if (entity.meeting_id !== record.meeting.id || !indexes.sittings.has(entity.sitting_id)) error("graph", location, "meeting or sitting mismatch");
    const sitting = indexes.sittings.get(entity.sitting_id);
    for (const [key, expected] of [["council_id", record.meeting.legacy_ids?.council_id], ["schedule_id", sitting?.legacy_ids?.schedule_id]]) {
      if (expected != null && entity.legacy_ids?.[key] != null && String(entity.legacy_ids[key]) !== String(expected)) error("graph", location, `legacy ${key} differs from parent`);
    }
    spanCheck(entity.source_span, `${location}/source_span`, entity, entity.sitting_id);
  }
  const orderedItems = [...record.turns, ...(record.document_items ?? [])];
  const orders = new Set();
  const legacyMinutes = new Set();
  const itemIds = new Set();
  for (const entity of orderedItems) {
    const location = `/items/${entity.id}`;
    contextCheck(entity, location);
    const order = `${entity.sitting_id}:${entity.order_index}`;
    if (orders.has(order)) error("graph", location, "turn/document order_index collision in sitting");
    orders.add(order);
    if (itemIds.has(entity.id)) error("graph", location, "turn/document ID collision");
    itemIds.add(entity.id);
    if (entity.legacy_ids?.minute_id != null) {
      const key = `${entity.sitting_id}:${entity.legacy_ids.minute_id}`;
      if (legacyMinutes.has(key)) error("graph", location, "legacy minute ID collision in sitting");
      legacyMinutes.add(key);
    }
    if ("speaker_id" in entity) {
      const speaker = indexes.speakers.get(entity.speaker_id);
      if (!speaker) error("graph", location, "speaker does not exist");
      else {
        if (![speaker.name_original, ...speaker.aliases].includes(entity.speaker_name_original)) error("graph", location, "turn original speaker name differs from speaker identity");
        if (entity.speaker_type !== speaker.speaker_type) error("graph", location, "turn speaker type differs from speaker identity");
      }
    }
  }
  for (const source of gijirokuBodies) {
    const text = verifiedContents.get(source.current_revision_id)?.text;
    const items = orderedItems.filter((item) => item.source_span.source_artifact_id === source.id);
    if (items.length !== 1 || "speaker_id" in (items[0] ?? {})) error("content", `/source_artifacts/${source.id}`, "whole-document pilot requires exactly one DocumentItem per body");
    else if (typeof text === "string" && (items[0].text_original !== text || items[0].source_span.document_char_start !== 0 || items[0].source_span.document_char_end !== text.length)) error("content", `/items/${items[0].id}`, "DocumentItem must cover the entire captured body text");
  }
  for (const speaker of record.speakers) {
    if (speaker.identity_match.status === "matched" && (!speaker.person_id || !speaker.membership_id)) error("graph", `/speakers/${speaker.id}`, "matched identity needs person and membership IDs");
    if (speaker.identity_match.status !== "matched" && (speaker.person_id !== null || speaker.membership_id !== null)) error("graph", `/speakers/${speaker.id}`, "unresolved identity must not claim person or membership");
  }
  for (const revisionId of revisions.keys()) {
    const evidence = verifiedContents.get(revisionId);
    const providerIds = evidence?.providerMinuteIds;
    if (!providerIds) continue;
    const expected = Array.from(providerIds, String);
    const actual = orderedItems.filter((item) => item.source_span.source_revision_id === revisionId).sort((a, b) => a.order_index - b.order_index).map((item) => String(item.source_span.provider_minute_id));
    if (!sameSet(actual, expected)) error("content", `/revisions/${revisionId}`, "turn/document items must cover every provider minute exactly once");
    else if (actual.some((id, i) => id !== expected[i])) error("content", `/revisions/${revisionId}`, "turn/document order differs from provider source order");
  }

  function chronological(ids, location) {
    const turns = ids.map((id) => indexes.turns.get(id)).filter(Boolean);
    if (new Set(ids).size !== ids.length || turns.some((turn, i) => i > 0 && turn.order_index <= turns[i - 1].order_index)) error("graph", location, "turn references must follow source order without duplicates");
  }
  function turnReferences(ids, sittingId, location) {
    for (const id of ids) {
      const turn = indexes.turns.get(id);
      if (!turn || (sittingId && turn.sitting_id !== sittingId)) error("graph", location, `missing or cross-sitting turn ${id}`);
    }
  }
  function evidenceCheck(evidence, sittingId, location) {
    const revision = revisions.get(evidence.source_revision_id);
    if (!revision || revision.source.id !== evidence.source_artifact_id) error("graph", location, "evidence artifact/revision mismatch");
    turnReferences(evidence.turn_ids, sittingId, location);
    for (const id of evidence.turn_ids) if (indexes.turns.get(id)?.source_span.source_revision_id !== evidence.source_revision_id) error("graph", location, "evidence turn uses another revision");
  }
  for (const question of record.question_blocks) {
    const location = `/question_blocks/${question.id}`;
    contextCheck(question, location);
    turnReferences(question.turn_ids, question.sitting_id, location);
    chronological(question.turn_ids, location);
    const questionTurns = question.turn_ids.map((id) => indexes.turns.get(id)).filter((turn) => turn?.turn_type === "question" || turn?.turn_type === "re_question");
    if (questionTurns.length && questionTurns.some((turn) => turn.speaker_id !== question.questioner_speaker_id)) error("graph", location, "questioner differs from question turn speaker");
    if (!questionTurns.length && !question.turn_ids.some((id) => indexes.turns.get(id)?.speaker_id === question.questioner_speaker_id)) error("graph", location, "questioner has no turn in question");
    if (!indexes.speakers.has(question.questioner_speaker_id)) error("graph", location, "questioner does not exist");
    if (question.turn_ids[0] !== question.start_turn_id || question.turn_ids.at(-1) !== question.end_turn_id) error("graph", location, "question boundary differs from ordered turn IDs");
    for (const id of question.topic_block_ids) if (indexes.topic_blocks.get(id)?.question_block_id !== question.id) error("graph", location, "topic belongs to another question");
    evidenceCheck(question.preferred_evidence, question.sitting_id, location);
    if (!sameSet(question.preferred_evidence.turn_ids, question.turn_ids)) error("graph", location, "preferred evidence must cover exactly the question turns");
    for (const evidence of question.evidence_variants) {
      evidenceCheck(evidence, question.sitting_id, location);
      if (evidence.source_revision_id === question.preferred_evidence.source_revision_id && !sameSet(evidence.turn_ids, question.turn_ids)) error("graph", location, "same-revision evidence differs from question turns");
    }
  }
  for (const topic of record.topic_blocks) {
    const location = `/topic_blocks/${topic.id}`;
    contextCheck(topic, location);
    const question = indexes.question_blocks.get(topic.question_block_id);
    if (!question || question.sitting_id !== topic.sitting_id || !question.topic_block_ids.includes(topic.id)) error("graph", location, "question/topic relationship mismatch");
    turnReferences(topic.related_turn_ids, topic.sitting_id, location);
    chronological(topic.related_turn_ids, location);
    chronological(topic.flow.map((flow) => flow.turn_id), location);
    for (const id of topic.related_turn_ids) if (question && !question.turn_ids.includes(id)) error("graph", location, "topic turn is outside question");
    for (const id of topic.topic_snippet_ids) if (indexes.topic_snippets.get(id)?.topic_block_id !== topic.id) error("graph", location, "snippet belongs to another topic");
    for (const flow of topic.flow) {
      if (!topic.related_turn_ids.includes(flow.turn_id) || indexes.turns.get(flow.turn_id)?.speaker_id !== flow.speaker_id) error("graph", location, "flow turn/speaker mismatch");
      if (flow.snippet_id != null && (indexes.topic_snippets.get(flow.snippet_id)?.turn_id !== flow.turn_id || !topic.topic_snippet_ids.includes(flow.snippet_id))) error("graph", location, "flow snippet mismatch");
    }
  }
  for (const snippet of record.topic_snippets) {
    const location = `/topic_snippets/${snippet.id}`;
    const turn = indexes.turns.get(snippet.turn_id);
    const topic = indexes.topic_blocks.get(snippet.topic_block_id);
    if (!turn || !topic || !topic.related_turn_ids.includes(snippet.turn_id) || !topic.topic_snippet_ids.includes(snippet.id)) error("graph", location, "snippet owner/turn mismatch");
    if (!turn || snippet.turn_char_start >= snippet.turn_char_end || snippet.turn_char_end > turn.text_original.length
      || turn.text_original.slice(snippet.turn_char_start, snippet.turn_char_end) !== snippet.text_original) error("content", location, "snippet is not the exact turn substring at stated offsets");
    spanCheck(snippet.source_span, `${location}/source_span`, null, turn?.sitting_id);
    if (turn && snippet.source_span.source_revision_id !== turn.source_span.source_revision_id) error("graph", location, "snippet revision differs from its turn");
    if (turn && snippet.source_span.provider_minute_id != null && String(snippet.source_span.provider_minute_id) !== String(turn.source_span.provider_minute_id)) error("graph", location, "snippet provider minute differs from its turn");
  }
  for (const id of record.derivation.input_revision_ids) {
    const target = revisions.get(id);
    if (!target) error("graph", "/derivation/input_revision_ids", `missing revision ${id}`);
    else {
      if (target.source.current_revision_id !== id) error("freshness", "/derivation/input_revision_ids", `stale revision ${id}`);
      if (target.revision.fetched_at && Date.parse(record.derivation.generated_at) < Date.parse(target.revision.fetched_at)) error("freshness", "/derivation/generated_at", "generation predates input retrieval");
    }
  }
  for (const id of usedRevisions) if (!record.derivation.input_revision_ids.includes(id)) error("freshness", "/derivation/input_revision_ids", `used revision omitted: ${id}`);
  for (const [, entities] of entries(record)) for (const entity of entities) {
    if (entity.extraction?.pipeline_run_id !== undefined && entity.extraction.pipeline_run_id !== record.derivation.pipeline_run_id) error("provenance", `/${entity.id}/extraction`, "pipeline run mismatch");
    if (entity.review && entity.review.status !== "reviewed" && (entity.review.reviewed_by !== null || entity.review.reviewed_at !== null)) error("review", `/${entity.id}/review`, "unreviewed entity has review attribution");
    if (entity.publication?.public_visible && (entity.review?.status !== "reviewed" || entity.publication.status !== "public" || !record.publication.public_visible)) error("review", `/${entity.id}/publication`, "entity publication requires documented review and public parent");
  }
  for (const reconciliation of record.reconciliations) {
    const location = `/reconciliations/${reconciliation.id}`;
    for (const variant of ["provisional", "official"]) {
      const artifactId = reconciliation[`${variant}_source_artifact_id`];
      const revisionId = reconciliation[`${variant}_source_revision_id`];
      if ((artifactId == null) !== (revisionId == null)) error("reconciliation", location, `${variant} artifact/revision must be supplied together`);
      if (artifactId != null && (!revisions.has(revisionId) || revisions.get(revisionId).source.id !== artifactId)) error("reconciliation", location, `${variant} artifact/revision mismatch`);
    }
    for (const mapping of reconciliation.question_mappings) {
      for (const key of ["provisional_question_id", "official_question_id", "preferred_question_id"]) if (mapping[key] != null && !indexes.question_blocks.has(mapping[key])) error("reconciliation", location, `missing ${key}`);
      turnReferences([...mapping.provisional_turn_ids, ...mapping.official_turn_ids], null, location);
    }
  }
  if (["provisional", "mixed"].includes(record.record_status) && record.reconciliations.length === 0) warn("reconciliation", "/reconciliations", "provisional content has no reconciliation ledger");
  if (previousRecord) {
    if (!validate(previousRecord)) {
      error("schema", "/previousRecord", "previous record does not satisfy the current schema");
      return finish();
    }
    if (previousRecord.record_id !== record.record_id || previousRecord.municipality_id !== record.municipality_id || previousRecord.meeting.id !== record.meeting.id) error("graph", "/record_id", "record identity changed");
    for (const [collection, entities] of entries(previousRecord)) for (const previous of entities) {
      if (previous.legacy_ids && Object.keys(previous.legacy_ids).length) {
        const sameLegacy = [...(indexes[collection]?.values() ?? [])].find((item) => item.legacy_ids && canonical(item.legacy_ids) === canonical(previous.legacy_ids));
        if (sameLegacy && sameLegacy.id !== previous.id) error("graph", `/${collection}/${sameLegacy.id}`, "legacy identity was reassigned to a new entity ID");
      }
      const current = indexes[collection]?.get(previous.id);
      if (current && previous.legacy_ids && canonical(current.legacy_ids ?? {}) !== canonical(previous.legacy_ids)) error("graph", `/${collection}/${previous.id}`, "published entity ID was reassigned to different legacy identity");
    }
  }
  if (record.publication.public_visible) {
    error("quality", "/publication", "public certification is outside this offline internal-preview pilot");
    const gates = record.publication.gate_results;
    if (!sameSet(gates.map((gate) => gate.gate), GATES)) error("review", "/publication/gate_results", "all publication gates are required exactly once");
    for (const gate of gates) if (["schema", "graph", "provenance", "content", "freshness"].includes(gate.gate) && gate.status !== "pass") error("review", "/publication/gate_results", `${gate.gate} cannot be skipped`);
    if (record.derivation.validation.status !== "pass") error("review", "/derivation/validation", "public record requires passing validation");
    for (const item of warnings) error(item.gate, item.path, `publication blocked: ${item.message}`);
  }
  return finish();
}
