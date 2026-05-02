#!/usr/bin/env node
/**
 * 指定した会期ぶんの mp3 を監視し、完成したものから superwhisper に1本ずつ投入する
 * 次の音声は、対応する書き出しテキストが確認できてから開く
 *
 * 使い方:
 *   node site/scripts/watch-audio-batch-for-scribe.mjs \
 *     --city hokkaido \
 *     --title "令和7年第1回定例会"
 *
 * オプション:
 *   --city <slug>           対象都市（デフォルト: chitose）
 *   --title <text>          title に含まれる文字列で対象を絞る
 *   --app <path>            投入先アプリ（デフォルト: /Applications/superwhisper.app）
 *   --export-dir <path>     Scribe書き出しディレクトリ（デフォルト: tmp_audio/scribe-exports）
 *   --poll-ms <ms>          監視間隔（デフォルト: 30000）
 *   --open-delay-ms <ms>    各ファイルを開く間隔（デフォルト: 5000）
 *   --once                  1回だけ確認して終了
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

const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
};
const hasFlag = (flag) => args.includes(flag);

const city = get("--city") ?? "chitose";
const titleFilter = get("--title");
const appPath = get("--app") ?? "/Applications/superwhisper.app";
const exportDir = path.resolve(get("--export-dir") ?? path.join(TMP_DIR, "scribe-exports"));
const pollMs = Number(get("--poll-ms") ?? "30000");
const openDelayMs = Number(get("--open-delay-ms") ?? "5000");
const once = hasFlag("--once");

if (!titleFilter) {
  console.error("Usage: node site/scripts/watch-audio-batch-for-scribe.mjs --city <slug> --title <text>");
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
  .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));

if (sessions.length === 0) {
  console.error(`No sessions matched: ${titleFilter}`);
  process.exit(1);
}

fs.mkdirSync(LOG_DIR, { recursive: true });
const statePath = path.join(LOG_DIR, `scribe-opened-${slugify(titleFilter)}.json`);
const state = fs.existsSync(statePath)
  ? JSON.parse(fs.readFileSync(statePath, "utf-8"))
  : { title: titleFilter, city, opened_ids: [], completed_ids: [], active_id: null, opened_at: null };
const opened = new Set(state.opened_ids ?? []);
const completed = new Set(state.completed_ids ?? []);

console.log(`監視対象: ${sessions.length}件`);
for (const session of sessions) console.log(`  ${session.id} ${session.title}`);
console.log(`アプリ: ${appPath}`);
console.log(`書き出し監視: ${exportDir}`);

while (true) {
  for (const session of sessions) {
    const transcriptState = getTranscriptState(session.id);
    if (transcriptState) {
      completed.add(session.id);
      if (state.active_id === session.id) state.active_id = null;
      persistState();
      continue;
    }

    if (completed.has(session.id)) continue;

    if (state.active_id && state.active_id !== session.id) {
      console.log(`${timestamp()} 待機中: ${state.active_id} の書き出し待ち`);
      if (once) process.exit(0);
      await delay(pollMs);
      continue;
    }

    const audioPath = getAudioPath(session.id);
    if (!fs.existsSync(audioPath)) {
      console.log(`${timestamp()} 待機中: ${session.id} の mp3 生成待ち`);
      if (once) process.exit(0);
      await delay(pollMs);
      continue;
    }

    if (!opened.has(session.id)) {
      console.log(`${timestamp()} 開始: ${session.id} -> ${path.basename(appPath)}`);

      const openResult = spawnSync("open", ["-a", appPath, audioPath], {
        encoding: "utf-8",
      });
      if (openResult.status !== 0) {
        const message = (openResult.stderr || openResult.stdout || "open failed").trim();
        throw new Error(`failed to open ${audioPath}: ${message}`);
      }

      opened.add(session.id);
      state.active_id = session.id;
      persistState();
      await delay(openDelayMs);
    }

    console.log(`${timestamp()} 待機中: ${session.id} の書き出し待ち`);
    if (once) process.exit(0);
    await delay(pollMs);
    continue;
  }

  if (completed.size === sessions.length) break;
}

state.opened_at = new Date().toISOString();
state.active_id = null;
persistState();
console.log(`${timestamp()} 完了: ${completed.size}件投入・書き出し確認`);

function getAudioPath(id) {
  return path.join(TMP_DIR, `${id}.mp3`);
}

function persistState() {
  const payload = {
    ...state,
    opened_ids: Array.from(opened),
    completed_ids: Array.from(completed),
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(statePath, JSON.stringify(payload, null, 2));
}

function getTranscriptState(sessionId) {
  const candidates = [
    path.join(exportDir, `${sessionId}.txt`),
    path.join(exportDir, `${sessionId}.md`),
    path.join(exportDir, "_importing", `${sessionId}.txt`),
    path.join(exportDir, "_importing", `${sessionId}.md`),
    path.join(exportDir, "_processed", `${sessionId}.txt`),
    path.join(exportDir, "_processed", `${sessionId}.md`),
    path.join(exportDir, "_failed", `${sessionId}.txt`),
    path.join(exportDir, "_failed", `${sessionId}.md`),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
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
