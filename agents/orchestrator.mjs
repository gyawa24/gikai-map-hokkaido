#!/usr/bin/env node
/**
 * orchestrator.mjs
 * 議会情報マップ 自律改善エージェントオーケストレーター
 *
 * 使い方:
 *   node orchestrator.mjs status    # タスクキューの状態確認
 *   node orchestrator.mjs run       # 次の1タスクを実行
 *   node orchestrator.mjs loop      # 全ペンディングタスクを順番に実行
 *   node orchestrator.mjs generate  # 新タスクを自動生成（Anthropic API使用）
 *   node orchestrator.mjs full      # generate → loop を実行
 *   node orchestrator.mjs add       # バックログにタスクを対話的に追加
 */
import { spawnSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BACKLOG_PATH = path.join(__dirname, "backlog.json");
const HISTORY_PATH = path.join(__dirname, "history.json");

// ────────────────────────────────────────────
// ファイル I/O
// ────────────────────────────────────────────

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

function readHistory() {
  try {
    return JSON.parse(readFileSync(HISTORY_PATH, "utf-8"));
  } catch {
    return { completed: [] };
  }
}

function writeHistory(data) {
  writeFileSync(HISTORY_PATH, JSON.stringify(data, null, 2) + "\n");
}

// ────────────────────────────────────────────
// タスク操作
// ────────────────────────────────────────────

function getNextTask(backlog) {
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  return backlog.tasks
    .filter((t) => t.status === "pending")
    .sort((a, b) => {
      const pa = priorityOrder[a.priority] ?? 1;
      const pb = priorityOrder[b.priority] ?? 1;
      if (pa !== pb) return pa - pb;
      return new Date(a.created_at) - new Date(b.created_at);
    })[0];
}

function buildPrompt(task) {
  const systemPrompt = readFileSync(
    path.join(__dirname, "prompts", "agent-system.md"),
    "utf-8"
  );
  const designSpec = readFileSync(path.join(ROOT, "DESIGN.md"), "utf-8");

  const criteria = task.acceptance_criteria
    ? task.acceptance_criteria.map((c) => `- ${c}`).join("\n")
    : "";

  return `${systemPrompt}

---

## DESIGN.md（デザイン仕様書）

${designSpec}

---

## 実行タスク

**ID**: ${task.id}
**タイトル**: ${task.title}
**カテゴリ**: ${task.category}
**優先度**: ${task.priority}

### 実装内容

${task.description}

${criteria ? `### 完了条件\n\n${criteria}` : ""}

---

上記のタスクを実装してください。
実装が完了したら git commit してください（コミットメッセージ例: "feat: ${task.title}"）。
`;
}

// ────────────────────────────────────────────
// エージェント実行
// ────────────────────────────────────────────

async function runTask(task) {
  const prompt = buildPrompt(task);

  console.log(`\n${"─".repeat(60)}`);
  console.log(`🤖 Agent starting: [${task.id}] ${task.title}`);
  console.log(`   Category: ${task.category}  Priority: ${task.priority}`);
  console.log(`${"─".repeat(60)}\n`);

  const startTime = Date.now();

  // claude CLI を非インタラクティブモードで実行
  const result = spawnSync(
    "claude",
    [
      "--print",
      "--dangerously-skip-permissions",
      "--allowedTools",
      "Read,Edit,Write,Bash,Grep,Glob",
      "-p",
      prompt,
    ],
    {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 10 * 60 * 1000, // 10分タイムアウト
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env },
    }
  );

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const success = result.status === 0 && !result.error;

  if (result.stdout) {
    // 出力の末尾500文字だけ表示
    const preview = result.stdout.slice(-800);
    console.log("\n--- Agent output (tail) ---");
    console.log(preview);
    console.log("---");
  }

  if (result.stderr && result.stderr.length > 0) {
    console.error("\n--- Agent stderr ---");
    console.error(result.stderr.slice(-400));
    console.error("---");
  }

  console.log(
    `\n${success ? "✅" : "❌"} Task ${success ? "completed" : "failed"}: ${task.title} (${elapsed}s)`
  );

  return {
    success,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? -1,
    error: result.error?.message ?? null,
    elapsed,
  };
}

// ────────────────────────────────────────────
// コマンド実装
// ────────────────────────────────────────────

function cmdStatus() {
  const backlog = readBacklog();
  const history = readHistory();

  const pending = backlog.tasks.filter((t) => t.status === "pending");
  const running = backlog.tasks.filter((t) => t.status === "running");
  const failed = backlog.tasks.filter((t) => t.status === "failed");
  const done = history.completed.length;

  console.log("\n📋 Gikai-Map Agent System\n");
  console.log(`  ✅ Completed : ${done}`);
  console.log(`  ⏳ Pending   : ${pending.length}`);
  console.log(`  🔄 Running   : ${running.length}`);
  console.log(`  ❌ Failed    : ${failed.length}`);

  if (pending.length > 0) {
    console.log("\nNext tasks (by priority):");
    const prio = { high: "🔴", medium: "🟡", low: "🟢" };
    pending.slice(0, 8).forEach((t) => {
      console.log(`  ${prio[t.priority] ?? "⚪"} [${t.id}] ${t.title}`);
    });
  }

  if (failed.length > 0) {
    console.log("\nFailed tasks:");
    failed.forEach((t) => {
      console.log(`  ❌ [${t.id}] ${t.title}`);
    });
  }

  console.log();
}

async function cmdRun() {
  const backlog = readBacklog();
  const task = getNextTask(backlog);

  if (!task) {
    console.log(
      "\n✅ No pending tasks. Run `node orchestrator.mjs generate` to create new tasks.\n"
    );
    return;
  }

  // running にマーク
  task.status = "running";
  task.started_at = new Date().toISOString();
  writeBacklog(backlog);

  const result = await runTask(task);

  // 結果を記録
  task.status = result.success ? "done" : "failed";
  task.completed_at = new Date().toISOString();
  task.elapsed_seconds = result.elapsed;
  task.result_preview = result.stdout.slice(-500);
  writeBacklog(backlog);

  if (result.success) {
    // 履歴に移動
    const history = readHistory();
    history.completed.push({ ...task });
    writeHistory(history);
  }
}

async function cmdLoop() {
  let count = 0;
  while (true) {
    const backlog = readBacklog();
    const task = getNextTask(backlog);
    if (!task) {
      console.log(
        `\n✅ All pending tasks completed (${count} tasks executed).\n`
      );
      break;
    }

    // running にマーク
    task.status = "running";
    task.started_at = new Date().toISOString();
    writeBacklog(backlog);

    const result = await runTask(task);

    // 結果を記録
    task.status = result.success ? "done" : "failed";
    task.completed_at = new Date().toISOString();
    task.elapsed_seconds = result.elapsed;
    task.result_preview = result.stdout.slice(-500);
    writeBacklog(backlog);

    if (result.success) {
      const history = readHistory();
      history.completed.push({ ...task });
      writeHistory(history);
    } else {
      console.log(`\n⚠️  Task failed. Stopping loop. Fix the issue and retry.`);
      break;
    }

    count++;
    // 次のタスクまで少し待機
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function cmdGenerate() {
  const { generateTasks } = await import("./generate-tasks.mjs");
  await generateTasks();
}

async function cmdFull() {
  await cmdGenerate();
  await cmdLoop();
}

// ────────────────────────────────────────────
// エントリーポイント
// ────────────────────────────────────────────

async function main() {
  const mode = process.argv[2] ?? "status";

  switch (mode) {
    case "status":
      cmdStatus();
      break;
    case "run":
      await cmdRun();
      break;
    case "loop":
      await cmdLoop();
      break;
    case "generate":
      await cmdGenerate();
      break;
    case "full":
      await cmdFull();
      break;
    default:
      console.log(`
Usage:
  node orchestrator.mjs status    # タスクキューの状態確認
  node orchestrator.mjs run       # 次の1タスクを実行
  node orchestrator.mjs loop      # 全ペンディングタスクを順番に実行
  node orchestrator.mjs generate  # 新タスクを自動生成（Anthropic API使用）
  node orchestrator.mjs full      # generate → loop を実行
`);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
