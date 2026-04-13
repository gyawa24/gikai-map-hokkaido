#!/usr/bin/env node
/**
 * strategist.mjs — 企画エージェント
 *
 * サービスのミッション・ユーザーニーズを分析し、
 * 「何を作るべきか」の方向性を discussion/strategy-{date}.md に書き出す。
 */
import { spawnSync } from "child_process";
import { readFileSync, writeFileSync, readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DISCUSSION_DIR = path.join(__dirname, "../discussion");

function getLatestDiscussion(prefix) {
  try {
    const files = readdirSync(DISCUSSION_DIR)
      .filter((f) => f.startsWith(prefix) && f.endsWith(".md"))
      .sort()
      .reverse();
    if (files.length === 0) return null;
    return readFileSync(path.join(DISCUSSION_DIR, files[0]), "utf-8");
  } catch {
    return null;
  }
}

function getCompletedSummary() {
  try {
    const history = JSON.parse(
      readFileSync(path.join(__dirname, "../history.json"), "utf-8")
    );
    return history.completed
      .slice(-10)
      .map((t) => `- [${t.id}] ${t.title}`)
      .join("\n");
  } catch {
    return "（なし）";
  }
}

export async function runStrategist() {
  const today = new Date().toISOString().split("T")[0];
  const outputPath = path.join(DISCUSSION_DIR, `strategy-${today}.md`);

  const completedSummary = getCompletedSummary();
  const prevStrategy = getLatestDiscussion("strategy-");

  const prompt = `あなたは「北海道議会情報マップ」の企画責任者エージェントです。

このサービスのコードベースとデータを調査し、**市民・議員・報道関係者の視点**から
「次に何を作ると最も価値があるか」を戦略的に分析してください。

## あなたのミッション
- 議会情報を市民に分かりやすく届けること
- 議員活動の透明性を高めること
- 北海道全79市町村への拡大

## 調査すべき情報
以下のファイルを Read/Glob/Grep で確認してください：
- DESIGN.md（サービス設計思想）
- site/src/app/ 以下（現在のページ構成）
- data/ 以下（利用可能なデータ）
- data/municipalities.json（対象市町村リスト）

## 最近完了した改善（参考）
${completedSummary}

${prevStrategy ? `## 前回の戦略（参考・継続性を保つこと）\n${prevStrategy.slice(0, 1000)}` : ""}

## 出力形式
以下の構成で Markdown を出力してください（コードブロック不要、そのまま出力）：

# 戦略提案 ${today}

## サービス現状の評価
（強み・弱み・機会を3点ずつ）

## ターゲットユーザー別の優先課題
### 市民向け
（最も価値のある改善を3点）
### 議員・関係者向け
（最も価値のある改善を3点）

## 次のフェーズで取り組むべき方向性
（優先度順に5つ、理由付きで）

## 避けるべき方向性
（リソースを無駄にしそうな改善）
`;

  console.log("🎯 Strategist: Analyzing service direction...");

  const result = spawnSync(
    "claude",
    [
      "--print",
      "--dangerously-skip-permissions",
      "--allowedTools", "Read,Glob,Grep",
      "-p", prompt,
    ],
    {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 10 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env },
    }
  );

  if (result.status !== 0 || result.error) {
    console.error("❌ Strategist failed:", result.stderr?.slice(0, 300));
    if (result.error) console.error(result.error.message);
    return null;
  }

  const output = result.stdout?.trim() ?? "";
  writeFileSync(outputPath, output, "utf-8");

  console.log(`✅ Strategist: Strategy written to discussion/strategy-${today}.md`);
  console.log("\n--- Strategy Preview ---");
  console.log(output.slice(0, 600));
  console.log("---\n");

  return output;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runStrategist().catch(console.error);
}
