#!/usr/bin/env node
/**
 * 複数セッションの音声ファイルをまとめて準備する
 *
 * 使い方:
 *   node site/scripts/prepare-session-audio-batch.mjs \
 *     --city hokkaido \
 *     --title "令和7年第1回定例会"
 *
 * オプション:
 *   --city <slug>       対象都市（デフォルト: chitose）
 *   --title <text>      title に含まれる文字列で絞り込む
 *   --plenary-first     本会議を先に処理する
 *   --force             既存mp3も作り直す
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const prepareScript = path.join(__dirname, "prepare-session-audio.mjs");

const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
};
const hasFlag = (flag) => args.includes(flag);

const city = get("--city") ?? "chitose";
const titleFilter = get("--title");
const plenaryFirst = hasFlag("--plenary-first");
const force = hasFlag("--force");

if (!titleFilter) {
  console.error("Usage: node site/scripts/prepare-session-audio-batch.mjs --city <slug> --title <text>");
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

console.log(`対象: ${sessions.length}件`);
for (const session of sessions) {
  console.log(`  ${session.id} ${session.date} ${session.title}`);
}

let ok = 0;
let fail = 0;

for (const session of sessions) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`▶ ${session.id} ${session.title}`);

  const cmdArgs = [prepareScript, "--city", city, "--id", session.id];
  if (force) cmdArgs.push("--force");

  const result = spawnSync(process.execPath, cmdArgs, {
    cwd: ROOT,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`  起動失敗: ${result.error.message}`);
    fail += 1;
    continue;
  }

  if (result.status === 0) ok += 1;
  else fail += 1;
}

console.log(`\n${"=".repeat(60)}`);
console.log(`完了: 成功 ${ok} / 失敗 ${fail}`);
process.exit(fail === 0 ? 0 : 1);

function compareSessions(a, b, options) {
  const plenaryBias =
    comparePlenary(a, b, options.plenaryFirst) ||
    a.date.localeCompare(b.date) ||
    a.title.localeCompare(b.title);
  return plenaryBias;
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
