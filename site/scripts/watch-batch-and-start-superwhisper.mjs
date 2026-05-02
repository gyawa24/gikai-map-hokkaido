#!/usr/bin/env node
/**
 * 指定会期の mp3 が全てそろうまで待機し、完了後に SuperWhisper 直列投入ジョブを起動する
 *
 * 使い方:
 *   node site/scripts/watch-batch-and-start-superwhisper.mjs \
 *     --city hokkaido \
 *     --title "令和8年第1回定例会"
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
const LAUNCH_SCRIPT = path.join(__dirname, "launch-superwhisper-db-job.mjs");

const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
};

const city = get("--city") ?? "chitose";
const titleFilter = get("--title");
const appPath = get("--app") ?? "/Applications/superwhisper.app";
const pollMs = Number(get("--poll-ms") ?? "60000");

if (!titleFilter) {
  console.error(
    "Usage: node site/scripts/watch-batch-and-start-superwhisper.mjs --city <slug> --title <text>"
  );
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
const statePath = path.join(LOG_DIR, `wait-superwhisper-${slugify(`${city}-${titleFilter}`)}.json`);

console.log(`待機対象: ${sessions.length}件`);
for (const session of sessions) console.log(`  ${session.id} ${session.title}`);
console.log(`完了後に起動: ${appPath}`);

while (true) {
  const ready = sessions.filter((session) =>
    fs.existsSync(path.join(TMP_DIR, `${session.id}.mp3`))
  );

  const state = {
    city,
    title: titleFilter,
    total: sessions.length,
    ready: ready.length,
    remaining_ids: sessions
      .filter((session) => !fs.existsSync(path.join(TMP_DIR, `${session.id}.mp3`)))
      .map((session) => session.id),
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

  if (ready.length === sessions.length) break;

  console.log(`${timestamp()} 待機中: mp3 ${ready.length}/${sessions.length}`);
  await delay(pollMs);
}

console.log(`${timestamp()} mp3 完了: SuperWhisper 直列投入を開始`);
const result = spawnSync(
  process.execPath,
  [LAUNCH_SCRIPT, "--city", city, "--title", titleFilter, "--app", appPath],
  {
    cwd: ROOT,
    stdio: "inherit",
  }
);

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
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
