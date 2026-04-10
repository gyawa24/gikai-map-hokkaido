#!/usr/bin/env node
/**
 * 公式議事録から要約・タグ・発言者リストを生成するスクリプト
 *
 * 使い方:
 *   node scripts/enrich-minutes.mjs --city chitose
 *   node scripts/enrich-minutes.mjs --city chitose --id 561
 *
 * 前提:
 *   - ANTHROPIC_API_KEY 環境変数が設定されていること
 *   - data/{city}/minutes/{id}.json が存在すること
 *
 * 出力:
 *   - data/{city}/minutes/enriched/{id}.json
 *   - site/data/{city}/minutes/enriched/{id}.json
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

const city = get("--city") ?? "chitose";
const targetId = get("--id"); // 指定なしなら全件処理

// --- パス ---
const dataMinutesDir = path.join(ROOT, "data", city, "minutes");
const siteMinutesDir = path.join(SITE_ROOT, "data", city, "minutes");
const enrichedDataDir = path.join(dataMinutesDir, "enriched");
const enrichedSiteDir = path.join(siteMinutesDir, "enriched");

fs.mkdirSync(enrichedDataDir, { recursive: true });
fs.mkdirSync(enrichedSiteDir, { recursive: true });

// --- Anthropic client ---
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// --- 発言者抽出（プログラムで） ---
function extractSpeakers(session) {
  const map = new Map();
  for (const schedule of session.schedules) {
    for (const m of schedule.minutes) {
      if (m.minute_type === "名簿" || m.minute_type === "△議題") continue;
      const name = m.title;
      if (!name || name.length > 20) continue; // 異常値スキップ
      if (!map.has(name)) {
        map.set(name, { name, minute_type: m.minute_type, speech_count: 0 });
      }
      map.get(name).speech_count++;
    }
  }

  return Array.from(map.values())
    .sort((a, b) => b.speech_count - a.speech_count)
    .map(({ name, minute_type, speech_count }) => {
      let role = "その他";
      if (minute_type === "○議長") role = "議長";
      else if (name.includes("市長") && minute_type === "◎答弁") role = "市長";
      else if (name.includes("副市長")) role = "副市長";
      else if (minute_type === "◆質問") role = "議員";
      else if (minute_type === "◎答弁") role = "理事者";
      return { name, role, speech_count };
    });
}

// --- AI用テキスト構築（質問・答弁・議題のみ） ---
function buildPromptText(session) {
  const lines = [`会議名: ${session.name}（${session.japanese_year}）\n`];
  for (const schedule of session.schedules) {
    lines.push(`\n【${schedule.name}】`);
    for (const m of schedule.minutes) {
      if (m.minute_type === "名簿") continue;
      if (m.minute_type === "△議題") {
        lines.push(`\n▼ 議題: ${m.text.replace(/^△/, "").trim()}`);
      } else if (m.minute_type === "◆質問" || m.minute_type === "○一般質問") {
        lines.push(`\n[質問 ${m.title}]\n${m.text.slice(0, 600)}`);
      } else if (m.minute_type === "◎答弁") {
        lines.push(`[答弁 ${m.title}]\n${m.text.slice(0, 300)}`);
      }
    }
  }
  return lines.join("\n");
}

// --- Claude で要約・タグ生成 ---
async function generateEnrichment(session) {
  const promptText = buildPromptText(session);

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: `以下は市議会の会議録です。市民向けに分かりやすく整理してください。

${promptText}

---
以下のJSON形式で回答してください（他のテキストは不要）:
{
  "summary": "この定例会全体の要約（200字程度、市民向けに平易な言葉で）",
  "highlights": ["主要な審議事項を3〜5点、各30字以内で箇条書き"],
  "tags": ["関連するテーマをタグとして10〜15個（例: 予算, 教育, 子育て, 農業, 防災, 観光, 福祉, 道路, 環境, 熊対策, DX, 企業誘致）"],
  "questioners": [
    {"name": "議員名（番号なし）", "topics": ["質問テーマ1", "質問テーマ2"]}
  ]
}`,
      },
    ],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";

  // JSON を抽出
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("JSON not found in response:\n" + text);
  return JSON.parse(match[0]);
}

// --- 単一ファイル処理 ---
async function processFile(councilId) {
  const srcFile = path.join(dataMinutesDir, `${councilId}.json`);
  const outDataFile = path.join(enrichedDataDir, `${councilId}.json`);
  const outSiteFile = path.join(enrichedSiteDir, `${councilId}.json`);

  if (!fs.existsSync(srcFile)) {
    console.error(`  ✗ ファイルが見つかりません: ${srcFile}`);
    return;
  }

  // 既にあればスキップ（--forceで上書き）
  if (fs.existsSync(outDataFile) && !args.includes("--force")) {
    console.log(`  ⏭  スキップ（既存）: ${councilId}`);
    return;
  }

  console.log(`  → 処理中: ${councilId}`);
  const session = JSON.parse(fs.readFileSync(srcFile, "utf-8"));
  console.log(`     ${session.name}`);

  const speakers = extractSpeakers(session);
  console.log(`     発言者: ${speakers.length}名`);

  const ai = await generateEnrichment(session);
  console.log(`     タグ: ${ai.tags.join(", ")}`);

  const result = {
    council_id: session.council_id,
    name: session.name,
    generated_at: new Date().toISOString().slice(0, 10),
    summary: ai.summary,
    highlights: ai.highlights ?? [],
    tags: ai.tags ?? [],
    speakers,
    questioners: ai.questioners ?? [],
  };

  const json = JSON.stringify(result, null, 2);
  fs.writeFileSync(outDataFile, json, "utf-8");
  fs.writeFileSync(outSiteFile, json, "utf-8");
  console.log(`     ✓ 保存: ${outDataFile}`);
}

// --- メイン ---
async function main() {
  const indexFile = path.join(dataMinutesDir, "index.json");
  const index = JSON.parse(fs.readFileSync(indexFile, "utf-8"));

  const targets = targetId
    ? index.filter((item) => String(item.council_id) === targetId)
    : index;

  console.log(`\n${city} 議事録エンリッチ処理: ${targets.length}件\n`);

  for (const item of targets) {
    await processFile(String(item.council_id));
    // レート制限対策
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log("\n完了");
}

main().catch((e) => { console.error(e); process.exit(1); });
