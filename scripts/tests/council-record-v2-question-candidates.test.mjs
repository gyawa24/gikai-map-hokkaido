import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { buildDnpCouncilRecordV2, DNP_API_BASE, sha256 } from "../lib/dnp-council-record-v2.mjs";
import { validateCouncilRecordV2 } from "../lib/council-record-v2-validation.mjs";
import { createQuestionCandidateReport, mapQuestionCandidate, parseSourceQuestionCandidates, compareQuestionCandidates } from "../lib/council-record-v2-question-candidates.mjs";

const stamp = "2026-09-07T00:00:02Z";
function fixture() {
  const municipality = { slug: "sample-town", system: "dnp", tenant_id: 1 };
  const questionMinutes = [
    { minute_id: 1, title: "名簿", minute_type: "名簿", text: "" },
    { minute_id: 2, title: "佐藤花子議員の一般質問", minute_type: "△議題", text: "△佐藤花子議員の一般質問" },
    { minute_id: 3, title: "議長", minute_type: "○議長", text: "○議長　佐藤花子議員の質問を許可します。" },
    { minute_id: 4, title: "山田太郎委員長", minute_type: "◆質問", text: "◆山田太郎委員長　御報告いたします。委員会の審査結果を報告します。" },
    { minute_id: 5, title: "佐藤花子議員", minute_type: "◆質問", text: "◆佐藤花子議員　市の計画について伺います。" },
    { minute_id: 6, title: "市長", minute_type: "◎答弁", text: "◎市長　計画についてお答えします。" },
    { minute_id: 7, title: "議長", minute_type: "○議長", text: "○議長　佐藤花子議員の一般質問は終了しました。" },
  ];
  const legacyCouncil = { council_id: 10, name: "令和8年第1回定例会", year: "2026", japanese_year: "令和8年", type_label: "本会議",
    schedules: [2, 3].map((id) => ({ schedule_id: id, name: `03月0${id}日－01号`, page_no: id, minutes: structuredClone(questionMinutes) })) };
  function capture(endpoint, schedule, body) {
    const bytes = Buffer.from(JSON.stringify(body));
    return { endpoint, request: { method: "POST", url: `${DNP_API_BASE}/${endpoint}`, payload: { tenant_id: 1, council_id: 10, ...(schedule ? { schedule_id: schedule.schedule_id } : {}) } },
      bytes, observed_at: "2026-09-07T00:00:00Z", fetched_at: "2026-09-07T00:00:01Z", content_sha256: sha256(bytes), byte_size: bytes.length,
      mime_type: "application/json", http_status: 200, etag: null, last_modified: null, snapshot_path: `reports/synthetic/${sha256(bytes)}.json` };
  }
  const captures = [capture("minutes/get_schedule", null, { council_schedules: legacyCouncil.schedules.map(({ minutes, ...schedule }) => schedule) }),
    ...legacyCouncil.schedules.map((schedule) => capture("minutes/get_minute", schedule, { tenant_minutes: schedule.minutes.map(({ text, ...minute }) => ({ ...minute, body: text })) }))];
  const { record, revisionContents } = buildDnpCouncilRecordV2({ municipality, legacyCouncil, captures, generatedAt: stamp, codeRevision: "test-fixture", pipelineRunId: "test" });
  assert.deepEqual(validateCouncilRecordV2(record, { revisionContents }).errors, []);
  return { record, bundle: { municipality, legacyCouncil, revisionContents }, generatedAt: stamp, baselineActivity: null };
}

test("原典ラベルだけから候補を作り同名・同minute IDの別日程を分離する", () => {
  const args = fixture();
  const before = structuredClone(args.record);
  const report = createQuestionCandidateReport(args);
  assert.equal(report.candidate_count, 2);
  assert.notEqual(report.candidates[0].id, report.candidates[1].id);
  for (const candidate of report.candidates) {
    assert.equal(candidate.questioner.identity_status, "unresolved");
    assert.deepEqual(candidate.questioner.label_originals, ["佐藤花子議員"]);
    assert.equal(candidate.question_turns.length, 1);
    assert.ok(candidate.question_turns.every((turn) => args.record.turns.find((item) => item.id === turn.turn_id).sitting_id === candidate.sitting_id));
    assert.equal(candidate.publication.public_visible, false);
  }
  assert.deepEqual(args.record, before);
  assert.deepEqual(args.record.question_blocks, []);
  assert.doesNotMatch(JSON.stringify(report), /"(?:person_id|membership_id)"/);
  assert.equal(report.comparison.baseline_status, "unavailable");
  assert.equal(report.comparison.difference_count, null);
});

test("委員長報告は質問証拠にせず未分類一覧に残す", () => {
  const report = createQuestionCandidateReport(fixture());
  assert.equal(report.unclassified_turn_count, 2);
  assert.ok(report.unclassified_turns.every((item) => item.speaker_name_original === "山田太郎委員長"));
  assert.ok(report.candidates.every((item) => item.legacy_comparison.evidence_minute_ids.join() === "5"));
});

test("別質問者への境界誤接続と一般から代表への引き継ぎを防ぐ", () => {
  const { bundle } = fixture();
  const meeting = structuredClone(bundle.legacyCouncil);
  meeting.schedules = [meeting.schedules[0]];
  meeting.schedules[0].minutes.push(
    { minute_id: 8, title: "鈴木太郎議員の代表質問", minute_type: "△議題", text: "△鈴木太郎議員の代表質問" },
    { minute_id: 9, title: "鈴木太郎議員", minute_type: "◆質問", text: "◆鈴木太郎議員　予算について伺います。" },
    { minute_id: 10, title: "議長", minute_type: "○議長", text: "○議長　鈴木太郎議員の代表質問は終了しました。" },
  );
  const { blocks } = parseSourceQuestionCandidates(meeting);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks.map((item) => item.questionKind), ["general_question", "representative_question"]);
  assert.deepEqual(blocks.map((item) => item.minuteIds), [[5], [9]]);
  assert.equal(blocks[0].endMinuteId, 7);
});

test("異なる日程にしかない境界・範囲外の発言証拠を拒否する", () => {
  const { record, bundle } = fixture();
  const block = parseSourceQuestionCandidates(bundle.legacyCouncil).blocks[0];
  assert.throws(() => mapQuestionCandidate(record, { ...block, endMinuteId: 999 }), /boundary/);
  assert.throws(() => mapQuestionCandidate(record, { ...block, markerMinuteId: 6 }), /outside/);
  assert.throws(() => mapQuestionCandidate(record, { ...block, scheduleId: 999 }), /sitting/);
});

test("原文deepEqual不一致・manifest証跡不足・public化を候補生成前に拒否する", () => {
  const changed = fixture(); changed.bundle.legacyCouncil.name = "別会議";
  assert.throws(() => createQuestionCandidateReport(changed), /must equal/);
  const missing = fixture(); missing.bundle.revisionContents = new Map();
  assert.throws(() => createQuestionCandidateReport(missing), /evidence is incomplete/);
  const published = fixture(); published.record.publication.public_visible = true;
  assert.throws(() => createQuestionCandidateReport(published));
});

test("既存履歴を生成入力にせず差分と未確認を区別する", () => {
  const report = createQuestionCandidateReport(fixture());
  const baseline = { synthetic: { sessions: report.candidates.map((item, index) => ({ ...item.legacy_comparison, record_id: `baseline:${index}` })) } };
  const same = compareQuestionCandidates(report.candidates, baseline, 10);
  assert.equal(same.matched_count, 2); assert.equal(same.difference_count, 0);
  baseline.synthetic.sessions[0].end_minute_id = 99;
  const changed = compareQuestionCandidates(report.candidates, baseline, 10);
  assert.equal(changed.difference_count, 1);
  assert.equal(changed.differences[0].kind, "boundary_changed");
  assert.throws(() => compareQuestionCandidates(report.candidates, { bad: {} }, 10), /sessions/);
});

test("同じ既存履歴への候補二重照合を一致件数へ加算しない", () => {
  const report = createQuestionCandidateReport(fixture());
  const candidate = report.candidates[0];
  const result = compareQuestionCandidates([candidate, candidate], { synthetic: { sessions: [{ ...candidate.legacy_comparison, record_id: "one" }] } }, 10);
  assert.equal(result.baseline_count, 1);
  assert.equal(result.matched_count, 1);
  assert.equal(result.difference_count, 1);
  assert.equal(result.differences[0].kind, "duplicate_candidate_match");
});

test("shared parser importは書込みを起動せずsymlink経由CLIは実行される", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "question-parser-import-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = fileURLToPath(new URL("../../site/scripts/build-member-activity.mjs", import.meta.url));
  const target = path.join(root, "parser.mjs");
  const link = path.join(root, "linked-parser.mjs");
  fs.copyFileSync(source, target); fs.symlinkSync(target, link);
  assert.equal(execFileSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(new URL(`file://${target}`).href)})`], { encoding: "utf8", cwd: root }), "");
  const direct = spawnSync(process.execPath, [target], { encoding: "utf8" });
  const linked = spawnSync(process.execPath, [link], { encoding: "utf8" });
  assert.equal(direct.status, 1);
  assert.equal(linked.status, 1);
  assert.match(linked.stderr, /ENOENT/);
  assert.deepEqual(fs.readdirSync(root).sort(), ["linked-parser.mjs", "parser.mjs"]);
});
