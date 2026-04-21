#!/usr/bin/env node
/**
 * generate-tasks.mjs
 * claude --print (Max plan) でコードベースを分析し、
 * 新しい改善タスクを自動生成して backlog.json に追加する
 */
import { spawnSync } from "child_process";
import { readFileSync, writeFileSync, readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BACKLOG_PATH = path.join(__dirname, "backlog.json");

function readBacklog() {
  try {
    return JSON.parse(readFileSync(BACKLOG_PATH, "utf-8"));
  } catch {
    return { tasks: [] };
  }
}

function writeBacklog(data) {
  writeFileSync(BACKLOG_PATH, JSON.stringify(data, null, 2) + "\n");
}

function nextTaskId(tasks) {
  const nums = tasks
    .map((t) => parseInt(t.id.replace("task-", ""), 10))
    .filter((n) => !isNaN(n));
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return max + 1;
}

function gatherDataOverview() {
  const dataDir = path.join(ROOT, "data");
  try {
    return readdirSync(dataDir)
      .filter((f) => {
        try { return readdirSync(path.join(dataDir, f)).length > 0; } catch { return false; }
      })
      .map((city) => {
        let files = [];
        try { files = readdirSync(path.join(dataDir, city)); } catch {}
        return `${city}: [${files.join(", ")}]`;
      })
      .join("\n");
  } catch {
    return "";
  }
}

export async function generateTasks(count = 5) {
  const backlog = readBacklog();
  const startNum = nextTaskId(backlog.tasks);
  const existingTasksSummary = backlog.tasks
    .map((t) => `[${t.id}] [${t.status}] ${t.title}`)
    .join("\n") || "（なし）";

  const dataOverview = gatherDataOverview();

  const prompt = `あなたは地方議会ドットコム（Next.js + Tailwind CSS製）の改善エキスパートです。

このリポジトリ（/Users/yohei/gikai-map-hokkaido）のコードベースを Read/Glob/Grep ツールで確認し、
改善タスクを ${count} 件提案してください。

## データディレクトリの概要（参考）
${dataOverview}

## 既存タスク（重複禁止）
${existingTasksSummary}

## 確認すべき主なファイル
- DESIGN.md（デザイン仕様）
- site/src/app/ 以下のページ構成
- site/src/components/ 以下のコンポーネント
- data/ 以下のデータファイル（未活用データがないか）

## 観点
- データは存在するがサイトに未反映なもの
- chitose にあって eniwa/tomakomai にない機能
- DESIGN.md に定義されているが未実装のパターン
- ユーザー体験・アクセシビリティ・SEO の改善

## 出力形式
JSON のみ出力してください（前後に説明文不要）。
タスク ID は task-${String(startNum).padStart(3, "0")} から連番で付けること。

{
  "tasks": [
    {
      "id": "task-${String(startNum).padStart(3, "0")}",
      "title": "短いタイトル",
      "category": "feature | ux | data | bug | accessibility | seo",
      "priority": "high | medium | low",
      "status": "pending",
      "description": "どのファイルをどう変更するか、エージェントへの具体的な実装指示",
      "acceptance_criteria": ["完了条件1", "完了条件2"],
      "created_at": "${new Date().toISOString().split("T")[0]}"
    }
  ]
}`;

  console.log(`🔍 Analyzing codebase with Claude (Max plan)...`);

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
    console.error("❌ claude command failed:");
    console.error(result.stderr?.slice(0, 500));
    if (result.error) console.error(result.error.message);
    process.exit(1);
  }

  const rawText = result.stdout?.trim() ?? "";

  // JSONを抽出（マークダウンコードブロック対応）
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("❌ Could not extract JSON from response:");
    console.error(rawText.slice(0, 800));
    process.exit(1);
  }

  let newTasksData;
  try {
    newTasksData = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error("❌ JSON parse error:", e.message);
    console.error(rawText.slice(0, 500));
    process.exit(1);
  }

  const newTasks = newTasksData.tasks ?? [];
  backlog.tasks.push(...newTasks);
  writeBacklog(backlog);

  console.log(`\n✅ Generated ${newTasks.length} new tasks:\n`);
  newTasks.forEach((t) => {
    const icon = { high: "🔴", medium: "🟡", low: "🟢" }[t.priority] ?? "⚪";
    console.log(`  ${icon} [${t.id}] ${t.title}`);
  });
  console.log();
}

// 直接実行された場合
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const count = parseInt(process.argv[2] ?? "5", 10);
  generateTasks(count).catch(console.error);
}
