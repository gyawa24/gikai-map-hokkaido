#!/usr/bin/env node
/**
 * Super Whisperのmeta.jsonからセッションJSONを生成するスクリプト
 *
 * 使い方:
 *   node scripts/import-superwhisper.mjs \
 *     --city chitose \
 *     --id r8-teireikai1-day3-20260310 \
 *     --meta /path/to/meta.json
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SITE_ROOT = path.resolve(__dirname, "..");

// --- CLI引数 ---
const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

const city = get("--city") ?? "chitose";
const sessionId = get("--id");
const metaPath  = get("--meta");

if (!sessionId || !metaPath) {
  console.error("Usage: node import-superwhisper.mjs --city <slug> --id <id> --meta <path/to/meta.json>");
  process.exit(1);
}

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

// --- claude -p でテキスト生成 ---
function claudeQuery(prompt) {
  const result = spawnSync("claude", ["-p", "--output-format", "text"], {
    input: prompt, encoding: "utf-8", timeout: 120_000, maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`claude -p failed: ${result.stderr?.trim().slice(0, 200)}`);
  return result.stdout.trim();
}

// --- セッションJSONを読み込む ---
const sessionFile = path.join(ROOT, "data", city, "sessions", `${sessionId}.json`);
if (!fs.existsSync(sessionFile)) {
  console.error(`Session file not found: ${sessionFile}`);
  process.exit(1);
}
const session = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
const vocab = loadVocabulary(city);
const councilName = getCouncilName(city, vocab);
if (vocab) console.log(`語彙辞書: ${vocab.corrections?.length ?? 0}件の補正ルール`);

// --- meta.json を読み込む ---
console.log("meta.json 読み込み中...");
const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
const allSegs = meta.segments; // [{start, end, text}, ...]
const fullTranscript = allSegs
  .map((s) => String(s.text ?? "").trimEnd())
  .filter(Boolean)
  .join("\n");

// --- ノイズフィルター ---
const NOISE_PATTERNS = [
  /^ご視聴ありがとうございました[。]?$/,
  /^ありがとうございました[。]?$/,
  /^以上で終わります[。]?$/,
];
const isNoise = (text) => NOISE_PATTERNS.some((p) => p.test(text.trim()));

// ノイズでない最初のセグメントを探す
const firstReal = allSegs.findIndex((s) => !isNoise(s.text));

// 10分休憩のセグメントインデックスを探す
const breakIndices = allSegs.reduce((acc, s, i) => {
  if (/10分間休憩/.test(s.text)) acc.push(i);
  return acc;
}, []);

console.log(`実際の発言開始: ${(allSegs[firstReal].start / 60).toFixed(1)}分`);
console.log(`休憩検出: ${breakIndices.length}か所`);
breakIndices.forEach((i) => {
  console.log(`  ${(allSegs[i].start / 60).toFixed(1)}分: ${allSegs[i].text}`);
});

// --- パートに分割 ---
const boundaries = [firstReal, ...breakIndices.map((i) => i + 1), allSegs.length];

const parts = [];
for (let pi = 0; pi < boundaries.length - 1; pi++) {
  const startIdx = boundaries[pi];
  const endIdx   = boundaries[pi + 1];
  const partSegs = allSegs.slice(startIdx, endIdx);

  // ノイズを除去し、連続する同一テキストを1つにまとめる
  const cleaned = [];
  for (const s of partSegs) {
    const t = s.text.trimEnd();
    if (!isNoise(t) && t.trim().length > 0) {
      cleaned.push(s);
    }
  }

  if (cleaned.length === 0) continue;

  const rawText = cleaned.map((s) => s.text.trimEnd()).join("\n");
  const startTime = cleaned[0].start;
  const endTime   = cleaned[cleaned.length - 1].end;

  parts.push({
    index: parts.length + 1,
    label: `第${parts.length + 1}部`,
    start_time: formatTime(startTime),
    end_time:   formatTime(endTime),
    transcript: rawText,
    char_count: rawText.length,
  });
}

console.log(`\n${parts.length}部に分割:`);
parts.forEach((p) =>
  console.log(`  ${p.label}: ${p.start_time}〜${p.end_time} (${p.char_count.toLocaleString()}文字)`)
);

// --- 要約生成（claude -p / MaxPlan） ---
function summarize(text, label, total) {
  process.stdout.write(`  ${label}（全${total}部） 要約生成中... `);
  const summarySource = applyCorrections(text, vocab);
  const truncated = summarySource.length > 6000 ? summarySource.slice(0, 6000) + "\n…（省略）" : summarySource;
  const vocabNote = vocab
    ? `【正しい固有名詞】議員名：${(vocab.members ?? []).join("、")}。重要用語：${(vocab.key_terms ?? []).slice(0, 8).join("、")}。\n\n`
    : "";
  const prompt = `あなたは${councilName}の会議記録を整理するアシスタントです。
以下は${councilName}の文字起こし（${label}）です。次のJSON形式のみで回答してください:
{"summary":"3〜4文の日本語要約（誰が・何について・どう議論したか）","topics":["キーワード1","キーワード2","キーワード3","キーワード4"]}

${vocabNote}文字起こし:
${truncated}`;
  const text2 = claudeQuery(prompt);
  const json = JSON.parse(text2.match(/\{[\s\S]*\}/)[0]);
  console.log("完了");
  return json;
}

console.log("\n要約生成中...");
const segments = [];
for (const part of parts) {
  const result = summarize(part.transcript, part.label, parts.length);
  segments.push({
    index:      part.index,
    label:      part.label,
    start_time: part.start_time,
    end_time:   part.end_time,
    summary:    result.summary,
    topics:     result.topics ?? [],
    transcript: part.transcript,
  });
}

// --- 保存 ---
const updated = {
  ...session,
  city,
  full_transcript: fullTranscript,
  generated_at: new Date().toISOString().split("T")[0],
  segments,
};

const save = (dir) => {
  const dest = path.join(dir, city, "sessions", `${sessionId}.json`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(updated, null, 2), "utf-8");
  console.log(`  保存: ${dest}`);

  const indexPath = path.join(dir, city, "sessions", "index.json");
  if (fs.existsSync(indexPath)) {
    const index = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    const entry = index.find((e) => e.id === sessionId);
    if (entry) {
      entry.segment_count = segments.length;
      entry.has_transcript = true;
      entry.has_summary = true;
    }
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf-8");
  }
};

console.log("\n保存中...");
save(path.join(ROOT, "data"));
save(path.join(SITE_ROOT, "data"));

console.log(`\n完了！ ${segments.length}部の要約を生成しました。`);
console.log("\n次のステップ:");
console.log("  cd /Users/yohei/gikai-map-hokkaido");
console.log("  git add data/ site/data/");
console.log(`  git commit -m "Add transcript: ${city} ${session.title}"`);
console.log("  git push");

// --- ユーティリティ ---
function formatTime(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}
