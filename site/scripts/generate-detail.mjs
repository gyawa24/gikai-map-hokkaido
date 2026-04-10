#!/usr/bin/env node
/**
 * セグメントの詳細データ（Q&Aカード形式）を生成するスクリプト
 *
 * 使い方:
 *   node scripts/generate-detail.mjs --id r8-yosan-4th-20260323 --segment 4
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SITE_ROOT = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const get = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
const sessionId = get("--id");
const segIndex = parseInt(get("--segment") ?? "1", 10);

if (!sessionId) {
  console.error("Usage: node generate-detail.mjs --id <session-id> --segment <index>");
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY が設定されていません");
  process.exit(1);
}

const sessionFile = path.join(ROOT, "data", "chitose", "sessions", `${sessionId}.json`);
const session = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
const seg = session.segments.find((s) => s.index === segIndex);
if (!seg) { console.error(`segment ${segIndex} not found`); process.exit(1); }

console.log(`対象: ${session.title} ${seg.label} (${seg.start_time}〜)`);
console.log(`文字起こし: ${seg.transcript.length}文字`);

const client = new Anthropic();

const MAX_CHARS = 18000;
const transcript = seg.transcript.length > MAX_CHARS
  ? seg.transcript.slice(0, MAX_CHARS) + "\n…（省略）"
  : seg.transcript;

console.log("\n詳細データ生成中 (claude-sonnet-4-6)...");

const res = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 4096,
  system: "あなたは北海道千歳市議会の会議記録を分析するアシスタントです。議員の質問と執行部の答弁を正確に把握し、構造化して返してください。",
  messages: [{
    role: "user",
    content: `以下は千歳市議会の文字起こしです。議員の質問と執行部の答弁を整理し、下記のJSON形式のみで回答してください。

形式:
{
  "speaker": "質問者名（例: 小川委員）",
  "overview": "この質疑全体の概要（4〜5文。誰が・何について・どんな答弁が得られたか）",
  "topics": [
    {
      "theme": "テーマ名（10字以内）",
      "icon": "テーマを表す絵文字1文字",
      "color": "テーマカラー（hex）例: #1B3A6B / #16a34a / #9333ea / #ea580c",
      "summary": "このテーマの概要（2〜3文）",
      "qa": [
        {
          "q": "委員の質問要旨（1〜2文）",
          "a": "執行部の答弁要旨（1〜2文）"
        }
      ]
    }
  ]
}

文字起こし:
${transcript}`,
  }],
});

function parseDetail(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    console.error("JSONブロックが見つかりません。レスポンス:\n", text.slice(0, 300));
    return null;
  }
  const cleaned = match[0]
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/[\x00-\x1F\x7F]/g, (c) => ["\n","\r","\t"].includes(c) ? c : "");
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const pos = parseInt(e.message.match(/position (\d+)/)?.[1] ?? "0");
    console.error("JSON parse error at position", pos);
    console.error("Context:", JSON.stringify(cleaned.slice(Math.max(0,pos-100), pos+100)));
    return null;
  }
}

// 最大3回リトライ
let detail = null;
for (let attempt = 1; attempt <= 3; attempt++) {
  if (attempt > 1) console.log(`  リトライ ${attempt}/3...`);
  detail = parseDetail(res.content[0].text);
  if (detail) break;
  if (attempt < 3) {
    const res2 = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: "あなたは北海道千歳市議会の会議記録を分析するアシスタントです。議員の質問と執行部の答弁を正確に把握し、構造化して返してください。",
      messages: [{
        role: "user",
        content: `以下は千歳市議会の文字起こしです。JSONのみで回答してください（説明文不要）。

{"speaker":"...","overview":"...","topics":[{"theme":"...","icon":"...","color":"#1B3A6B","summary":"...","qa":[{"q":"...","a":"..."}]}]}

文字起こし:\n${transcript}`,
      }],
    });
    detail = parseDetail(res2.content[0].text);
    if (detail) break;
  }
}

if (!detail) { console.error("生成失敗"); process.exit(1); }

console.log(`\n生成完了: ${detail.topics.length}テーマ`);
detail.topics.forEach((t) => console.log(`  ${t.icon} ${t.theme}: Q&A ${t.qa.length}件`));

// セグメントに detail フィールドを追加
seg.detail = detail;

// 保存
for (const dir of [
  path.join(ROOT, "data", "chitose", "sessions"),
  path.join(SITE_ROOT, "data", "chitose", "sessions"),
]) {
  fs.writeFileSync(
    path.join(dir, `${sessionId}.json`),
    JSON.stringify(session, null, 2),
    "utf-8"
  );
}

console.log(`\n保存完了: ${sessionId}.json`);
console.log(`usage: in=${res.usage.input_tokens} out=${res.usage.output_tokens}`);
