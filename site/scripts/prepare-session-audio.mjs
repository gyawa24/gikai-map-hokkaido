#!/usr/bin/env node
/**
 * Scribe に手動投入するための音声ファイルを準備する
 *
 * 使い方:
 *   node site/scripts/prepare-session-audio.mjs --city hokkaido --id 4840-08-20250306
 *
 * オプション:
 *   --city <slug>       対象都市（デフォルト: chitose）
 *   --id <session-id>   対象セッションID（必須）
 *   --segment <N>       分割動画のN番目だけ取得する
 *   --minutes <N>       先頭N分だけ切り出す（テスト用）
 *   --output <path>     出力先mp3（省略時: tmp_audio/<id>.mp3）
 *   --keep-parts        分割ソースの各mp3も保持する
 *   --force             既存mp3を作り直す
 *   --reveal            Finderで出力ファイルを表示する
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { FFPROBE, prepareSessionAudio, resolveSourceUrl } from "./lib/session-audio.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const TMP_DIR = path.join(ROOT, "tmp_audio");
const SCRIBE_EXPORT_DIR = path.join(TMP_DIR, "scribe-exports");

const args = process.argv.slice(2);
const getFlag = (f) => {
  const i = args.indexOf(f);
  return i !== -1 ? args[i + 1] : null;
};
const hasFlag = (f) => args.includes(f);

const city = getFlag("--city") ?? "chitose";
const sessionId = getFlag("--id");
const segmentRaw = getFlag("--segment");
const minutesRaw = getFlag("--minutes");
const keepParts = hasFlag("--keep-parts");
const force = hasFlag("--force");
const reveal = hasFlag("--reveal");

if (!sessionId) {
  console.error("Usage: node site/scripts/prepare-session-audio.mjs --city <slug> --id <session-id>");
  process.exit(1);
}

const sessionFile = path.join(ROOT, "data", city, "sessions", `${sessionId}.json`);
if (!fs.existsSync(sessionFile)) {
  console.error(`Session file not found: ${sessionFile}`);
  process.exit(1);
}

const session = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
const sourceUrl = resolveSourceUrl(session);
const allSourceSegments = Array.isArray(session.source_segments) ? session.source_segments : [];
const segmentIndex = segmentRaw ? parseInt(segmentRaw, 10) : null;
const maxMinutes = minutesRaw ? parseInt(minutesRaw, 10) : null;

if (segmentRaw && (!Number.isInteger(segmentIndex) || segmentIndex < 1 || segmentIndex > allSourceSegments.length)) {
  console.error(`--segment は 1 〜 ${allSourceSegments.length} の範囲で指定してください`);
  process.exit(1);
}
if (minutesRaw && (!Number.isInteger(maxMinutes) || maxMinutes < 1)) {
  console.error("--minutes は 1 以上の整数で指定してください");
  process.exit(1);
}
if (maxMinutes && !segmentIndex && allSourceSegments.length > 0) {
  console.error("分割動画を時間指定で切り出す場合は --segment も指定してください");
  process.exit(1);
}

const selectedSegment = segmentIndex ? allSourceSegments[segmentIndex - 1] : null;
const sampleSuffix = maxMinutes ? `-${maxMinutes}m` : "";
const outputDefaultName = segmentIndex
  ? `${sessionId}-seg${String(segmentIndex).padStart(2, "0")}${sampleSuffix}.mp3`
  : `${sessionId}${sampleSuffix}.mp3`;
const outputPath = path.resolve(getFlag("--output") ?? path.join(TMP_DIR, outputDefaultName));
const manifestPath = outputPath.replace(/\.mp3$/i, segmentIndex ? ".segment.json" : ".segments.json");
const suggestedExportPath = path.join(
  SCRIBE_EXPORT_DIR,
  `${path.basename(outputPath, path.extname(outputPath))}.txt`
);
fs.mkdirSync(SCRIBE_EXPORT_DIR, { recursive: true });

if (!sourceUrl) {
  console.error("source_url または youtube_id が未設定です");
  process.exit(1);
}

if (force && fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

const prepareUrl = selectedSegment
  ? selectedSegment.media_url ?? selectedSegment.source_url ?? selectedSegment.view_url ?? sourceUrl
  : sourceUrl;
const prepareSegments = selectedSegment ? [] : allSourceSegments;
const maxSeconds = maxMinutes ? maxMinutes * 60 : null;

console.log(`セッション: ${session.title} (${session.date})`);
console.log(`出力先: ${outputPath}`);
if (selectedSegment) {
  console.log(`対象クリップ: ${segmentIndex}/${allSourceSegments.length} ${shorten(selectedSegment.title ?? "(無題)")}`);
} else {
  console.log(`ソース: ${allSourceSegments.length > 0 ? `${allSourceSegments.length}分割` : sourceUrl}`);
}
if (maxMinutes) {
  console.log(`切り出し: 先頭 ${maxMinutes} 分`);
}

if (!fs.existsSync(outputPath)) {
  const result = prepareSessionAudio({
    entryId: session.id,
    sourceUrl: prepareUrl,
    sourceSegments: prepareSegments,
    outputPath,
    tmpDir: TMP_DIR,
    keepParts,
    maxSeconds,
  });
  console.log(`作成完了: ${result.mode === "segments" ? "分割ソースを連結" : "単一ソース"}`);
} else {
  console.log("既存mp3を再利用します");
}

if (selectedSegment || allSourceSegments.length > 0) {
  const manifest = selectedSegment
    ? {
        id: session.id,
        city,
        title: session.title,
        date: session.date,
        generated_at: new Date().toISOString(),
        sample_minutes: maxMinutes,
        segment: {
          index: segmentIndex,
          title: selectedSegment.title ?? "",
          speaker: selectedSegment.speaker ?? "",
          view_url: selectedSegment.view_url ?? null,
          player_url: selectedSegment.player_url ?? null,
          media_url: selectedSegment.media_url ?? null,
          thumbnail_url: selectedSegment.thumbnail_url ?? null,
        },
      }
    : {
        id: session.id,
        city,
        title: session.title,
        date: session.date,
        source_url: sourceUrl,
        segment_count: allSourceSegments.length,
        generated_at: new Date().toISOString(),
        sample_minutes: maxMinutes,
        segments: allSourceSegments.map((seg, i) => ({
          index: i + 1,
          title: seg.title ?? "",
          speaker: seg.speaker ?? "",
          view_url: seg.view_url ?? null,
          player_url: seg.player_url ?? null,
          media_url: seg.media_url ?? null,
          thumbnail_url: seg.thumbnail_url ?? null,
        })),
      };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

const stats = fs.statSync(outputPath);
const sizeMb = (stats.size / 1024 / 1024).toFixed(1);
const duration = probeDuration(outputPath);

console.log(`サイズ: ${sizeMb} MB`);
if (duration != null) console.log(`長さ: ${formatDuration(duration)}`);
if (selectedSegment) {
  console.log(`クリップ情報: ${manifestPath}`);
} else if (allSourceSegments.length > 0) {
  console.log(`セグメント一覧: ${manifestPath}`);
}

if (reveal) {
  spawnSync("open", ["-R", outputPath], { stdio: "ignore" });
}

console.log("\n次の手順:");
console.log(`  1. ${outputPath} を Scribe に投入`);
console.log(`  2. 書き出し先を ${suggestedExportPath} にする`);
if (segmentIndex || maxMinutes) {
  console.log(`  3. 自動取込なら node site/scripts/watch-scribe-exports.mjs --city ${city}`);
  console.log("  4. 本番反映はフル音源で取り直してから実行");
} else {
  console.log(`  3. 自動取込なら node site/scripts/watch-scribe-exports.mjs --city ${city} --publish`);
  console.log("  4. 必要なら node site/scripts/enrich-sessions-speakers.mjs --city " + city);
}

function probeDuration(filePath) {
  const ffprobe = spawnSync(FFPROBE, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ], { encoding: "utf-8" });
  if (ffprobe.status !== 0) return null;
  const seconds = Number(ffprobe.stdout.trim());
  return Number.isFinite(seconds) ? seconds : null;
}

function formatDuration(secs) {
  const total = Math.round(secs);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function shorten(text) {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 80 ? oneLine.slice(0, 80) + "…" : oneLine;
}
