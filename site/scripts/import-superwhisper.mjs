#!/usr/bin/env node
/**
 * Super Whisperのmeta.jsonからセッションJSONを生成するスクリプト
 *
 * 使い方:
 *   node scripts/import-superwhisper.mjs \
 *     --id r8-yosan-4th-20260323 \
 *     --meta /path/to/meta.json
 *
 * 前提: ANTHROPIC_API_KEY 環境変数が設定されていること
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SITE_ROOT = path.resolve(__dirname, "..");

// --- CLI引数 ---
const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

const sessionId = get("--id");
const metaPath  = get("--meta");

if (!sessionId || !metaPath) {
  console.error("Usage: node import-superwhisper.mjs --id <id> --meta <path/to/meta.json>");
  process.exit(1);
}

// --- セッションJSONを読み込む ---
const sessionFile = path.join(ROOT, "data", "chitose", "sessions", `${sessionId}.json`);
if (!fs.existsSync(sessionFile)) {
  console.error(`Session file not found: ${sessionFile}`);
  process.exit(1);
}
const session = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));

// --- meta.json を読み込む ---
console.log("meta.json 読み込み中...");
const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
const allSegs = meta.segments; // [{start, end, text}, ...]

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
  let prev = "";
  for (const s of partSegs) {
    const t = s.text.trim();
    if (!isNoise(t) && t !== prev && t.length > 0) {
      cleaned.push(s);
      prev = t;
    }
  }

  if (cleaned.length === 0) continue;

  const text = cleaned.map((s) => s.text.trim()).join("\n");
  const startTime = cleaned[0].start;
  const endTime   = cleaned[cleaned.length - 1].end;

  parts.push({
    index: parts.length + 1,
    label: `第${parts.length + 1}部`,
    start_time: formatTime(startTime),
    end_time:   formatTime(endTime),
    transcript: text,
    char_count: text.length,
  });
}

console.log(`\n${parts.length}部に分割:`);
parts.forEach((p) =>
  console.log(`  ${p.label}: ${p.start_time}〜${p.end_time} (${p.char_count.toLocaleString()}文字)`)
);

// --- Claude API で要約生成 ---
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("\nエラー: ANTHROPIC_API_KEY が設定されていません");
  process.exit(1);
}

const client = new Anthropic();

async function summarize(text, label, total) {
  process.stdout.write(`  ${label}（全${total}部） 要約生成中... `);
  const truncated = text.length > 6000 ? text.slice(0, 6000) + "\n…（省略）" : text;

  const res = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 400,
    system: "あなたは北海道千歳市議会の会議記録を整理するアシスタントです。",
    messages: [{
      role: "user",
      content: `以下は千歳市議会（予算特別委員会）の文字起こし（${label}）です。
次のJSON形式のみで回答してください:

{
  "summary": "3〜4文の日本語要約（誰が・何について・どう議論したか）",
  "topics": ["キーワード1", "キーワード2", "キーワード3", "キーワード4"]
}

文字起こし:
${truncated}`,
    }],
  });

  const json = JSON.parse(res.content[0].text.match(/\{[\s\S]*\}/)[0]);
  console.log(`完了 (in:${res.usage.input_tokens} out:${res.usage.output_tokens})`);
  return json;
}

console.log("\n要約生成中...");
const segments = [];
for (const part of parts) {
  const result = await summarize(part.transcript, part.label, parts.length);
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
  generated_at: new Date().toISOString().split("T")[0],
  segments,
};

const save = (dir) => {
  const dest = path.join(dir, "chitose", "sessions", `${sessionId}.json`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(updated, null, 2), "utf-8");
  console.log(`  保存: ${dest}`);

  const indexPath = path.join(dir, "chitose", "sessions", "index.json");
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
console.log('  git commit -m "Add transcript: 令和8年予算特別委員会第4日目"');
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
