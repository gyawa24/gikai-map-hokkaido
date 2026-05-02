#!/usr/bin/env node
/**
 * mp3 を SuperWhisper に1本ずつ投入し、DB 完了を確認してから次へ進む
 *
 * 使い方:
 *   node site/scripts/watch-audio-batch-for-superwhisper-db.mjs \
 *     --city hokkaido \
 *     --title "令和7年第1回定例会"
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { setTimeout as delay } from "timers/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const TMP_DIR = path.join(ROOT, "tmp_audio");
const LOG_DIR = path.join(TMP_DIR, "logs");
const SW_DB = path.join(
  process.env.HOME,
  "Library/Application Support/SuperWhisper/database/superwhisper.sqlite"
);

const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
};

const city = get("--city") ?? "chitose";
const titleFilter = get("--title");
const appPath = get("--app") ?? "/Applications/superwhisper.app";
const plenaryFirst = process.argv.slice(2).includes("--plenary-first");
const pollMs = Number(get("--poll-ms") ?? "15000");
const openDelayMs = Number(get("--open-delay-ms") ?? "5000");
const timeoutMs = Number(get("--timeout-ms") ?? String(8 * 60 * 60 * 1000));

if (!titleFilter) {
  console.error("Usage: node site/scripts/watch-audio-batch-for-superwhisper-db.mjs --city <slug> --title <text>");
  process.exit(1);
}

if (!fs.existsSync(appPath)) {
  console.error(`App not found: ${appPath}`);
  process.exit(1);
}

const indexPath = path.join(ROOT, "data", city, "sessions", "index.json");
if (!fs.existsSync(indexPath)) {
  console.error(`Session index not found: ${indexPath}`);
  process.exit(1);
}

const sessions = JSON.parse(fs.readFileSync(indexPath, "utf-8"))
  .filter((session) => String(session.title ?? "").includes(titleFilter))
  .sort((a, b) => compareSessions(a, b, { plenaryFirst }));

if (sessions.length === 0) {
  console.error(`No sessions matched: ${titleFilter}`);
  process.exit(1);
}

fs.mkdirSync(LOG_DIR, { recursive: true });
const statePath = path.join(LOG_DIR, `superwhisper-db-${slugify(`${city}-${titleFilter}`)}.json`);
const state = fs.existsSync(statePath)
  ? JSON.parse(fs.readFileSync(statePath, "utf-8"))
  : { title: titleFilter, city, completed_ids: [], active: null, recordings: [] };
const completed = new Set(state.completed_ids ?? []);

console.log(`監視対象: ${sessions.length}件`);
for (const session of sessions) console.log(`  ${session.id} ${session.title}`);
console.log(`アプリ: ${appPath}`);

while (completed.size < sessions.length) {
  if (state.active) {
    const recording = findMatchingRecording(state.active.before_rowid, state.active.min_duration_seconds);
    if (recording) {
      console.log(`${timestamp()} 完了検知: ${state.active.session_id} -> ${recording.id}`);
      completed.add(state.active.session_id);
      state.recordings = [
        ...(state.recordings ?? []).filter((item) => item.session_id !== state.active.session_id),
        {
          session_id: state.active.session_id,
          recording_id: recording.id,
          rowid: recording.rowid,
          datetime: recording.datetime,
          duration: recording.duration,
          rawWordCount: recording.rawWordCount,
        },
      ];
      state.active = null;
      persistState();
      continue;
    }

    const elapsed = Date.now() - Date.parse(state.active.opened_at);
    if (elapsed > timeoutMs) {
      throw new Error(`timeout waiting for SuperWhisper completion: ${state.active.session_id}`);
    }

    console.log(`${timestamp()} 待機中: ${state.active.session_id} の文字起こし完了待ち`);
    await delay(pollMs);
    continue;
  }

  const next = sessions.find((session) => !completed.has(session.id));
  if (!next) break;

  const audioPath = path.join(TMP_DIR, `${next.id}.mp3`);
  if (!fs.existsSync(audioPath)) {
    console.log(`${timestamp()} 待機中: ${next.id} の mp3 未生成`);
    await delay(pollMs);
    continue;
  }

  const beforeRowId = getLatestRowId();
  const durationSeconds = probeDuration(audioPath);
  const minDurationSeconds = Math.max(60, Math.floor(durationSeconds * 0.45));

  console.log(`${timestamp()} 開始: ${next.id} -> ${path.basename(appPath)}`);
  const openResult = spawnSync("open", ["-a", appPath, audioPath], { encoding: "utf-8" });
  if (openResult.status !== 0) {
    const message = (openResult.stderr || openResult.stdout || "open failed").trim();
    throw new Error(`failed to open ${audioPath}: ${message}`);
  }

  state.active = {
    session_id: next.id,
    audio_path: audioPath,
    before_rowid: beforeRowId,
    expected_duration_seconds: durationSeconds,
    min_duration_seconds: minDurationSeconds,
    opened_at: new Date().toISOString(),
  };
  persistState();
  await delay(openDelayMs);
}

state.completed_ids = Array.from(completed);
state.finished_at = new Date().toISOString();
persistState();
console.log(`${timestamp()} 完了: ${completed.size}件`);

function getLatestRowId() {
  const result = spawnSync("sqlite3", [
    SW_DB,
    "SELECT COALESCE(MAX(rowid), 0) FROM recording;",
  ], { encoding: "utf-8" });
  if (result.status !== 0) throw new Error(`sqlite3 failed: ${result.stderr}`);
  return Number(result.stdout.trim() || "0");
}

function findMatchingRecording(afterRowId, minDurationSeconds) {
  const result = spawnSync("sqlite3", [
    SW_DB,
    "-json",
    `SELECT rowid, id, datetime, duration, rawWordCount, fromFile
     FROM recording
     WHERE rowid > ${afterRowId}
     ORDER BY rowid ASC
     LIMIT 20;`,
  ], { encoding: "utf-8" });
  if (result.status !== 0) throw new Error(`sqlite3 failed: ${result.stderr}`);
  const rows = JSON.parse(result.stdout || "[]");
  return rows.find((row) =>
    Number(row.fromFile) === 1 &&
    Number(row.rawWordCount) > 0 &&
    Number(row.duration) >= minDurationSeconds
  ) ?? null;
}

function probeDuration(filePath) {
  const result = spawnSync("/opt/homebrew/bin/ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ], { encoding: "utf-8" });
  if (result.status !== 0) throw new Error(`ffprobe failed: ${result.stderr}`);
  const seconds = Number(result.stdout.trim());
  if (!Number.isFinite(seconds)) throw new Error(`invalid duration: ${filePath}`);
  return seconds;
}

function persistState() {
  state.completed_ids = Array.from(completed);
  state.updated_at = new Date().toISOString();
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function slugify(text) {
  return text
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function timestamp() {
  return new Date().toISOString();
}

function compareSessions(a, b, options) {
  return (
    comparePlenary(a, b, options.plenaryFirst) ||
    a.date.localeCompare(b.date) ||
    a.title.localeCompare(b.title)
  );
}

function comparePlenary(a, b, enabled) {
  if (!enabled) return 0;
  const aRank = committeeRank(a.committee);
  const bRank = committeeRank(b.committee);
  return aRank - bRank;
}

function committeeRank(committee) {
  return committee === "本会議" ? 0 : 1;
}
