#!/usr/bin/env node
/**
 * 全セッションの全セグメントに詳細Q&Aカードを一括生成
 *
 * 使い方:
 *   cd /Users/yohei/gikai-map-hokkaido/site
 *   ANTHROPIC_API_KEY=... node scripts/batch-generate-detail.mjs
 *
 * オプション:
 *   --skip-done   detail済みセグメントをスキップ（デフォルトON）
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SITE_ROOT = path.resolve(__dirname, "..");

const skipDone = !process.argv.includes("--no-skip");

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY が設定されていません");
  process.exit(1);
}
const client = new Anthropic();

// 対象セッションを収集
const indexPath = path.join(ROOT, "data", "chitose", "sessions", "index.json");
const index = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
const targets = index.filter((s) => s.segment_count > 0 && s.has_summary);

let total = 0, done = 0, fail = 0;

for (const entry of targets) {
  const sessionFile = path.join(ROOT, "data", "chitose", "sessions", `${entry.id}.json`);
  const session = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));

  for (const seg of session.segments) {
    if (skipDone && seg.detail) {
      console.log(`  スキップ: ${entry.id} 第${seg.index}部 (detail済み)`);
      continue;
    }
    if (!seg.transcript) {
      console.log(`  スキップ: ${entry.id} 第${seg.index}部 (文字起こしなし)`);
      continue;
    }

    total++;
    console.log(`\n[${total}] ${entry.title} 第${seg.index}部 (${seg.start_time ?? "?"}〜)`);

    const MAX_CHARS = 18000;
    const transcript = seg.transcript.length > MAX_CHARS
      ? seg.transcript.slice(0, MAX_CHARS) + "\n…（省略）"
      : seg.transcript;

    try {
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

      const parseDetail = (text) => {
        const m = text.match(/\{[\s\S]*\}/);
        if (!m) return null;
        const c = m[0].replace(/,\s*([}\]])/g, "$1").replace(/[\x00-\x1F\x7F]/g, (ch) => ["\n","\r","\t"].includes(ch) ? ch : "");
        try { return JSON.parse(c); } catch { return null; }
      };

      let detail = parseDetail(res.content[0].text);
      if (!detail) {
        console.log("  JSONなし、リトライ...");
        const res2 = await client.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          system: "あなたは北海道千歳市議会の会議記録を分析するアシスタントです。",
          messages: [{ role: "user", content: `JSONのみで回答してください。\n{"speaker":"...","overview":"...","topics":[{"theme":"...","icon":"...","color":"#1B3A6B","summary":"...","qa":[{"q":"...","a":"..."}]}]}\n\n文字起こし:\n${transcript}` }],
        });
        detail = parseDetail(res2.content[0].text);
      }
      if (!detail) throw new Error("JSON生成失敗");

      seg.detail = detail;
      console.log(`  完了: ${detail.speaker} / ${detail.topics.length}テーマ (in:${res.usage.input_tokens} out:${res.usage.output_tokens})`);
      done++;

      // 保存（セグメントを更新後に毎回書き込む）
      for (const dir of [
        path.join(ROOT, "data", "chitose", "sessions"),
        path.join(SITE_ROOT, "data", "chitose", "sessions"),
      ]) {
        fs.writeFileSync(path.join(dir, `${entry.id}.json`), JSON.stringify(session, null, 2));
      }

    } catch (err) {
      console.error(`  エラー: ${err.message}`);
      fail++;
    }
  }
}

console.log(`\n${"=".repeat(50)}`);
console.log(`完了: ${done}件成功 / ${fail}件失敗 (合計${total}件)`);
