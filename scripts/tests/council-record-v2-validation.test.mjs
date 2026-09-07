import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadRevisionContents } from "../validate-council-record-v2.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deriveCouncilRecordRevisionContent, validateCouncilRecordV2 } from "../lib/council-record-v2-validation.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const stamp = "2026-09-07T00:00:00Z";
const review = () => ({ status: "auto", reviewed_by: null, reviewed_at: null, notes: [] });
const extraction = () => ({ method: "rule_based", confidence: 1, extractor_name: "synthetic-test", extractor_version: "1", pipeline_run_id: "test:run", warnings: [] });
const publication = () => ({ status: "internal_preview", public_visible: false, reason_codes: ["test_fixture"] });

export function fixture() {
  const providerMinutes = new Map([["1", "名簿"], ["2", "質問本文"], ["3", "答弁本文"]]);
  const bytes = Buffer.from(JSON.stringify({ tenant_minutes: [...providerMinutes].map(([minute_id, body]) => ({ minute_id: Number(minute_id), body, title: minute_id === "1" ? "名簿" : minute_id === "2" ? "questioner" : "respondent", minute_type: minute_id === "1" ? "名簿" : "発言" })) }));
  const text = JSON.stringify([...providerMinutes.values()]);
  const span = (id) => ({ source_artifact_id: "test:source", source_revision_id: "test:revision", provider_minute_id: id });
  const shared = { municipality_id: "chitose", meeting_id: "test:meeting", sitting_id: "test:sitting" };
  const record = {
    schema_version: "2.0", record_id: "test:record", municipality_id: "chitose", record_status: "official",
    meeting: { id: "test:meeting", municipality_id: "chitose", title_original: "Synthetic test meeting", kind: "regular", year: 2026, sequence: 1,
      start_date: "2026-03-02", end_date: "2026-03-02", date_status: "exact", sitting_ids: ["test:sitting"], external_ids: {}, legacy_ids: { council_id: 578 } },
    sittings: [{ id: "test:sitting", municipality_id: "chitose", meeting_id: "test:meeting", order_index: 1, title_original: "Synthetic test sitting",
      date: "2026-03-02", date_status: "exact", source_artifact_ids: ["test:source"], external_ids: {}, legacy_ids: { council_id: 578, schedule_id: 2 } }],
    source_artifacts: [{ id: "test:source", municipality_id: "chitose", authority: "official", kind: "api_json", record_status: "official", title: "Synthetic test source", landing_url: "https://ssp.kaigiroku.net/tenant/chitose/MinuteBrowse.html", content_url: "https://ssp.kaigiroku.net/dnp/search/minutes/get_minute", current_revision_id: "test:revision", external_ids: { tenant_id: 452, council_id: 578, schedule_id: 2 },
      revisions: [{ id: "test:revision", observed_at: stamp, fetched_at: stamp, retrieval_status: "fetched", parse_status: "parsed", content_sha256: hash(bytes), extracted_text_sha256: hash(text), snapshot_path: "fixtures/synthetic.json", mime_type: "application/json", byte_size: bytes.length }] }],
    speakers: ["questioner", "respondent"].map((name) => ({ id: `test:${name}`, municipality_id: "chitose", name_original: name, name_normalized: name, speaker_type: "unknown", aliases: [], person_id: null, membership_id: null,
      identity_match: { status: "unresolved", method: "none", confidence: null, candidate_person_ids: [] } })),
    turns: [2, 3].map((id) => ({ id: `test:turn:${id}`, ...shared, order_index: id, speaker_id: id === 2 ? "test:questioner" : "test:respondent", speaker_name_original: id === 2 ? "questioner" : "respondent", speaker_type: "unknown", turn_type: id === 2 ? "question" : "answer", text_original: providerMinutes.get(String(id)), source_span: span(id), extraction: extraction(), review: review(), legacy_ids: { council_id: 578, schedule_id: 2, minute_id: id } })),
    document_items: [{ id: "test:doc:1", ...shared, order_index: 1, kind: "roster", text_original: "名簿", text_status: "present", empty_reason: null, source_span: span(1), extraction: extraction(), review: review(), legacy_ids: { council_id: 578, schedule_id: 2, minute_id: 1 }, legacy_presentation: { title: "名簿", minute_type: "名簿" } }],
    question_blocks: [{ id: "test:question", ...shared, order_index: 1, questioner_speaker_id: "test:questioner", question_kind: "general", title_original: "Synthetic question", agenda_titles: [], turn_ids: ["test:turn:2", "test:turn:3"], topic_block_ids: ["test:topic"], start_turn_id: "test:turn:2", end_turn_id: "test:turn:3",
      preferred_evidence: { status: "preferred", source_artifact_id: "test:source", source_revision_id: "test:revision", turn_ids: ["test:turn:2", "test:turn:3"] },
      evidence_variants: [{ status: "preferred", source_artifact_id: "test:source", source_revision_id: "test:revision", turn_ids: ["test:turn:2", "test:turn:3"] }], source_span: span(2), extraction: extraction(), review: review(), publication: publication(), legacy_ids: {} }],
    topic_blocks: [{ id: "test:topic", ...shared, question_block_id: "test:question", order_index: 1, title_original: "Synthetic topic", policy_area_tags: [], topic_tags: [], related_turn_ids: ["test:turn:2", "test:turn:3"], topic_snippet_ids: ["test:snippet"],
      flow: [{ role: "question", turn_id: "test:turn:2", snippet_id: "test:snippet", speaker_id: "test:questioner", label: "質問" }, { role: "answer", turn_id: "test:turn:3", snippet_id: null, speaker_id: "test:respondent", label: "答弁" }], source_span: span(2), extraction: extraction(), review: review(), publication: publication() }],
    topic_snippets: [{ id: "test:snippet", topic_block_id: "test:topic", turn_id: "test:turn:2", order_index: 1, snippet_role: "question", text_original: "質問", turn_char_start: 0, turn_char_end: 2, source_span: span(2), extraction: extraction(), review: review() }],
    reconciliations: [],
    derivation: { pipeline_run_id: "test:run", generated_at: stamp, code_revision: "fixture", generator: { name: "synthetic-test", version: "1" }, input_revision_ids: ["test:revision"], validation: { status: "fail", checked_at: stamp, validator_version: "pending", errors: ["pending"], warnings: [] } },
    publication: { state: "internal_preview", public_visible: false, checked_at: stamp, published_at: null, gate_results: [{ gate: "review", status: "fail", detail: "synthetic fixture is not reviewed" }] },
  };
  return { record, revisionContents: new Map([["test:revision", { bytes, text, providerMinuteIds: [...providerMinutes.keys()], providerMinutes }]]) };
}

test("schema2020-12と全参照・原典本文を検証し、previewを公開許可へ昇格しない", () => {
  const { record, revisionContents } = fixture();
  const before = structuredClone(record);
  const result = validateCouncilRecordV2(record, { revisionContents });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.ok, true);
  assert.equal(result.publicationReady, false);
  assert.deepEqual(record, before);
});

for (const [name, gate, mutate] of [
  ["DNP親external会議取り違え", "graph", (r) => { r.meeting.external_ids.council_id = 999; }],
  ["DNP親external日程取り違え", "graph", (r) => { r.sittings[0].external_ids.schedule_id = 999; }],
  ["DNP固定endpoint取り違え", "provenance", (r) => { r.source_artifacts[0].content_url = "https://ssp.kaigiroku.net/dnp/search/minutes/get_schedule"; }],
  ["DNP landing自治体取り違え", "provenance", (r) => { r.source_artifacts[0].landing_url = "https://ssp.kaigiroku.net/tenant/eniwa/MinuteBrowse.html"; }],
  ["DNP source会議取り違え", "graph", (r) => { r.source_artifacts[0].external_ids.council_id = 999; }],
  ["DNP source日程取り違え", "graph", (r) => { r.source_artifacts[0].external_ids.schedule_id = 999; }],
  ["DNP source tenant欠落", "provenance", (r) => { delete r.source_artifacts[0].external_ids.tenant_id; }],
  ["不正な暦日", "schema", (r) => { r.sittings[0].date = "2026-02-30"; }],
  ["dependentRequired片側だけの範囲", "schema", (r) => { r.turns[0].source_span.page_start = 1; }],
  ["許可されない追加field", "schema", (r) => { r.speakers[0].invented = true; }],
  ["自治体取り違え", "graph", (r) => { r.turns[0].municipality_id = "eniwa"; }],
  ["別会議参照", "graph", (r) => { r.turns[0].meeting_id = "test:other"; }],
  ["TurnとDocの順序衝突", "graph", (r) => { r.document_items[0].order_index = 2; }],
  ["原典item欠落", "content", (r) => { r.document_items = []; }],
  ["原典順序変更", "content", (r) => { r.turns[0].order_index = 3; r.turns[1].order_index = 2; }],
  ["原文改変", "content", (r) => { r.turns[0].text_original = "改変"; }],
  ["抜粋offset不一致", "content", (r) => { r.topic_snippets[0].turn_char_start = 1; }],
  ["legacy minuteと原典locator取り違え", "graph", (r) => { r.turns[0].legacy_ids.minute_id = 999; }],
  ["legacy scheduleと親日程取り違え", "graph", (r) => { r.turns[0].legacy_ids.schedule_id = 999; }],
  ["Turn speaker種別取り違え", "graph", (r) => { r.turns[0].speaker_type = "mayor"; }],
  ["Turn発言者名取り違え", "graph", (r) => { r.turns[0].speaker_name_original = "別人"; }],
  ["質問者取り違え", "graph", (r) => { r.question_blocks[0].questioner_speaker_id = "test:respondent"; }],
  ["質問時系列逆転", "graph", (r) => { const q = r.question_blocks[0]; q.turn_ids.reverse(); [q.start_turn_id, q.end_turn_id] = [q.end_turn_id, q.start_turn_id]; }],
  ["Topic flow時系列逆転", "graph", (r) => { r.topic_blocks[0].flow.reverse(); }],
  ["SpeakerとTurnの同時改名", "content", (r) => { r.speakers[1].name_original = r.speakers[1].name_normalized = r.turns[1].speaker_name_original = "別人"; }],
  ["質問根拠が質問範囲を超える", "graph", (r) => { r.question_blocks[0].turn_ids = ["test:turn:2"]; r.question_blocks[0].end_turn_id = "test:turn:2"; r.topic_blocks[0].related_turn_ids = ["test:turn:2"]; r.topic_blocks[0].flow = r.topic_blocks[0].flow.slice(0, 1); }],
  ["flow発言者取り違え", "graph", (r) => { r.topic_blocks[0].flow[0].speaker_id = "test:respondent"; }],
  ["参照先revision消失", "graph", (r) => { r.turns[0].source_span.source_revision_id = "test:missing"; }],
  ["入力revisionの取り違え", "freshness", (r) => { r.source_artifacts[0].current_revision_id = null; }],
  ["入力取得前の生成", "freshness", (r) => { r.derivation.generated_at = "2026-01-01T00:00:00Z"; }],
  ["架空review証跡", "review", (r) => { r.turns[0].review.reviewed_by = "not-actually-reviewed"; }],
  ["review未完のTopic公開", "schema", (r) => { r.topic_blocks[0].publication.public_visible = true; }],
]) test(name, () => {
  const { record, revisionContents } = fixture();
  mutate(record);
  const result = validateCouncilRecordV2(record, { revisionContents });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.gate === gate), JSON.stringify(result.errors));
});

test("snapshot hash・本文hashの両方を照合する", () => {
  const { record, revisionContents } = fixture();
  revisionContents.get("test:revision").bytes = Buffer.from("changed");
  revisionContents.get("test:revision").text = "changed";
  const result = validateCouncilRecordV2(record, { revisionContents });
  assert.ok(result.errors.some((item) => item.message.includes("content hash mismatch")));
  assert.ok(result.errors.some((item) => item.message.includes("text hash mismatch")));
});

test("証跡未供給を未確認として保持し、public gateをすり抜けない", () => {
  const { record } = fixture();
  const result = validateCouncilRecordV2(record);
  assert.equal(result.ok, true);
  assert.equal(result.publicationReady, false);
  assert.ok(result.warnings.some((item) => item.gate === "provenance"));
  record.publication = { ...record.publication, state: "public", public_visible: true, published_at: stamp };
  assert.equal(validateCouncilRecordV2(record).ok, false);
});

test("公開済みIDのlegacy対応を別発言へ再割当できない", () => {
  const { record, revisionContents } = fixture();
  const previousRecord = structuredClone(record);
  record.turns[0].legacy_ids.minute_id = 999;
  const result = validateCouncilRecordV2(record, { revisionContents, previousRecord });
  assert.ok(result.errors.some((item) => item.message.includes("reassigned")));
});

test("provider mapの削除・偽装で原典本文比較を回避できない", () => {
  const { record, revisionContents } = fixture();
  revisionContents.get("test:revision").providerMinutes = {};
  record.turns[1].text_original = "原典にはない偽の答弁";
  const result = validateCouncilRecordV2(record, { revisionContents });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.message.includes("text_original differs")));
});
test("schema失敗で未実行の検証をpassとしない", () => {
  const { record } = fixture();
  record.sittings[0].date = "2026-02-30";
  const result = validateCouncilRecordV2(record);
  assert.ok(result.gateResults.filter((item) => item.gate !== "schema").every((item) => item.status === "not_applicable"));
});

test("legacy identityを維持した一括ID再採番を拒否する", () => {
  const { record, revisionContents } = fixture();
  const previousRecord = structuredClone(record);
  const changed = JSON.parse(JSON.stringify(record).replaceAll("test:turn:2", "test:turn:222"));
  const result = validateCouncilRecordV2(changed, { revisionContents, previousRecord });
  assert.ok(result.errors.some((item) => item.message.includes("new entity ID")));
});
test("日程order_index衝突を拒否する", () => {
  const { record, revisionContents } = fixture();
  const sitting = { ...structuredClone(record.sittings[0]), id: "test:sitting:other", legacy_ids: { schedule_id: 3 } };
  record.sittings.push(sitting);
  record.meeting.sitting_ids.push(sitting.id);
  const result = validateCouncilRecordV2(record, { revisionContents });
  assert.ok(result.errors.some((item) => item.message.includes("duplicate sitting")));
});
test("同revision内の別発言を指すsnippet原典位置を拒否する", () => {
  const { record, revisionContents } = fixture();
  record.topic_snippets[0].source_span.provider_minute_id = "3";
  const result = validateCouncilRecordV2(record, { revisionContents });
  assert.ok(result.errors.some((item) => item.message.includes("snippet provider minute")));
});

test("日程原題とlegacy presentationの食い違いを拒否する", () => {
  const { record, revisionContents } = fixture();
  record.sittings[0].legacy_presentation = { name: "元の日程" };
  const result = validateCouncilRecordV2(record, { revisionContents });
  assert.ok(result.errors.some((item) => item.message.includes("sitting title differs")));
});
test("鮮度とcalendarの検証範囲を独立認証と誤表示しない", () => {
  const { record, revisionContents } = fixture();
  const result = validateCouncilRecordV2(record, { revisionContents });
  assert.match(result.gateResults.find((item) => item.gate === "freshness").detail, /not independently certified/u);
  assert.match(result.gateResults.find((item) => item.gate === "content").detail, /not independently certified/u);
});

function documentFixture({ body = "<p>Original &amp; text</p>" } = {}) {
  const { record } = fixture();
  record.turns = []; record.speakers = []; record.question_blocks = []; record.topic_blocks = []; record.topic_snippets = [];
  Object.assign(record.meeting, { start_date: null, end_date: null, date_status: "unknown", date_note: "Source is a document unit." });
  Object.assign(record.sittings[0], { title_original: "Document 1", date: null, date_status: "unknown", date_note: "Source is a document unit.", unit_kind: "document", legacy_presentation: { name: "Document 1", source_fino: 17 } });
  const sourceTemplate = structuredClone(record.source_artifacts[0]);
  const revisionContents = new Map();
  record.source_artifacts = [
    ["ACT100", `<A onClick="winopen('voiweb.exe?ACT=200&KGNO=578&FINO=17&UNID=U1&TITL_SUBT=Synthetic%20test%20meeting')">Document 1</A>`],
    ["ACT200", '<frame src="voiweb.exe?ACT=203&HUID=9">'],
    ["ACT203", body],
  ].map(([act, html]) => {
    const source = structuredClone(sourceTemplate);
    source.id = `test:source:${act}`;
    source.kind = "html";
    source.external_ids = { provider: "gijiroku_com", act, kgno: 578, ...(act === "ACT100" ? {} : { fino: 17, unid: "U1" }), ...(act === "ACT203" ? { huid: "9" } : {}) };
    const query = new URLSearchParams({ ACT: act.slice(3), FYY: "2026", TYY: "2026", ...(act === "ACT200" ? { KGNO: "578", FINO: "17", UNID: "U1" } : act === "ACT203" ? { FINO: "17", HUID: "9" } : {}) });
    source.content_url = `https://iwamizawa-gikai.gijiroku.com/voices/cgi/voiweb.exe?${query}`;
    source.landing_url = null;
    const content = deriveCouncilRecordRevisionContent(source, Buffer.from(html));
    const revision = source.revisions[0];
    revision.id = `${source.id}:revision`;
    revision.content_sha256 = hash(content.bytes); revision.byte_size = content.bytes.length;
    revision.extracted_text_sha256 = content.text === null ? null : hash(content.text);
    source.current_revision_id = revision.id;
    revisionContents.set(revision.id, content);
    return source;
  });
  const source = record.source_artifacts[2];
  const text = revisionContents.get(source.current_revision_id).text;
  record.sittings[0].source_artifact_ids = [source.id];
  record.derivation.input_revision_ids = record.source_artifacts.map((item) => item.current_revision_id);
  Object.assign(record.document_items[0], { text_original: text, text_status: text ? "present" : "empty_in_source", empty_reason: text ? null : "Captured body is empty.",
    legacy_presentation: { title: "Full document", minute_type: "本会議" },
    source_span: { source_artifact_id: source.id, source_revision_id: source.current_revision_id, document_char_start: 0, document_char_end: text.length } });
  return { record, revisionContents };
}

test("gijiroku目次・frameset・全文DocumentItemをbytesから独立照合する", () => {
  const { record, revisionContents } = documentFixture();
  const result = validateCouncilRecordV2(record, { revisionContents });
  assert.deepEqual(result.errors, []); assert.deepEqual(result.warnings, []);
  assert.equal(result.publicationReady, false);
});

test("gijiroku空原典を発言に変えず0..0のDocumentItemとして検証する", () => {
  const { record, revisionContents } = documentFixture({ body: "<html><script>hidden</script></html>" });
  assert.equal(record.document_items[0].text_original, "");
  const result = validateCouncilRecordV2(record, { revisionContents });
  assert.deepEqual(result.errors, []); assert.deepEqual(result.warnings, []);
});

for (const [name, mutate] of [
  ["ACT100目次sourceの会議取り違え", (r) => { r.source_artifacts[0].external_ids.kgno = 999; }],
  ["ACT203 URL FINO取り違え", (r) => { r.source_artifacts[2].content_url = r.source_artifacts[2].content_url.replace("FINO=17", "FINO=999"); }],
  ["ACT203別origin URL", (r) => { r.source_artifacts[2].content_url = "https://example.com/not-source"; }],
  ["sitting external FINO取り違え", (r) => { r.sittings[0].external_ids.fino = 999; }],
  ["caller textとrecord/hashの同時偽装", (r, c) => { const body = r.source_artifacts[2]; const fake = "Invented"; c.get(body.current_revision_id).text = fake; body.revisions[0].extracted_text_sha256 = hash(fake); r.document_items[0].text_original = fake; r.document_items[0].source_span.document_char_end = fake.length; }],
  ["caller目次mapの偽装", (r, c) => { const body = r.source_artifacts[2]; body.external_ids.unid = "WRONG"; c.get(r.source_artifacts[0].current_revision_id).meetings[0].unid = "WRONG"; }],
  ["ACT200と203のHUID取り違え", (r) => { r.source_artifacts[2].external_ids.huid = "99"; }],
  ["原典目次にない文書名", (r) => { r.sittings[0].title_original = r.sittings[0].legacy_presentation.name = "Different document"; }],
  ["legacy source_finoの取り違え", (r) => { r.sittings[0].legacy_presentation.source_fino = 99; }],
  ["全文の一部だけへ短縮", (r) => { r.document_items[0].text_original = "Original"; r.document_items[0].source_span.document_char_end = 8; }],
  ["全文DocumentItemの欠落", (r) => { r.document_items = []; }],
]) test(`gijiroku ${name}を拒否する`, () => {
  const { record, revisionContents } = documentFixture(); mutate(record, revisionContents);
  assert.equal(validateCouncilRecordV2(record, { revisionContents }).ok, false);
});

test("text形式はcaller textでなくUTF8 bytesの原文と比較する", () => {
  const { record, revisionContents } = documentFixture();
  const source = record.source_artifacts[2];
  source.kind = "text"; source.external_ids = {};
  record.source_artifacts = [source]; record.derivation.input_revision_ids = [source.current_revision_id];
  const bytes = Buffer.from("Actual original text");
  Object.assign(source.revisions[0], { content_sha256: hash(bytes), byte_size: bytes.length, extracted_text_sha256: hash("Invented") });
  revisionContents.set(source.current_revision_id, { bytes, text: "Invented" });
  Object.assign(record.document_items[0], { text_original: "Invented", source_span: { ...record.document_items[0].source_span, document_char_end: 8 } });
  const result = validateCouncilRecordV2(record, { revisionContents });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.message.includes("snapshot bytes")));
});

test("未実装HTML/PDF parserのcaller textを独立確認済みにしない", () => {
  for (const kind of ["html", "pdf"]) {
    const { record, revisionContents } = documentFixture();
    const source = record.source_artifacts[2]; source.kind = kind; source.external_ids = {};
    record.source_artifacts = [source]; record.derivation.input_revision_ids = [source.current_revision_id];
    const result = validateCouncilRecordV2(record, { revisionContents });
    assert.equal(result.ok, true);
    assert.ok(result.warnings.some((item) => item.message.includes("no independent parser")));
    assert.equal(result.gateResults.find((item) => item.gate === "provenance").status, "fail");
  }
});

test("offline CLI loaderも原典HTMLから同じ内容を再導出する", async (t) => {
  const { record, revisionContents } = documentFixture();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "v2-gijiroku-validator-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const source of record.source_artifacts) {
    const revision = source.revisions[0];
    revision.snapshot_path = `${source.external_ids.act}.html`;
    fs.writeFileSync(path.join(root, revision.snapshot_path), revisionContents.get(revision.id).bytes);
  }
  const loaded = await loadRevisionContents(record, root);
  assert.equal(loaded.get(record.source_artifacts[2].current_revision_id).text, "Original & text");
  const result = validateCouncilRecordV2(record, { revisionContents: loaded });
  assert.deepEqual(result.errors, []); assert.deepEqual(result.warnings, []);
});

test("自治体台帳を渡した場合はgijiroku originとDNP tenantも照合する", () => {
  const dnp = fixture();
  assert.equal(validateCouncilRecordV2(dnp.record, { revisionContents: dnp.revisionContents, municipality: { slug: "chitose", system: "dnp", tenant_id: 999 } }).ok, false);
  const html = documentFixture();
  assert.equal(validateCouncilRecordV2(html.record, { revisionContents: html.revisionContents, municipality: { slug: "chitose", system: "gijiroku_com", gijiroku_subdomain: "wrong-town" } }).ok, false);
});
