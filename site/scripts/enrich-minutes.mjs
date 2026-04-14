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

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import os from "os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SITE_ROOT = path.resolve(__dirname, "..");

// --- CLI引数 ---
const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };

// --city eniwa,tomakomai のようにカンマ区切りで複数指定可能
const cities = (get("--city") ?? "chitose").split(",").map((s) => s.trim());
const targetId = get("--id"); // 指定なしなら全件処理

// --- claude -p でMaxPlanを使ってテキスト生成 ---
function claudeQuery(prompt, retries = 5) {
  const tmpFile = path.join(os.tmpdir(), `claude-prompt-${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, prompt, "utf-8");
  try {
    for (let attempt = 0; attempt < retries; attempt++) {
      const result = spawnSync("claude", ["-p", "--output-format", "text"], {
        input: prompt,
        encoding: "utf-8",
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      if (result.status === 0) {
        return result.stdout.trim();
      }
      const err = result.stderr?.trim() ?? "";
      console.error(`     ⚠ claude -p エラー (attempt ${attempt + 1}): ${err.slice(0, 200)}`);
      if (attempt < retries - 1) {
        const wait = Math.pow(2, attempt + 2);
        console.log(`     ⏳ ${wait}秒後にリトライ`);
        // 同期待機
        const end = Date.now() + wait * 1000;
        while (Date.now() < end) { /* spin */ }
      } else {
        throw new Error(`claude -p failed after ${retries} attempts: ${err.slice(0, 200)}`);
      }
    }
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
}

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

// --- 議事録から質問者と大項目/中項目を直接抽出 ---
function extractQuestioners(session) {
  const questioners = new Map(); // name -> { name, topics: [] }

  for (const schedule of session.schedules) {
    let currentQuestioner = null;

    for (const m of schedule.minutes) {
      // "○○議員の一般質問" という△議題でセクション開始を検出
      if (m.minute_type === "△議題") {
        const gqMatch = m.text.match(/([^\s△]+)議員の一般質問/);
        if (gqMatch) {
          currentQuestioner = gqMatch[1]; // e.g. "吉谷徹"
          if (!questioners.has(currentQuestioner)) {
            questioners.set(currentQuestioner, { name: currentQuestioner, topics: [] });
          }
        } else {
          // 別の議員の質問セクションに移ったらリセット
          if (currentQuestioner && m.text.includes("議員")) {
            currentQuestioner = null;
          }
        }
      }

      // 質問テキストから大項目・中項目を抽出
      if (m.minute_type === "◆質問" && currentQuestioner && questioners.has(currentQuestioner)) {
        const q = questioners.get(currentQuestioner);
        const text = m.text;

        // 大項目: "大項目１、○○について" or "大項目１　○○について"
        const largeMatches = [...text.matchAll(/大項目\d+[、，　\s]+([^。\n中小]+について)/g)];
        for (const match of largeMatches) {
          const topic = match[1].trim().replace(/[　\s]+/g, "");
          if (topic && !q.topics.includes(topic)) {
            q.topics.push(topic);
          }
        }

        // 中項目: "中項目１、○○について"（大項目がない場合のフォールバック）
        if (largeMatches.length === 0) {
          const midMatches = [...text.matchAll(/中項目\d+[、，　\s]+([^。\n]+について)/g)];
          for (const match of midMatches) {
            const topic = match[1].trim().slice(0, 30);
            if (topic && !q.topics.includes(topic)) {
              q.topics.push(topic);
            }
          }
        }
      }
    }
  }

  // トピックが取れなかった議員はAI側に任せるためnullを返す
  return Array.from(questioners.values()).filter((q) => q.topics.length > 0);
}

// --- AI用テキスト構築（質問・答弁・議題のみ、文字数上限付き） ---
const MAX_PROMPT_CHARS = 60_000; // 約20,000トークン相当

function buildPromptText(session) {
  const lines = [`会議名: ${session.name}（${session.japanese_year}）\n`];
  let totalChars = lines[0].length;

  for (const schedule of session.schedules) {
    if (totalChars >= MAX_PROMPT_CHARS) {
      lines.push("\n（文字数制限により以降を省略）");
      break;
    }
    const header = `\n【${schedule.name}】`;
    lines.push(header);
    totalChars += header.length;

    for (const m of schedule.minutes) {
      if (totalChars >= MAX_PROMPT_CHARS) break;
      if (m.minute_type === "名簿") continue;

      let line = "";
      if (m.minute_type === "△議題") {
        line = `\n▼ 議題: ${m.text.replace(/^△/, "").trim()}`;
      } else if (m.minute_type === "◆質問" || m.minute_type === "○一般質問") {
        line = `\n[質問 ${m.title}]\n${m.text.slice(0, 400)}`;
      } else if (m.minute_type === "◎答弁") {
        line = `[答弁 ${m.title}]\n${m.text.slice(0, 200)}`;
      }
      if (line) {
        lines.push(line);
        totalChars += line.length;
      }
    }
  }
  return lines.join("\n");
}

// --- 語彙辞書を読み込む ---
function loadVocabulary(city) {
  const fp = path.join(ROOT, "data", city, "vocabulary.json");
  try { return JSON.parse(fs.readFileSync(fp, "utf-8")); } catch { return null; }
}

// --- claude -p で要約・タグ生成 ---
function generateEnrichment(session, city) {
  const promptText = buildPromptText(session);
  const vocab = loadVocabulary(city);
  const vocabNote = vocab
    ? `【正しい固有名詞】議員名：${(vocab.members ?? []).join("、")}。重要用語：${(vocab.key_terms ?? []).slice(0, 8).join("、")}。文字起こし中の誤表記は正しい表記に直してください。\n\n`
    : "";

  const prompt = `以下は市議会の会議録です。市民向けに分かりやすく整理してください。

${vocabNote}${promptText}

---
以下のJSON形式のみで回答してください（説明文・コードブロック不要）:
{
  "summary": "この定例会全体の要約（200字程度、市民向けに平易な言葉で）",
  "highlights": ["主要な審議事項を3〜5点、各30字以内で箇条書き"],
  "tags": ["関連するテーマをタグとして10〜15個（例: 予算, 教育, 子育て, 農業, 防災, 観光, 福祉, 道路, 環境, 熊対策, DX, 企業誘致）"],
  "questioners": [
    {"name": "議員名（番号なし）", "topics": ["質問テーマ1", "質問テーマ2"]}
  ]
}`;

  const text = claudeQuery(prompt);

  // マークダウンコードブロックを除去
  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("JSON not found in response:\n" + text);

  let jsonStr = cleaned.slice(start, end + 1);
  jsonStr = jsonStr.replace(/"([^"\\]*(\\.[^"\\]*)*)"/gs, (match) =>
    match.replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")
  );

  try {
    return JSON.parse(jsonStr);
  } catch (parseErr) {
    console.error("     ⚠ JSONパース失敗。生レスポンス:\n" + text.slice(0, 500));
    throw parseErr;
  }
}

// --- 単一ファイル処理 ---
async function processFile(councilId, city) {
  const dataMinutesDir = path.join(ROOT, "data", city, "minutes");
  const siteMinutesDir = path.join(SITE_ROOT, "data", city, "minutes");
  const enrichedDataDir = path.join(dataMinutesDir, "enriched");
  const enrichedSiteDir = path.join(siteMinutesDir, "enriched");
  fs.mkdirSync(enrichedDataDir, { recursive: true });
  fs.mkdirSync(enrichedSiteDir, { recursive: true });

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
    return false; // skipped
  }

  console.log(`  → 処理中: ${councilId}`);
  const session = JSON.parse(fs.readFileSync(srcFile, "utf-8"));
  console.log(`     ${session.name}`);

  // 発言ゼロの空議事録はスキップ
  const totalMinutes = session.schedules?.reduce((n, s) => n + (s.minutes?.length ?? 0), 0) ?? 0;
  if (totalMinutes === 0) {
    console.log(`     ⏭  スキップ（発言なし）`);
    return false; // skipped
  }

  const speakers = extractSpeakers(session);
  console.log(`     発言者: ${speakers.length}名`);

  const ai = generateEnrichment(session, city);
  console.log(`     タグ: ${ai.tags.join(", ")}`);

  // 議事録から直接抽出した質問者を優先、AIで補完
  const structuredQuestioners = extractQuestioners(session);
  const aiQuestioners = ai.questioners ?? [];

  // マージ: 直接抽出 優先、AIの名前と照合して補完
  const mergedQuestioners = structuredQuestioners.length > 0
    ? structuredQuestioners.map((sq) => {
        const aiMatch = aiQuestioners.find((aq) =>
          aq.name.includes(sq.name) || sq.name.includes(aq.name)
        );
        return {
          name: sq.name,
          topics: sq.topics,
          // AIのトピックも追記（重複除外）
          ai_topics: aiMatch ? aiMatch.topics.filter((t) => !sq.topics.includes(t)) : [],
        };
      })
    : aiQuestioners.map((q) => ({ name: q.name, topics: q.topics, ai_topics: [] }));

  console.log(`     質問者(直接抽出): ${structuredQuestioners.length}名`);

  const result = {
    council_id: session.council_id,
    name: session.name,
    generated_at: new Date().toISOString().slice(0, 10),
    summary: ai.summary,
    highlights: ai.highlights ?? [],
    tags: ai.tags ?? [],
    speakers,
    questioners: mergedQuestioners,
  };

  const json = JSON.stringify(result, null, 2);
  fs.writeFileSync(outDataFile, json, "utf-8");
  fs.writeFileSync(outSiteFile, json, "utf-8");
  console.log(`     ✓ 保存: ${outDataFile}`);
  return true; // processed
}

// --- 都市単位の処理 ---
async function processCity(city) {
  const dataMinutesDir = path.join(ROOT, "data", city, "minutes");
  const indexFile = path.join(dataMinutesDir, "index.json");
  const index = JSON.parse(fs.readFileSync(indexFile, "utf-8"));

  const targets = targetId
    ? index.filter((item) => String(item.council_id) === targetId)
    : index;

  console.log(`\n[${city}] エンリッチ処理: ${targets.length}件`);

  let ok = 0, skip = 0, fail = 0;
  for (const item of targets) {
    try {
      const processed = await processFile(String(item.council_id), city);
      if (processed === false) {
        skip++;
      } else {
        ok++;
        // API呼び出し後は8秒待機（レート制限対策）
        await new Promise((r) => setTimeout(r, 8000));
      }
    } catch (err) {
      console.error(`  ✗ エラー (${item.council_id}): ${err.message.slice(0, 120)}`);
      fail++;
      // エラー後は60秒待機してレート制限解除を待つ
      console.log(`     ⏳ 60秒待機中...`);
      await new Promise((r) => setTimeout(r, 60000));
    }
  }
  console.log(`[${city}] 成功:${ok} スキップ:${skip} 失敗:${fail}`);

  console.log(`[${city}] 完了`);
}

// --- メイン（複数都市を順番に処理） ---
async function main() {
  console.log(`\n対象都市: ${cities.join(", ")}`);
  for (const c of cities) {
    await processCity(c);
  }
  console.log("\nすべて完了");
}

main().catch((e) => { console.error(e); process.exit(1); });
