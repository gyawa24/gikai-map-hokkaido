#!/usr/bin/env node
/**
 * superwhisper への直列投入ジョブを launchctl で開始/停止する
 *
 * 使い方:
 *   node site/scripts/launch-scribe-watch-job.mjs \
 *     --city hokkaido \
 *     --title "令和7年第1回定例会"
 *
 * 停止:
 *   node site/scripts/launch-scribe-watch-job.mjs \
 *     --city hokkaido \
 *     --title "令和7年第1回定例会" \
 *     --stop
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(__dirname, "watch-audio-batch-for-scribe.mjs");
const NODE = process.execPath;
const TMP_LOG_DIR = path.join(ROOT, "tmp_audio", "logs");

const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
};
const hasFlag = (flag) => args.includes(flag);

const city = get("--city") ?? "chitose";
const title = get("--title");
const appPath = get("--app") ?? "/Applications/superwhisper.app";
const stop = hasFlag("--stop");

if (!title) {
  console.error("Usage: node site/scripts/launch-scribe-watch-job.mjs --city <slug> --title <text> [--stop]");
  process.exit(1);
}

fs.mkdirSync(TMP_LOG_DIR, { recursive: true });

const slug = slugify(`${city}-${title}`);
const label = `local.codex.scribe-watch.${slug}`;
const logPath = path.join(TMP_LOG_DIR, `scribe-watch-${slug}.log`);

if (stop) {
  spawnSync("launchctl", ["remove", label], { stdio: "ignore" });
  console.log(`停止: ${label}`);
  process.exit(0);
}

spawnSync("launchctl", ["remove", label], { stdio: "ignore" });

const command = [
  "cd",
  ROOT,
  "&&",
  "exec",
  shellEscape(NODE),
  shellEscape(SCRIPT),
  "--city",
  shellEscape(city),
  "--title",
  shellEscape(title),
  "--app",
  shellEscape(appPath),
].join(" ");

const result = spawnSync("launchctl", [
  "submit",
  "-l",
  label,
  "-o",
  logPath,
  "-e",
  logPath,
  "--",
  "/bin/sh",
  "-c",
  command,
], { encoding: "utf-8" });

if (result.status !== 0) {
  console.error(result.stderr || result.stdout || "launchctl submit failed");
  process.exit(result.status ?? 1);
}

console.log(`開始: ${label}`);
console.log(`ログ: ${logPath}`);

function slugify(text) {
  return text
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function shellEscape(text) {
  return `'${String(text).replaceAll("'", `'\\''`)}'`;
}
