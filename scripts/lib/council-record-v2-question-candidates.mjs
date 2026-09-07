import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createDnpQuestionParser, normalizeQuestioner } from "../../site/scripts/build-member-activity.mjs";
import { validateCouncilRecordV2 } from "./council-record-v2-validation.mjs";
import { projectCouncilRecordV2ToMinutes } from "./council-record-v2-projection.mjs";
import { assertMinutesV2PreviewValidation } from "./council-record-v2-preview.mjs";

export const QUESTION_CANDIDATES_VERSION = "council-record-v2-question-candidates.v1";
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Source labels are extraction keys, never current-member or person identities. */
export function parseSourceQuestionCandidates(minutes) {
  const memberNames = [...new Set(minutes.schedules.flatMap((schedule) => schedule.minutes
    .filter((minute) => minute.minute_type === "◆質問")
    .map((minute) => normalizeQuestioner(minute.title)).filter(Boolean)))];
  const unresolved = new Map();
  const findMember = (raw) => {
    const label = normalizeQuestioner(raw);
    if (!label) return null;
    if (memberNames.includes(label)) return label;
    const possible = memberNames.filter((name) => name.startsWith(label) || label.includes(name));
    if (possible.length === 1) return possible[0];
    unresolved.set(String(raw), { label_original: String(raw), candidate_labels: possible, status: possible.length ? "ambiguous" : "unresolved" });
    return null;
  };
  const parser = createDnpQuestionParser({ findMember, memberNames });
  if (String(minutes.name).includes("委員会") || !parser.isRawQuestionCapableMeeting(minutes)) return { blocks: [], unresolved_labels: [], status: "outside_personal_plenary_scope" };
  const personal = parser.parsePersonalQuestionBlocks(minutes);
  return { blocks: [...personal.blocks, ...parser.parsePlenaryQuestionBlocks(minutes, personal.coveredBySchedule)],
    unresolved_labels: [...unresolved.values()], status: "candidate_extraction_completed" };
}

export function mapQuestionCandidate(record, block) {
  const sitting = record.sittings.find((item) => item.legacy_ids?.schedule_id === block.scheduleId);
  assert.ok(sitting, "candidate sitting is absent from v2");
  const turns = new Map(record.turns.map((item) => [item.id, item]));
  const items = [...record.turns, ...record.document_items].filter((item) => item.sitting_id === sitting.id).sort((a, b) => a.order_index - b.order_index);
  const byMinute = new Map(items.map((item) => [Number(item.legacy_ids?.minute_id), item]));
  const start = items.indexOf(byMinute.get(block.markerMinuteId));
  const end = items.indexOf(byMinute.get(block.endMinuteId));
  assert.ok(start >= 0 && end >= start, "candidate boundary is missing or reversed in its sitting");
  const span = items.slice(start, end + 1);
  const evidence = block.minuteIds.map((id) => byMinute.get(id));
  assert.ok(evidence.length && evidence.every((item) => item && turns.has(item.id) && span.includes(item)), "candidate question evidence is absent or outside its sitting boundary");
  assert.ok(evidence.every((item, i) => i === 0 || evidence[i - 1].order_index < item.order_index), "candidate question evidence order differs from source");
  const questionTurns = evidence.map((item) => ({ turn_id: item.id, order_index: item.order_index,
    speaker_name_original: item.speaker_name_original, text_original: item.text_original, source_span: item.source_span }));
  return {
    id: `${record.record_id}:question-candidate:${block.scheduleId}:${block.markerMinuteId}:${block.minuteIds[0]}:${block.questionKind}`,
    sitting_id: sitting.id, question_kind_candidate: block.questionKind,
    questioner: { label_originals: [...new Set(evidence.map((item) => item.speaker_name_original))], label_normalized: block.memberName,
      identity_status: "unresolved", label_basis: "source_speaker_labels_only" },
    review_status: "unreviewed", publication: { state: "internal_preview", public_visible: false },
    boundary: { start_item_id: span[0].id, end_item_id: span.at(-1).id, start_order_index: span[0].order_index,
      end_order_index: span.at(-1).order_index, closure_method: block.closureMethod },
    turn_ids: span.filter((item) => turns.has(item.id)).map((item) => item.id),
    document_item_ids: span.filter((item) => !turns.has(item.id)).map((item) => item.id),
    question_turn_ids: evidence.map((item) => item.id), question_turns: questionTurns,
    legacy_comparison: { council_id: block.councilId, schedule_id: block.scheduleId, block_id: block.blockId,
      question_kind: block.questionKind, evidence_minute_ids: block.minuteIds, marker_minute_id: block.markerMinuteId,
      end_minute_id: block.endMinuteId, closure_method: block.closureMethod },
  };
}

export function compareQuestionCandidates(candidates, baselineActivity, councilId) {
  if (baselineActivity == null) return { baseline_status: "unavailable", baseline_count: null, matched_count: 0, difference_count: null,
    differences: [], note: "Current activity baseline is unavailable; equivalence was not checked." };
  assert.ok(baselineActivity && typeof baselineActivity === "object" && !Array.isArray(baselineActivity), "activity baseline must be an object");
  const baseline = Object.values(baselineActivity).flatMap((entry) => {
    assert.ok(Array.isArray(entry.sessions), "activity baseline sessions must be an array");
    return entry.sessions;
  }).filter((item) => String(item.council_id) === String(councilId));
  const key = (item) => JSON.stringify([item.schedule_id, item.question_kind, item.evidence_minute_ids]);
  const used = new Set();
  const differences = [];
  let matched = 0;
  for (const candidate of candidates) {
    const actual = candidate.legacy_comparison;
    const matches = baseline.filter((item) => key(item) === key(actual));
    if (matches.length !== 1) { differences.push({ kind: matches.length ? "ambiguous_baseline" : "candidate_only", candidate_id: candidate.id }); continue; }
    const previous = matches[0];
    if (used.has(previous)) { differences.push({ kind: "duplicate_candidate_match", candidate_id: candidate.id, baseline_record_id: previous.record_id }); continue; }
    used.add(previous);
    const fields = ["marker_minute_id", "end_minute_id", "closure_method", "block_id"];
    const changed = fields.filter((field) => !same(previous[field], actual[field]));
    if (changed.length) differences.push({ kind: "boundary_changed", candidate_id: candidate.id, baseline_record_id: previous.record_id,
      fields: changed.map((field) => ({ field, baseline: previous[field], candidate: actual[field] })) });
    else matched += 1;
  }
  for (const item of baseline) if (!used.has(item)) differences.push({ kind: "baseline_only", baseline_record_id: item.record_id,
    schedule_id: item.schedule_id, evidence_minute_ids: item.evidence_minute_ids });
  return { baseline_status: "available", baseline_count: baseline.length, matched_count: matched, difference_count: differences.length, differences };
}

export function createQuestionCandidateReport({ record, bundle, baselineActivity, generatedAt, inputProvenance = null }) {
  assert.equal(record.publication?.state, "internal_preview");
  assert.equal(record.publication?.public_visible, false);
  assert.equal(record.municipality_id, bundle.municipality.slug);
  assert.notEqual(bundle.municipality.minutes_access, "restricted");
  const validation = validateCouncilRecordV2(record, { revisionContents: bundle.revisionContents });
  assertMinutesV2PreviewValidation(validation);
  const projection = projectCouncilRecordV2ToMinutes(record, { municipality: bundle.municipality, mode: "preview", generatedAt: record.derivation.generated_at });
  assert.deepEqual(projection.minutes, bundle.legacyCouncil, "v2 projection must equal the manifest-bound original minutes");
  const extraction = parseSourceQuestionCandidates(projection.minutes);
  const candidates = extraction.blocks.map((block) => mapQuestionCandidate(record, block));
  assert.equal(new Set(candidates.map((item) => item.id)).size, candidates.length, "duplicate question candidate IDs");
  const evidenceKeys = candidates.map((item) => JSON.stringify([item.sitting_id, item.question_turn_ids]));
  assert.equal(new Set(evidenceKeys).size, evidenceKeys.length, "duplicate question candidate evidence");
  const classified = new Set(candidates.flatMap((item) => item.question_turn_ids));
  const unclassified = record.turns.filter((turn) => turn.legacy_presentation?.minute_type === "◆質問" && !classified.has(turn.id)).map((turn) => ({
    turn_id: turn.id, sitting_id: turn.sitting_id, order_index: turn.order_index,
    speaker_name_original: turn.speaker_name_original, source_span: turn.source_span,
    status: "not_selected_as_question_evidence", note: "May be procedure, a report, correction, or an unresolved question; absence is not zero activity." }));
  return { schema_version: QUESTION_CANDIDATES_VERSION, record_id: record.record_id, municipality_id: record.municipality_id,
    council_id: String(bundle.legacyCouncil.council_id), generated_at: generatedAt,
    publication: { state: "internal_preview", public_visible: false },
    provenance: { inputs: inputProvenance, record_sha256: hash(record), legacy_minutes_sha256: hash(bundle.legacyCouncil),
      input_revision_ids: record.derivation.input_revision_ids, generator: "shared-dnp-question-parser/1", source: "v2 Turns and document_items via lossless projection" },
    validation: { ok: true, warnings: [], legacy_equivalence: true, gate_results: validation.gateResults },
    extraction_status: extraction.status, candidate_count: candidates.length, candidates,
    comparison: compareQuestionCandidates(candidates, baselineActivity, bundle.legacyCouncil.council_id),
    unclassified_turn_count: unclassified.length, unclassified_turns: unclassified, unresolved_labels: extraction.unresolved_labels,
    note: "QuestionBlock records remain unchanged. Candidates are unreviewed; no person or membership identities are assigned." };
}
