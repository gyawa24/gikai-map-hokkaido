#!/usr/bin/env node
/**
 * 議会中継の文字起こしテキストから要約JSONを生成するスクリプト
 *
 * 使い方:
 *   node scripts/summarize-session.mjs \
 *     --id r8-yosan-4th-20260323 \
 *     --transcript /path/to/transcript.txt
 *
 * 前提:
 *   - ANTHROPIC_API_KEY 環境変数が設定されていること
 *   - 文字起こしテキストの休憩箇所に「---」または「[休憩]」を挿入しておくこと
 *     （Super Whisperの出力をそのまま使う場合は自動分割も可能）
 *
 * 出力:
 *   - ../data/chitose/sessions/{id}.json を更新
 *   - ./data/chitose/sessions/{id}.json を更新（サイト用コピー）
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SITE_ROOT = path.resolve(__dirname, "..");

// --- CLI引数パース ---
const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
};

const sessionId = get("--id");
const transcriptPath = get("--transcript");

if (!sessionId || !transcriptPath) {
  console.error("Usage: node summarize-session.mjs --id <session-id> --transcript <path>");
  process.exit(1);
}

// --- 既存のセッションJSONを読み込む ---
const sessionFile = path.join(ROOT, "data", "chitose", "sessions", `${sessionId}.json`);
if (!fs.existsSync(sessionFile)) {
  console.error(`Session file not found: ${sessionFile}`);
  process.exit(1);
}
const session = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));

// --- 文字起こしテキストを読み込む ---
const rawTranscript = fs.readFileSync(transcriptPath, "utf-8");

// --- 休憩で分割 ---
// 対応するマーカー: "---", "[休憩]", "（休憩）", "〔休憩〕"
const BREAK_PATTERN = /(?:\n|^)(?:---|[\[〔（]休憩[\]〕）])(?:\n|$)/gm;
const rawSegments = rawTranscript.split(BREAK_PATTERN).map((s) => s.trim()).filter(Boolean);

if (rawSegments.length === 0) {
  console.error("テキストが空か、分割できませんでした。");
  process.exit(1);
}

console.log(`\nセッション: ${session.title}`);
console.log(`分割数: ${rawSegments.length} 部`);
console.log(`総文字数: ${rawTranscript.length.toLocaleString()} 文字\n`);

// --- Claude API で要約生成 ---
const client = new Anthropic();

async function summarizeSegment(text, idx, total) {
  const label = `第${idx + 1}部（全${total}部）`;
  process.stdout.write(`  ${label} 要約生成中... `);

  // トークン節約: 1セグメント最大6000文字まで送信
  const truncated = text.length > 6000 ? text.slice(0, 6000) + "\n…（以下省略）" : text;

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 400,
    system: "あなたは北海道千歳市議会の会議記録を整理するアシスタントです。",
    messages: [
      {
        role: "user",
        content: `以下は千歳市議会の会議文字起こし（${label}）です。
次のJSON形式のみで回答してください（余分なテキスト不要）:

{
  "summary": "3〜4文の日本語要約（誰が・何について・どう議論したか）",
  "topics": ["キーワード1", "キーワード2", "キーワード3"]
}

文字起こし:
${truncated}`,
      },
    ],
  });

  const content = response.content[0].text;
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`JSON parse failed:\n${content}`);

  const result = JSON.parse(jsonMatch[0]);
  const usage = response.usage;
  console.log(`完了 (入力:${usage.input_tokens} / 出力:${usage.output_tokens} tokens)`);
  return result;
}

// --- 全セグメントを処理 ---
const segments = [];
let totalInputTokens = 0;
let totalOutputTokens = 0;

for (let i = 0; i < rawSegments.length; i++) {
  const result = await summarizeSegment(rawSegments[i], i, rawSegments.length);

  // タイムスタンプ抽出（Super Whisperが "[00:00:00]" 形式で出力する場合）
  const tsMatch = rawSegments[i].match(/^\[?(\d{1,2}:\d{2}(?::\d{2})?)/);
  const startTime = tsMatch ? tsMatch[1] : undefined;

  segments.push({
    index: i + 1,
    label: `第${i + 1}部`,
    ...(startTime && { start_time: startTime }),
    summary: result.summary,
    topics: result.topics ?? [],
    transcript: rawSegments[i],
  });
}

// --- セッションJSONを更新 ---
const updatedSession = {
  ...session,
  generated_at: new Date().toISOString().split("T")[0],
  segments,
};

const save = (dir) => {
  const dest = path.join(dir, "chitose", "sessions", `${sessionId}.json`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(updatedSession, null, 2), "utf-8");
  console.log(`  保存: ${dest}`);

  // index.json も更新
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
    console.log(`  index.json 更新: ${indexPath}`);
  }
};

console.log("\n保存中...");
save(path.join(ROOT, "data"));
save(path.join(SITE_ROOT, "data"));

console.log(`\n完了！ ${segments.length}部の要約を生成しました。`);
console.log("次のステップ: git add / commit / push でサイトを更新してください。");
