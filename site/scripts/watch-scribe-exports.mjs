#!/usr/bin/env node
/**
 * Scribe の書き出しフォルダを監視し、文字起こしテキストを自動で取り込む
 *
 * 前提:
 *   - 書き出しファイル名は mp3 と同じベース名にする
 *     例: 4840-08-20250306.mp3 -> 4840-08-20250306.txt
 *     例: 4840-08-20250306-seg04-45m.mp3 -> 4840-08-20250306-seg04-45m.txt
 *
 * 使い方:
 *   node site/scripts/watch-scribe-exports.mjs --city hokkaido
 *
 * オプション:
 *   --city <slug>       対象都市（必須に近い。デフォルト: chitose）
 *   --dir <path>        監視ディレクトリ（デフォルト: tmp_audio/scribe-exports）
 *   --publish           成功時に data/ と site/data/ を更新する
 *   --once              1回スキャンして終了する
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
};
const hasFlag = (flag) => args.includes(flag);

const city = get("--city") ?? "chitose";
const watchDir = path.resolve(get("--dir") ?? path.join(ROOT, "tmp_audio", "scribe-exports"));
const publish = hasFlag("--publish");
const once = hasFlag("--once");

const doneDir = path.join(watchDir, "_processed");
const failedDir = path.join(watchDir, "_failed");
const importingDir = path.join(watchDir, "_importing");
const importScript = path.join(__dirname, "import-scribe-text.mjs");
const queue = [];
const queued = new Set();
let isProcessing = false;

for (const dir of [watchDir, doneDir, failedDir, importingDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

console.log(`Scribe監視開始: ${watchDir}`);
console.log(`対象都市: ${city}`);
console.log(`モード: ${publish ? "publish" : "preview-only"}`);

scan();
if (once) {
  setTimeout(() => {
    if (!isProcessing && queue.length === 0) process.exit(0);
  }, 100);
} else {
  fs.watch(watchDir, () => {
    scan();
  });
  setInterval(scan, 5000);
}

async function scan() {
  const entries = fs.readdirSync(watchDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const fullPath = path.join(watchDir, entry.name);
    if (!isTranscriptFile(entry.name)) continue;
    if (queued.has(fullPath)) continue;
    queued.add(fullPath);
    queue.push(fullPath);
  }
  await processQueue();
}

async function processQueue() {
  if (isProcessing) return;
  isProcessing = true;

  while (queue.length > 0) {
    const originalPath = queue.shift();
    queued.delete(originalPath);

    if (!fs.existsSync(originalPath)) continue;
    const stable = await waitUntilStable(originalPath);
    if (!stable) {
      console.log(`スキップ: 安定待ちタイムアウト ${path.basename(originalPath)}`);
      continue;
    }

    const importingPath = path.join(importingDir, path.basename(originalPath));
    try {
      fs.renameSync(originalPath, importingPath);
      const job = resolveJob(importingPath);
      const previewOnly = job.sampleMode || !publish;
      if (publish && job.sampleMode) {
        console.log(`publish指定ですがサンプル音源のため preview-only に切り替え: ${job.baseName}`);
      }

      console.log(`\n取込開始: ${path.basename(importingPath)}`);
      console.log(`  session_id: ${job.sessionId}`);
      console.log(`  mode: ${previewOnly ? "preview-only" : "publish"}`);

      const cmdArgs = [
        importScript,
        "--city",
        city,
        "--id",
        job.sessionId,
        "--transcript",
        importingPath,
      ];
      if (previewOnly) cmdArgs.push("--preview-only");

      const result = spawnSync(process.execPath, cmdArgs, {
        cwd: ROOT,
        encoding: "utf-8",
        maxBuffer: 20 * 1024 * 1024,
      });

      const logText = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
      if (logText) console.log(indent(logText, "  "));

      if (result.status !== 0) {
        throw new Error(`import failed with code ${result.status}`);
      }

      const donePath = path.join(doneDir, path.basename(importingPath));
      fs.renameSync(importingPath, donePath);
      writeLog(donePath, {
        ok: true,
        session_id: job.sessionId,
        preview_only: previewOnly,
        transcript_path: donePath,
        processed_at: new Date().toISOString(),
      });
      console.log(`  完了: ${donePath}`);
    } catch (error) {
      const failedPath = path.join(failedDir, path.basename(importingPath));
      if (fs.existsSync(importingPath)) {
        fs.renameSync(importingPath, failedPath);
      }
      writeLog(failedPath, {
        ok: false,
        error: error.message,
        processed_at: new Date().toISOString(),
      });
      console.error(`  失敗: ${path.basename(originalPath)} ${error.message}`);
    }
  }

  isProcessing = false;
  if (once) process.exit(0);
}

function resolveJob(transcriptPath) {
  const baseName = path.basename(transcriptPath, path.extname(transcriptPath));
  const manifestCandidates = [
    path.join(ROOT, "tmp_audio", `${baseName}.segment.json`),
    path.join(ROOT, "tmp_audio", `${baseName}.segments.json`),
  ];

  let sessionId = baseName;
  let sampleMode = false;

  for (const manifestPath of manifestCandidates) {
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    sessionId = manifest.id ?? sessionId;
    sampleMode = Boolean(manifest.sample_minutes) || Boolean(manifest.segment) || sessionId !== baseName;
    break;
  }

  const sessionFile = path.join(ROOT, "data", city, "sessions", `${sessionId}.json`);
  if (!fs.existsSync(sessionFile)) {
    throw new Error(`session file not found for ${sessionId}`);
  }

  return { baseName, sessionId, sampleMode };
}

function isTranscriptFile(name) {
  const lower = name.toLowerCase();
  return (lower.endsWith(".txt") || lower.endsWith(".md")) && !lower.endsWith(".preview.json");
}

function waitUntilStable(filePath, attempts = 12, intervalMs = 2000) {
  return new Promise((resolve) => {
    let prevSize = -1;
    let sameCount = 0;
    let remaining = attempts;

    const check = () => {
      if (!fs.existsSync(filePath)) return resolve(false);
      const stat = fs.statSync(filePath);
      if (stat.size > 0 && stat.size === prevSize) sameCount += 1;
      else sameCount = 0;
      prevSize = stat.size;

      if (sameCount >= 1) return resolve(true);
      remaining -= 1;
      if (remaining <= 0) return resolve(false);
      setTimeout(check, intervalMs);
    };

    check();
  });
}

function writeLog(targetPath, payload) {
  const logPath = `${targetPath}.log.json`;
  fs.writeFileSync(logPath, JSON.stringify(payload, null, 2));
}

function indent(text, prefix) {
  return text.split("\n").map((line) => prefix + line).join("\n");
}
