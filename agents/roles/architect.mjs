#!/usr/bin/env node
/**
 * architect.mjs — 設計エージェント
 *
 * Strategist の戦略を受け取り、技術的実現方法を検討して
 * 具体的なタスクを backlog.json に追加する。
 * discussion/architecture-{date}.md に設計判断を記録する。
 */
import { spawnSync } from "child_process";
import { readFileSync, writeFileSync, readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DISCUSSION_DIR = path.join(__dirname, "../discussion");
const BACKLOG_PATH = path.join(__dirname, "../backlog.json");

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

export async function runArchitect(strategy, count = 5) {
  const today = new Date().toISOString().split("T")[0];
  const outputPath = path.join(DISCUSSION_DIR, `architecture-${today}.md`);

  const backlog = readBacklog();
  const startNum = nextTaskId(backlog.tasks);
  const existingTasks = backlog.tasks
    .filter((t) => t.status === "pending")
    .map((t) => `[${t.id}] ${t.title}`)
    .join("\n") || "（なし）";

  const strategyText = strategy || getLatestDiscussion("strategy-") || "（戦略なし）";

  const prompt = `あなたは「地方議会ドットコム」の技術設計エージェントです。

企画エージェントの戦略を受け取り、コードベースを調査して
**具体的・実装可能なタスク** ${count} 件を設計してください。

## 企画エージェントからの戦略
${strategyText}

## あなたの役割
1. 戦略の各提案を技術的に評価する
2. 実装可能性・工数・リスクを判断する
3. 具体的なファイルパスと実装手順を含むタスクを作成する
4. 過大な工数のタスクは分割する

## 調査すべきファイル
- site/src/app/ 以下（既存ページ構成）
- site/src/components/ 以下（コンポーネント）
- data/ 以下（利用可能データ）
- DESIGN.md（デザイン仕様 - 必ず準拠すること）

## 未着手の既存タスク（重複禁止）
${existingTasks}

## 出力（2段階）

### 1. 設計メモ（Markdown）
技術的判断・懸念点・実装方針を記述してください。

### 2. タスクJSON
以下のマーカーで囲んで JSON のみ出力してください：

<<<TASKS_START>>>
{
  "tasks": [
    {
      "id": "task-${String(startNum).padStart(3, "0")}",
      "title": "短いタイトル",
      "category": "feature | ux | data | bug | accessibility | seo",
      "priority": "high | medium | low",
      "status": "pending",
      "description": "どのファイルをどう変更するか、実装者への具体的な指示。ファイルパスを必ず含めること。",
      "acceptance_criteria": ["完了条件1", "完了条件2", "完了条件3"],
      "created_at": "${today}",
      "designed_by": "architect"
    }
  ]
}
<<<TASKS_END>>>
`;

  console.log("🏗️  Architect: Designing tasks based on strategy...");

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
    console.error("❌ Architect failed:", result.stderr?.slice(0, 300));
    if (result.error) console.error(result.error.message);
    return [];
  }

  const output = result.stdout?.trim() ?? "";

  // 設計メモを保存
  const memoMatch = output.match(/^([\s\S]*?)<<<TASKS_START>>>/);
  const memo = memoMatch ? memoMatch[1].trim() : output;
  writeFileSync(outputPath, `# 設計メモ ${today}\n\n${memo}`, "utf-8");

  // タスクJSONを抽出
  const tasksMatch = output.match(/<<<TASKS_START>>>([\s\S]*?)<<<TASKS_END>>>/);
  if (!tasksMatch) {
    console.error("❌ Architect: Could not extract tasks JSON");
    console.error(output.slice(0, 500));
    return [];
  }

  let newTasksData;
  try {
    newTasksData = JSON.parse(tasksMatch[1].trim());
  } catch (e) {
    console.error("❌ Architect: JSON parse error:", e.message);
    return [];
  }

  const newTasks = newTasksData.tasks ?? [];
  backlog.tasks.push(...newTasks);
  writeBacklog(backlog);

  console.log(`✅ Architect: ${newTasks.length} tasks added to backlog`);
  newTasks.forEach((t) => {
    const icon = { high: "🔴", medium: "🟡", low: "🟢" }[t.priority] ?? "⚪";
    console.log(`  ${icon} [${t.id}] ${t.title}`);
  });
  console.log();

  return newTasks;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runArchitect(null).catch(console.error);
}
