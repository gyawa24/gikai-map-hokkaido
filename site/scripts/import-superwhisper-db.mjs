#!/usr/bin/env node
/**
 * Super WhisperのSQLiteから最新の文字起こしを読み込んでセッションJSONを生成
 *
 * 使い方:
 *   # 1. 音声ファイルを作成
 *   node site/scripts/prepare-session-audio.mjs --city hokkaido --id 4840-08-20250306
 *
 *   # 2. tmp_audio/<id>.mp3 を Super Whisper にドラッグして文字起こし
 *
 *   # 3. このスクリプトを実行（Super Whisperの最新録音を自動取得）
 *   node scripts/import-superwhisper-db.mjs --city hokkaido --id 4840-08-20250306
 *
 * オプション:
 *   --city <slug>       対象都市（デフォルト: chitose）
 *   --id <session-id>   対象セッションID（必須）
 *   --list              Super Whisperの最近の録音一覧を表示して終了
 *   --nth <N>           最新からN番目の録音を使う（デフォルト: 1=最新）
 *   --recording-id <id> 取り込む recording.id を直接指定
 *   --rowid <N>         取り込む recording.rowid を直接指定
 *   --preview-only      data/ は更新せず、tmp_audio に要約JSONを書き出す
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "../..");
const SITE_ROOT = path.resolve(__dirname, "..");

const SW_DB = path.join(
  process.env.HOME,
  "Library/Application Support/SuperWhisper/database/superwhisper.sqlite"
);

// --- CLI引数 ---
const args    = process.argv.slice(2);
const get     = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
const hasFlag = (f) => args.includes(f);

const city      = get("--city") ?? "chitose";
const sessionId = get("--id");
const nthRaw    = get("--nth");
const nth       = nthRaw ? parseInt(nthRaw, 10) : 1;
const recordingId = get("--recording-id");
const rowIdRaw = get("--rowid");
const rowId = rowIdRaw ? parseInt(rowIdRaw, 10) : null;
const previewOnly = hasFlag("--preview-only");

// --- Super Whisper DBを読む ---
function readSuperWhisperRecordings(limit = 10) {
  const result = spawnSync("sqlite3", [
    SW_DB,
    "-json",
    `SELECT r.id, r.datetime, r.duration, r.fromFile,
            COALESCE(NULLIF(c.c2, ''), NULLIF(c.c1, '')) AS raw_text
     FROM recording r
     JOIN recording_fts_content c ON c.c0 = r.id
     ORDER BY r.datetime DESC
     LIMIT ${limit};`,
  ], { encoding: "utf-8" });

  if (result.status !== 0) {
    throw new Error(`sqlite3 failed: ${result.stderr}`);
  }
  return JSON.parse(result.stdout || "[]");
}

function readSuperWhisperRecordingById(id) {
  const safeId = String(id).replaceAll("'", "''");
  const result = spawnSync("sqlite3", [
    SW_DB,
    "-json",
    `SELECT r.id, r.datetime, r.duration, r.fromFile,
            COALESCE(NULLIF(c.c2, ''), NULLIF(c.c1, '')) AS raw_text
     FROM recording r
     JOIN recording_fts_content c ON c.c0 = r.id
     WHERE r.id = '${safeId}'
     LIMIT 1;`,
  ], { encoding: "utf-8" });

  if (result.status !== 0) {
    throw new Error(`sqlite3 failed: ${result.stderr}`);
  }
  const rows = JSON.parse(result.stdout || "[]");
  return rows[0] ?? null;
}

function readSuperWhisperRecordingByRowId(targetRowId) {
  const safeRowId = Number(targetRowId);
  if (!Number.isInteger(safeRowId) || safeRowId <= 0) {
    throw new Error(`invalid rowid: ${targetRowId}`);
  }
  const result = spawnSync("sqlite3", [
    SW_DB,
    "-json",
    `SELECT r.rowid, r.id, r.datetime, r.duration, r.fromFile,
            COALESCE(NULLIF(c.c2, ''), NULLIF(c.c1, '')) AS raw_text
     FROM recording r
     JOIN recording_fts_content c ON c.c0 = r.id
     WHERE r.rowid = ${safeRowId}
     LIMIT 1;`,
  ], { encoding: "utf-8" });

  if (result.status !== 0) {
    throw new Error(`sqlite3 failed: ${result.stderr}`);
  }
  const rows = JSON.parse(result.stdout || "[]");
  return rows[0] ?? null;
}

// --- 一覧表示モード ---
if (hasFlag("--list")) {
  const rows = readSuperWhisperRecordings(10);
  console.log("\nSuper Whisperの最近の録音:");
  rows.forEach((r, i) => {
    const mins = Math.round(r.duration / 60);
    const preview = (r.raw_text ?? "").slice(0, 60).replace(/\n/g, " ");
    console.log(`  [${i + 1}] ${r.datetime}  ${mins}分  ${preview}…`);
  });
  process.exit(0);
}

if (!sessionId) {
  console.error("Usage: node import-superwhisper-db.mjs --city <slug> --id <session-id> [--nth N]");
  console.error("       node import-superwhisper-db.mjs --list");
  process.exit(1);
}

// --- セッションJSON読み込み ---
const sessionFile = path.join(ROOT, "data", city, "sessions", `${sessionId}.json`);
if (!fs.existsSync(sessionFile)) {
  console.error(`Session file not found: ${sessionFile}`);
  process.exit(1);
}
const session = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
console.log(`セッション: ${session.title} (${session.date})`);

// --- 語彙辞書 ---
function loadVocabulary(city) {
  const fp = path.join(ROOT, "data", city, "vocabulary.json");
  try { return JSON.parse(fs.readFileSync(fp, "utf-8")); } catch { return null; }
}
function getCouncilName(city, vocab) {
  if (vocab?.council_name) return vocab.council_name;
  try {
    const municipalities = JSON.parse(
      fs.readFileSync(path.join(ROOT, "data", "municipalities.json"), "utf-8")
    );
    return municipalities.find((m) => m.slug === city)?.council_name ?? `${city}議会`;
  } catch {
    return `${city}議会`;
  }
}
function applyCorrections(text, vocab) {
  if (!vocab?.corrections) return text;
  let result = text;
  for (const { wrong, right } of vocab.corrections) result = result.replaceAll(wrong, right);
  return result;
}

const vocab = loadVocabulary(city);
const councilName = getCouncilName(city, vocab);
if (vocab) console.log(`語彙辞書: ${vocab.corrections?.length ?? 0}件の補正ルール`);

// --- Super Whisperから録音を取得 ---
let rec;
if (rowId !== null) {
  console.log(`\nSuper Whisper DB読み込み中… (rowid=${rowId})`);
  rec = readSuperWhisperRecordingByRowId(rowId);
  if (!rec) {
    console.error(`rowid が見つかりません: ${rowId}`);
    process.exit(1);
  }
} else if (recordingId) {
  console.log(`\nSuper Whisper DB読み込み中… (recording.id=${recordingId})`);
  rec = readSuperWhisperRecordingById(recordingId);
  if (!rec) {
    console.error(`recording.id が見つかりません: ${recordingId}`);
    process.exit(1);
  }
} else {
  console.log(`\nSuper Whisper DB読み込み中… (${nth}番目に新しい録音)`);
  const rows = readSuperWhisperRecordings(nth + 2);
  if (rows.length < nth) {
    console.error(`録音が${nth}件未満です（現在${rows.length}件）`);
    process.exit(1);
  }
  rec = rows[nth - 1];
}
const mins = Math.round(rec.duration / 60);
console.log(`取得: ${rec.datetime}  ${mins}分`);
const preview = (rec.raw_text ?? "").slice(0, 100).replace(/\n/g, " ");
console.log(`冒頭: ${preview}…`);
console.log();

// 確認
if (mins < 10) {
  console.warn(`⚠ 録音時間が${mins}分と短いです。正しい音声か確認してください。`);
}

// --- テキスト補正 ---
const rawText = rec.raw_text ?? "";
if (!rawText.trim()) {
  console.error("⚠ Super Whisper の文字起こしが空です");
  process.exit(1);
}

// --- パート分割（10分休憩 or 文字数で分割） ---
const NOISE_PATTERNS = [
  /^ご視聴ありがとうございました[。]?$/,
  /^ありがとうございました[。]?$/,
];
const isNoise = (t) => NOISE_PATTERNS.some((p) => p.test(t.trim()));

// 「10分間休憩」で分割
const lines = rawText.split("\n");
const breakIndices = [];
lines.forEach((line, i) => {
  if (/10分間休憩/.test(line)) breakIndices.push(i);
});

const parts = [];
const boundaries = [0, ...breakIndices.map((i) => i + 1), lines.length];

for (let pi = 0; pi < boundaries.length - 1; pi++) {
  const slice = lines.slice(boundaries[pi], boundaries[pi + 1]);
  const cleaned = slice
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0 && !isNoise(l));

  if (cleaned.length === 0) continue;

  parts.push({
    index: parts.length + 1,
    label: `第${parts.length + 1}部`,
    transcript: cleaned.join("\n"),
  });
}

console.log(`${parts.length}部に分割:`);
parts.forEach((p) => {
  console.log(`  ${p.label}: ${p.transcript.length.toLocaleString()}文字`);
});

if (parts.length === 0) {
  console.error("⚠ テキストが空または全てノイズです");
  process.exit(1);
}

// --- claude -p で要約生成 ---
function claudeQuery(prompt) {
  const result = spawnSync("claude", ["-p", "--output-format", "text"], {
    input: prompt, encoding: "utf-8", timeout: 120_000, maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`claude -p failed: ${result.stderr?.trim().slice(0, 200)}`);
  return result.stdout.trim();
}

console.log("\n要約生成中...");
const segments = [];
for (const p of parts) {
  process.stdout.write(`  ${p.label}/${parts.length} ... `);
  const summarySource = applyCorrections(p.transcript, vocab);
  const truncated = summarySource.length > 6000
    ? summarySource.slice(0, 6000) + "\n…（省略）"
    : summarySource;
  const vocabNote = vocab
    ? `【正しい固有名詞】議員名：${(vocab.members ?? []).join("、")}。重要用語：${(vocab.key_terms ?? []).slice(0, 8).join("、")}。\n\n`
    : "";
  const prompt = `あなたは${councilName}の会議記録を整理するアシスタントです。
以下は${councilName}の文字起こし（${p.label}）です。次のJSON形式のみで回答してください:
{"summary":"3〜4文の日本語要約（誰が・何について・どう議論したか）","topics":["キーワード1","キーワード2","キーワード3","キーワード4"]}

${vocabNote}文字起こし:
${truncated}`;
  const out = claudeQuery(prompt);
  const json = JSON.parse(out.match(/\{[\s\S]*\}/)[0]);
  console.log("完了");
  segments.push({
    index: p.index,
    label: p.label,
    summary: json.summary,
    topics: json.topics ?? [],
    transcript: p.transcript,
  });
}

if (previewOnly) {
  const previewPath = path.join(ROOT, "tmp_audio", `${sessionId}.preview.json`);
  const preview = {
    city,
    session_id: sessionId,
    recording_datetime: rec.datetime,
    recording_duration_seconds: rec.duration,
    generated_at: new Date().toISOString(),
    full_transcript: rawText,
    segments,
  };
  fs.mkdirSync(path.dirname(previewPath), { recursive: true });
  fs.writeFileSync(previewPath, JSON.stringify(preview, null, 2));
  console.log(`\nプレビューを書き出しました: ${previewPath}`);
  console.log("data/ と site/data/ は更新していません");
  process.exit(0);
}

// --- 保存 ---
const updated = {
  ...session,
  city,
  full_transcript: rawText,
  generated_at: new Date().toISOString().split("T")[0],
  segments,
};

function save(baseDir) {
  const dest = path.join(baseDir, city, "sessions", `${sessionId}.json`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(updated, null, 2));
  console.log(`  保存: ${dest}`);

  const indexPath = path.join(baseDir, city, "sessions", "index.json");
  if (fs.existsSync(indexPath)) {
    const index = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    const entry = index.find((e) => e.id === sessionId);
    if (entry) {
      entry.segment_count = segments.length;
      entry.has_transcript = true;
      entry.has_summary = true;
    }
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  }
}

console.log("\n保存中...");
save(path.join(ROOT, "data"));
save(path.join(SITE_ROOT, "data"));

console.log(`\n✓ 完了！ ${segments.length}部の要約を生成しました`);
console.log("\n次のステップ:");
console.log("  cd /Users/yohei/gikai-map-hokkaido");
console.log(`  git add data/ site/data/`);
console.log(`  git commit -m "Add transcript: ${city} ${session.title}"`);
console.log("  git push");
