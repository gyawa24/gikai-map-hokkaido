import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { validateEbetsuData } from "../validate-ebetsu-20251002.mjs";
import { isMeetingDate, isStructuredMinutesRequest, matchesStructuredMinutesRequest, normalizeStructuredMinutes, validateStructuredMinutes } from "../../site/src/lib/structured-minutes/read-contract.mjs";

function fixture() {
  const position = { official_url: "https://example.com/minutes" };
  const extraction = { method: "rule_based_with_manual_review", confidence: 0.8, warnings: [], extractor_version: "legacy" };
  return {
    source_document: { official_url: position.official_url, meeting_date: "678" },
    speakers: [],
    turns: [{ id: "turn", text_original: "質問と答弁", meeting_date: "20250230", source_position: position, extraction }],
    question_blocks: [{ id: "question", turn_ids: ["turn"], agenda_titles: [], topic_block_ids: ["topic"], start_turn_id: "turn", end_turn_id: "turn", meeting_date: "2025-06-10", extraction }],
    topic_blocks: [{ id: "topic", question_block_id: "question", review_status: "auto", public_visible: true,
      related_turn_ids: ["turn"], topic_snippet_ids: ["snippet"], extraction,
      flow: [{ role: "question", turn_id: "turn", snippet_id: "snippet" }, { role: "answer", turn_id: "turn" }] }],
    topic_snippets: [{ id: "snippet", topic_block_id: "topic", turn_id: "turn", text_original: "質問", turn_char_start: 0, turn_char_end: 2, source_position: position, extraction }],
  };
}

test("会議IDと存在しない暦日を日付にせず、閏日は許可する", () => {
  for (const value of ["678", "20241001", "2025-02-29", "2025-02-30", "", null]) assert.equal(isMeetingDate(value), false);
  assert.equal(isMeetingDate("2024-02-29"), true);
});

test("underscoreを含む自治体slugを認め、別自治体・別会議の応答と不正なpathを拒否する", () => {
  assert.equal(isStructuredMinutesRequest("esashi_souya", "20241001"), true);
  const data = { source_document: { municipality_id: "esashi_souya", id: "esashi_souya-20241001" } };
  assert.equal(matchesStructuredMinutesRequest(data, "esashi_souya", "20241001"), true);
  assert.equal(matchesStructuredMinutesRequest(data, "esashi", "20241001"), false);
  assert.equal(matchesStructuredMinutesRequest(data, "esashi_souya", "20241002"), false);
  assert.equal(isStructuredMinutesRequest("../esashi", "20241001"), false);
  assert.equal(isStructuredMinutesRequest("esashi_souya", "../index"), false);
});

test("読み取り正規化は原文とIDを維持し、入力を変更せず、不明日付と確認不足を可視化する", () => {
  const raw = fixture();
  const before = structuredClone(raw);
  const { data } = normalizeStructuredMinutes(raw);
  assert.deepEqual(raw, before);
  assert.equal(data.source_document.meeting_date, "");
  assert.equal(data.turns[0].meeting_date, "");
  assert.equal(data.question_blocks[0].meeting_date, "2025-06-10");
  assert.equal(data.turns[0].id, raw.turns[0].id);
  assert.equal(data.turns[0].text_original, raw.turns[0].text_original);
  assert.equal(data.topic_blocks[0].public_visible, false);
  assert.equal(data.turns[0].extraction.method, "rule_based");
  assert.equal(data.read_quality.withheld_topic_count, 1);
  assert.equal(data.read_quality.freshness_status, "unverified");
});

test("reviewedラベルだけでは公開せず、記録が揃っても非公開を自動昇格しない", () => {
  const raw = fixture();
  raw.topic_blocks[0].review_status = "reviewed";
  assert.equal(normalizeStructuredMinutes(raw).data.topic_blocks[0].public_visible, false);
  raw.topic_blocks[0].extraction = { ...raw.topic_blocks[0].extraction, reviewed_by: "reviewer", reviewed_at: "2026-09-07T00:00:00Z" };
  assert.equal(normalizeStructuredMinutes(raw).data.topic_blocks[0].public_visible, true);
  raw.topic_blocks[0].public_visible = false;
  assert.equal(normalizeStructuredMinutes(raw).data.topic_blocks[0].public_visible, false);
});

test("壊れた参照・抜粋範囲・重複IDを拒否する", () => {
  const raw = fixture();
  raw.topic_snippets[0].turn_char_end = 99;
  assert.equal(normalizeStructuredMinutes(raw).data, null);
  const broken = fixture();
  broken.topic_blocks[0].flow[0].turn_id = "missing";
  assert.equal(validateStructuredMinutes(broken).ok, false);
  const duplicate = fixture();
  duplicate.turns.push(duplicate.turns[0]);
  assert.equal(validateStructuredMinutes(duplicate).ok, false);
  assert.equal(validateStructuredMinutes({}).ok, false);
});

test("本番の保存済み全会議を原文再抽出なしで安全に読み取れる", () => {
  const root = fileURLToPath(new URL("../../site/data/structured-minutes/", import.meta.url));
  let files = 0;
  let withheld = 0;
  for (const city of fs.readdirSync(root)) {
    for (const name of fs.readdirSync(`${root}/${city}`).filter((name) => name.endsWith(".json"))) {
      const raw = JSON.parse(fs.readFileSync(`${root}/${city}/${name}`, "utf8"));
      assert.equal(matchesStructuredMinutesRequest(raw, city, name.replace(/\.json$/u, "")), true);
      const { data, validation } = normalizeStructuredMinutes(raw);
      assert.ok(data, `${city}/${name}: ${validation.errors.join("; ")}`);
      assert.deepEqual(data.turns.map((turn) => [turn.id, turn.text_original]), raw.turns.map((turn) => [turn.id, turn.text_original]));
      assert.deepEqual(data.topic_snippets.map((snippet) => [snippet.id, snippet.text_original]), raw.topic_snippets.map((snippet) => [snippet.id, snippet.text_original]));
      assert.ok(data.turns.every((turn) => turn.meeting_date === "" || isMeetingDate(turn.meeting_date)));
      assert.ok(data.topic_blocks.every((topic) => !topic.public_visible || topic.review_status === "reviewed"));
      assert.equal(data.read_quality.provenance_status, "unverified");
      withheld += data.read_quality.withheld_topic_count;
      files += 1;
    }
  }
  assert.ok(files >= 54);
  assert.ok(withheld > 0);
});

test("江別の個別validatorは保存済みv3と公開ゲート適用済みv4の双方を検証する", (t) => {
  if (!fs.existsSync(new URL("../../site/data/ebetsu/turns/20251002.json", import.meta.url))) {
    t.skip("本番には未収録の20251002 fixture。私用枝の原文データは移植しない");
    return;
  }
  const read = (relative) => JSON.parse(fs.readFileSync(new URL(`../../${relative}`, import.meta.url), "utf8"));
  const sourceText = fs.readFileSync(new URL("../../site/data/ebetsu/turns/20251002.json", import.meta.url), "utf8");
  const input = {
    minutes: read("data/ebetsu/minutes/20251002.json"),
    turnsData: read("data/ebetsu/turns/20251002.json"),
    rawStructured: read("data/structured-minutes/ebetsu/20251002.json"),
    siteTurnsData: read("site/data/ebetsu/turns/20251002.json"),
    siteStructured: read("site/data/structured-minutes/ebetsu/20251002.json"),
    sourceText,
  };
  validateEbetsuData(input);
  const next = normalizeStructuredMinutes(input.rawStructured).data;
  next.source_document.extractor_version = "ebetsu-structured-minutes-v4-2026-09-07";
  next.generation = { generator: next.source_document.extractor_version, input_sha256: createHash("sha256").update(sourceText).digest("hex"), input_path: "site/data/ebetsu/turns/20251002.json", generated_at: "2026-09-07T00:00:00Z" };
  const updated = { ...input, rawStructured: next, siteStructured: structuredClone(next) };
  validateEbetsuData(updated);
  next.generation.input_sha256 = "0".repeat(64);
  assert.throws(() => validateEbetsuData({ ...updated, siteStructured: structuredClone(next) }), /input hash must match source turns/);
});
