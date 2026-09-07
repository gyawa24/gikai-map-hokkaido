import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getPublishedMinutesIndexResult } from "../../site/src/lib/minutesPublication.ts";
import { isMinutesSession } from "../../site/src/lib/minutesSessionValidation.ts";
import { buildMinutesCitation, getMinutesSource, safeMinutesSourceUrl } from "../../site/src/lib/minutesSource.ts";
import { selectedMinutesSchedule } from "../../site/src/lib/minutesReaderState.ts";
import { minutesContentLabel, minutesScheduleUnit } from "../../site/src/lib/minutesPresentation.ts";

const indexItem = { council_id: 12, file: "12.json", name: "令和8年第1回定例会" };

async function withPublicationFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "minutes-detail-contract-"));
  const originalCwd = process.cwd();
  const originalFetch = globalThis.fetch;
  try {
    process.chdir(root);
    await run(root);
  } finally {
    process.chdir(originalCwd);
    globalThis.fetch = originalFetch;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("a local public index gates stray meeting bodies without a remote lookup", async () => {
  await withPublicationFixture(async (root) => {
    const dir = path.join(root, "data", "sample", "minutes");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify([indexItem]));
    fs.writeFileSync(path.join(dir, "13.json"), "{}");
    globalThis.fetch = () => { throw new Error("local index must remain authoritative"); };
    assert.deepEqual(await getPublishedMinutesIndexResult("sample", "13"), { status: "absent" });
    assert.deepEqual(await getPublishedMinutesIndexResult("sample", "12"), { status: "available", item: indexItem });
  });
});

test("a malformed local index is not presented as absent", async () => {
  await withPublicationFixture(async (root) => {
    const dir = path.join(root, "data", "sample", "minutes");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.json"), "{broken");
    assert.deepEqual(await getPublishedMinutesIndexResult("sample", "12"), { status: "parse_failed" });
  });
});

test("remote publication distinguishes transport failure, malformed JSON, and confirmed absence", async () => {
  await withPublicationFixture(async () => {
    globalThis.fetch = async () => new Response("unavailable", { status: 503 });
    assert.deepEqual(await getPublishedMinutesIndexResult("sample", "12"), { status: "fetch_failed" });
    globalThis.fetch = async () => { throw new Error("offline"); };
    assert.deepEqual(await getPublishedMinutesIndexResult("sample", "12"), { status: "fetch_failed" });
    globalThis.fetch = async () => new Response("{broken");
    assert.deepEqual(await getPublishedMinutesIndexResult("sample", "12"), { status: "parse_failed" });
    globalThis.fetch = async () => new Response("[]");
    assert.deepEqual(await getPublishedMinutesIndexResult("sample", "12"), { status: "absent" });
  });
});

test("remote legacy index fallback is retained only after a missing primary index", async () => {
  await withPublicationFixture(async () => {
    const requested = [];
    globalThis.fetch = async (url) => {
      requested.push(String(url));
      return String(url).endsWith("/minutes/index.json")
        ? new Response(null, { status: 404 }) : Response.json([indexItem]);
    };
    assert.deepEqual(await getPublishedMinutesIndexResult("sample", "12"), { status: "available", item: indexItem });
    assert.equal(requested.length, 2);
    assert.match(requested[1], /site\/data\/sample\/index\.json$/);
  });
});

test("session identity validation rejects duplicate IDs without rewriting source text", () => {
  const minute = { minute_id: 9, title: "○ 発言者", minute_type: "○一般質問", text: "原文\n　空白と句読点を保持。" };
  const session = { council_id: 12, name: "会議", year: "2026", japanese_year: "令和8年", type_label: "本会議", schedules: [{ schedule_id: 7, name: "第1日", minutes: [minute] }] };
  const before = structuredClone(session);
  assert.equal(isMinutesSession(session, "12"), true);
  assert.deepEqual(session, before);
  assert.equal(isMinutesSession(session, "13"), false);
  assert.equal(isMinutesSession({ ...session, schedules: [session.schedules[0], session.schedules[0]] }, "12"), false);
  assert.equal(isMinutesSession({ ...session, schedules: [{ ...session.schedules[0], minutes: [minute, minute] }] }, "12"), false);
});

test("citations preserve the full body and use the matching minute source", () => {
  const item = { minute_id: 9, title: "発言者", minute_type: "本会議", text: "原文の全文。\n".repeat(100), source_url: "https://example.test/day-2.pdf" };
  const catalog = { url: "https://example.test/minutes/", label: "公式一覧", scope: "catalog" };
  const source = getMinutesSource({ item, fallback: catalog });
  const citation = buildMinutesCitation({ item, cityName: "例市", councilName: "定例会", scheduleName: "第2日", source, permalink: "https://example.test/sample/minutes/12#minute-7-9" });
  assert.ok(citation.includes(item.text));
  assert.ok(citation.includes("第2日"));
  assert.ok(citation.includes("公式原典: https://example.test/day-2.pdf"));
  assert.equal(getMinutesSource({}), null);
  assert.equal(safeMinutesSourceUrl("javascript:alert(1)"), null);
  assert.equal(safeMinutesSourceUrl("https://user:secret@example.test/"), null);
});

test("automatic search selection and explicit day selection share one effective index", () => {
  assert.equal(selectedMinutesSchedule(0, [0, 2, 0], false), 1);
  assert.equal(selectedMinutesSchedule(2, [0, 2, 0], true), 2);
  assert.equal(selectedMinutesSchedule(1, [0, 2, 0], false), 1);
  assert.equal(selectedMinutesSchedule(2, null, false), 2);
});

test("whole-document and per-speech records use different units without changing source content", () => {
  const text = "原文\n　令和8年3月1日、3月2日の記録。";
  const base = { council_id: 12, name: "定例会", year: "2026", japanese_year: "令和8年", type_label: "本会議" };
  const document = { ...base, schedules: [{ schedule_id: 7, name: "会議録PDF", minutes: [{ minute_id: 9, title: "収録本文", minute_type: "本会議", text }] }] };
  const speeches = { ...base, schedules: [{ schedule_id: 7, name: "第1日", minutes: [{ minute_id: 9, title: "発言者", minute_type: "○一般質問", text }] }] };
  const beforeDocument = structuredClone(document);
  const beforeSpeeches = structuredClone(speeches);
  assert.equal(minutesScheduleUnit(document), "資料");
  assert.equal(minutesContentLabel(document), "資料ごとの全文形式");
  assert.equal(minutesScheduleUnit(speeches), "日程");
  assert.equal(minutesContentLabel(speeches), "1件の発言・議題");
  assert.deepEqual(document, beforeDocument);
  assert.deepEqual(speeches, beforeSpeeches);
});
