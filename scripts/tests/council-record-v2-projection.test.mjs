import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildDnpCouncilRecordV2, DNP_API_BASE } from "../lib/dnp-council-record-v2.mjs";
import { projectCouncilRecordV2ToMinutes } from "../lib/council-record-v2-projection.mjs";
import { validateCouncilRecordV2 } from "../lib/council-record-v2-validation.mjs";

const generatedAt = "2026-09-07T01:00:00.000Z";
const municipality = { slug: "sample", system: "dnp", tenant_id: 1 };
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fixture() {
  const legacy = {
    council_id: 578, name: "令和 ８年 第１回定例会", year: "2026", japanese_year: "令和8年", type_label: "本会議 > 定例会",
    schedules: [
      { schedule_id: 2, name: "03月02日－01号", page_no: 17, minutes: [
        { minute_id: 1, title: "（名簿）", minute_type: "名簿", text: "開会の記録" },
        { minute_id: 4, title: "本文のない議題", minute_type: "△議題", text: "" },
        { minute_id: 9, title: "山田議員", minute_type: "◆質問", text: "◆山田議員　原文。\n　全角空白・句読点を保持。", source_url: "https://example.test/minute/9" },
        { minute_id: 12, title: "委員長", minute_type: "◆質問", text: "報告いたします。" },
      ] },
      { schedule_id: 3, name: "開催日不明", page_no: null, date: "", minutes: [
        { minute_id: 1, title: "（名簿）", minute_type: "名簿", text: "次の日程の記録" },
        { minute_id: 3, title: "答弁者未確定", minute_type: "◎答弁", text: "◎答弁者未確定　お答えします。" },
      ] },
    ],
  };
  function capture(endpoint, payload, data) {
    const bytes = Buffer.from(JSON.stringify(data));
    return {
      endpoint, request: { url: `${DNP_API_BASE}/${endpoint}`, method: "POST", payload: { tenant_id: 1, council_id: 578, ...payload } },
      bytes, http_status: 200, content_sha256: digest(bytes), observed_at: generatedAt, fetched_at: generatedAt,
      snapshot_path: `fixtures/${endpoint}/${payload.schedule_id ?? "list"}.json`, mime_type: "application/json",
      etag: null, last_modified: null, byte_size: bytes.length,
    };
  }
  const captures = [
    capture("minutes/get_schedule", {}, { council_schedules: legacy.schedules.map(({ minutes: _minutes, ...schedule }) => schedule) }),
    ...legacy.schedules.map((schedule) => capture("minutes/get_minute", { schedule_id: schedule.schedule_id }, {
      tenant_minutes: schedule.minutes.map(({ text, ...minute }) => ({ ...minute, body: text })),
    })),
  ];
  const built = buildDnpCouncilRecordV2({ municipality, legacyCouncil: legacy, captures, generatedAt, codeRevision: "abcdef123", pipelineRunId: "sample:run:projection-test" });
  return { ...built, legacy };
}

function project(record, overrides = {}) {
  return projectCouncilRecordV2ToMinutes(record, { municipality, generatedAt, publicationIndex: [{ council_id: 578 }], ...overrides });
}

test("発言・非発言の混在順、空本文議題、欠番と日程間ID再使用を完全に往復する", () => {
  const { record, legacy, revisionContents } = fixture();
  const before = structuredClone(record);
  const validation = validateCouncilRecordV2(record, { revisionContents });
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  const projection = project(record);
  assert.deepEqual(projection.minutes, legacy);
  assert.deepEqual(record, before);
  assert.equal(record.turns.length, 3);
  assert.equal(record.document_items.length, 3);
  assert.equal(record.document_items.find((item) => item.legacy_ids.minute_id === 4).text_status, "empty_in_source");
  assert.equal(record.sittings[1].date, null);
  assert.ok(record.speakers.every((speaker) => speaker.person_id === null && speaker.identity_match.status === "unresolved"));
  assert.equal(projection.publication.public_visible, false);
  assert.equal(projection.provenance.minutes_sha256, digest(JSON.stringify(projection.minutes)));
  assert.equal(projection.provenance.input_revisions.length, 3);
});

test("コレクションの物理配列順に依存せず共通order_indexで復元する", () => {
  const { record, legacy } = fixture();
  record.turns.reverse();
  record.document_items.reverse();
  record.sittings.reverse();
  assert.deepEqual(project(record).minutes, legacy);
});

test("原典文書IDの有無を保持し、文書の容器を開催日として認定しない", () => {
  const { record, legacy, revisionContents } = fixture();
  record.sittings[1].unit_kind = "document";
  record.sittings[1].legacy_presentation.source_fino = 12345;
  legacy.schedules[1].source_fino = 12345;
  assert.deepEqual(project(record).minutes, legacy);
  assert.equal(Object.hasOwn(project(record).minutes.schedules[0], "source_fino"), false);
  assert.equal(validateCouncilRecordV2(record, { revisionContents }).ok, true);
  record.sittings[1].date = "2026-03-03";
  record.sittings[1].date_status = "exact";
  assert.equal(validateCouncilRecordV2(record, { revisionContents }).ok, false);
  record.sittings[1].legacy_presentation.source_fino = "12345";
  assert.throws(() => project(record), /invalid legacy source_fino/);
});

test("必要な互換メタデータ欠落、重複順序、同一日程の重複legacy IDを拒否する", () => {
  const missing = fixture().record;
  delete missing.turns[0].legacy_presentation;
  assert.throws(() => project(missing), /legacy_presentation/);
  const duplicateOrder = fixture().record;
  duplicateOrder.turns[0].order_index = duplicateOrder.document_items[0].order_index;
  assert.throws(() => project(duplicateOrder), /duplicate order_index/);
  const duplicateId = fixture().record;
  duplicateId.turns[0].legacy_ids.minute_id = duplicateId.document_items[0].legacy_ids.minute_id;
  assert.throws(() => project(duplicateId), /duplicate legacy minute_id/);
});

test("空の理由を削除した議題は受け入れず、本文の補完もしない", () => {
  const { record } = fixture();
  const agenda = record.document_items.find((item) => item.kind === "agenda");
  agenda.empty_reason = null;
  assert.equal(validateCouncilRecordV2(record).ok, false);
  assert.throws(() => project(record), /empty source state/);
  assert.equal(agenda.text_original, "");
});

test("stale、index外、restricted、hash不在では公開へ昇格しない", () => {
  for (const scenario of [
    { code: "stale_source_revision", change: (record) => { record.source_artifacts[0].current_revision_id = "sample:revision:newer"; }, options: {} },
    { code: "outside_publication_index", options: { publicationIndex: [] } },
    { code: "restricted", options: { municipality: { ...municipality, minutes_access: "restricted" } } },
    { code: "publication_index_hash_not_verified", options: {} },
  ]) {
    const { record, revisionContents } = fixture();
    scenario.change?.(record);
    const before = structuredClone(record.publication);
    const preview = project(record, scenario.options);
    assert.equal(preview.publication.public_visible, false);
    assert.ok(preview.publication.reason_codes.includes(scenario.code));
    assert.throws(() => project(record, { ...scenario.options, revisionContents, mode: "public" }), /public mode blocked/);
    assert.deepEqual(record.publication, before);
  }
});

test("公開フラグや呼出元の自己申告を証跡検証の代わりにしない", () => {
  const { record } = fixture();
  record.publication = { state: "public", public_visible: true, checked_at: generatedAt, published_at: generatedAt,
    gate_results: ["schema", "graph", "provenance", "content", "quality", "freshness", "review", "reconciliation"].map((gate) => ({ gate, status: "pass", detail: "claimed" })) };
  const preview = project(record);
  assert.throws(() => project(record, { mode: "public", currentRevisionIds: [...record.derivation.input_revision_ids],
    publicationIndex: [{ council_id: 578, content_sha256: preview.provenance.minutes_sha256 }],
    validationResult: { ok: true, publicationReady: true },
  }), /validation_not_publication_ready/);
});
