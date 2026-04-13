#!/usr/bin/env node
/**
 * pipeline.mjs — マルチエージェントパイプライン
 *
 * 使い方:
 *   node agents/pipeline.mjs plan     # 企画 → 設計 → タスク生成
 *   node agents/pipeline.mjs run      # 実装 → レビュー（次の1タスク）
 *   node agents/pipeline.mjs loop     # 実装 → レビュー（全タスク）
 *   node agents/pipeline.mjs full     # plan → loop（フルサイクル）
 *   node agents/pipeline.mjs status   # 現在の状態確認
 *   node agents/pipeline.mjs discuss  # discussion/ の内容を表示
 */
import { spawnSync } from "child_process";
import { readFileSync, writeFileSync, readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BACKLOG_PATH = path.join(__dirname, "backlog.json");
const HISTORY_PATH = path.join(__dirname, "history.json");
const DISCUSSION_DIR = path.join(__dirname, "discussion");

// ────────────────────────────────────────────
// ファイル I/O
// ────────────────────────────────────────────

function readBacklog() {
  try { return JSON.parse(readFileSync(BACKLOG_PATH, "utf-8")); }
  catch { return { tasks: [] }; }
}

function writeBacklog(data) {
  writeFileSync(BACKLOG_PATH, JSON.stringify(data, null, 2) + "\n");
}

function readHistory() {
  try { return JSON.parse(readFileSync(HISTORY_PATH, "utf-8")); }
  catch { return { completed: [] }; }
}

function writeHistory(data) {
  writeFileSync(HISTORY_PATH, JSON.stringify(data, null, 2) + "\n");
}

function getNextTask(backlog) {
  const order = { high: 0, medium: 1, low: 2 };
  return backlog.tasks
    .filter((t) => t.status === "pending")
    .sort((a, b) => {
      const diff = (order[a.priority] ?? 1) - (order[b.priority] ?? 1);
      return diff !== 0 ? diff : new Date(a.created_at) - new Date(b.created_at);
    })[0];
}

// ────────────────────────────────────────────
// 実装エージェント（claude --print でコード実装）
// ────────────────────────────────────────────

function buildImplementerPrompt(task) {
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

## DESIGN.md

${designSpec}

---

## タスク

**ID**: ${task.id}
**タイトル**: ${task.title}
**カテゴリ**: ${task.category}
**優先度**: ${task.priority}
${task.designed_by === "architect" ? "**設計者**: 設計エージェント（discussion/architecture-*.md 参照可）\n" : ""}

### 実装内容

${task.description}

${criteria ? `### 完了条件\n\n${criteria}` : ""}

---

実装完了後、git add → git commit → git push してください。
`;
}

async function runImplementer(task) {
  const prompt = buildImplementerPrompt(task);

  console.log(`\n${"─".repeat(60)}`);
  console.log(`🔨 Implementer: [${task.id}] ${task.title}`);
  console.log(`${"─".repeat(60)}\n`);

  const start = Date.now();

  const result = spawnSync(
    "claude",
    [
      "--print",
      "--dangerously-skip-permissions",
      "--allowedTools", "Read,Edit,Write,Bash,Grep,Glob",
      "-p", prompt,
    ],
    {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 10 * 60 * 1000,
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env },
    }
  );

  const elapsed = Math.round((Date.now() - start) / 1000);
  const success = result.status === 0 && !result.error;

  if (result.stdout) {
    console.log("\n--- Implementer output (tail) ---");
    console.log(result.stdout.slice(-600));
    console.log("---");
  }

  console.log(`\n${success ? "✅" : "❌"} Implementer: ${success ? "done" : "failed"} (${elapsed}s)`);

  return { success, stdout: result.stdout ?? "", elapsed, error: result.error?.message };
}

// ────────────────────────────────────────────
// コマンド
// ────────────────────────────────────────────

async function cmdPlan() {
  console.log("\n🚀 Pipeline: Planning phase\n");
  console.log("Step 1/2: Strategist\n");

  const { runStrategist } = await import("./roles/strategist.mjs");
  const strategy = await runStrategist();

  if (!strategy) {
    console.error("❌ Strategist failed. Aborting.");
    return;
  }

  console.log("\nStep 2/2: Architect\n");
  const { runArchitect } = await import("./roles/architect.mjs");
  await runArchitect(strategy);

  console.log("✅ Planning phase complete.\n");
}

async function cmdRunOne() {
  const backlog = readBacklog();
  const task = getNextTask(backlog);

  if (!task) {
    console.log("\n✅ No pending tasks. Run `node agents/pipeline.mjs plan` to generate tasks.\n");
    return false;
  }

  // 実装
  task.status = "running";
  task.started_at = new Date().toISOString();
  writeBacklog(backlog);

  const implResult = await runImplementer(task);

  if (!implResult.success) {
    task.status = "failed";
    task.completed_at = new Date().toISOString();
    task.result_preview = implResult.stdout.slice(-300);
    writeBacklog(backlog);
    return false;
  }

  // レビュー
  const { runReviewer } = await import("./roles/reviewer.mjs");
  const review = await runReviewer(task);

  if (review.verdict === "FAIL") {
    console.log("↩️  Task sent back for retry (marked pending)");
    task.status = "pending";
    task.retry_count = (task.retry_count ?? 0) + 1;
    task.last_review_feedback = review.feedback.slice(0, 500);
    writeBacklog(backlog);

    // FAIL が3回以上なら強制完了（無限ループ防止）
    if (task.retry_count >= 3) {
      console.log("⚠️  Max retries reached. Marking as done anyway.");
      task.status = "done";
      task.completed_at = new Date().toISOString();
      writeBacklog(backlog);
      const history = readHistory();
      history.completed.push({ ...task });
      writeHistory(history);
    }
    return true;
  }

  // PASS
  task.status = "done";
  task.completed_at = new Date().toISOString();
  task.elapsed_seconds = implResult.elapsed;
  task.result_preview = implResult.stdout.slice(-300);
  writeBacklog(backlog);

  const history = readHistory();
  history.completed.push({ ...task });
  writeHistory(history);

  return true;
}

async function cmdLoop() {
  let count = 0;
  while (true) {
    const backlog = readBacklog();
    if (!getNextTask(backlog)) {
      console.log(`\n✅ All tasks completed (${count} executed).\n`);
      break;
    }

    const ok = await cmdRunOne();
    if (!ok) {
      console.log("\n⚠️  Stopping loop due to failure.\n");
      break;
    }
    count++;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function cmdFull() {
  await cmdPlan();
  await cmdLoop();
}

function cmdStatus() {
  const backlog = readBacklog();
  const history = readHistory();
  const pending = backlog.tasks.filter((t) => t.status === "pending");
  const failed = backlog.tasks.filter((t) => t.status === "failed");

  // discussion ファイル一覧
  let discussions = [];
  try {
    discussions = readdirSync(DISCUSSION_DIR)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .reverse()
      .slice(0, 5);
  } catch {}

  console.log("\n📋 Gikai-Map Multi-Agent Pipeline\n");
  console.log(`  ✅ Completed : ${history.completed.length}`);
  console.log(`  ⏳ Pending   : ${pending.length}`);
  console.log(`  ❌ Failed    : ${failed.length}`);

  if (discussions.length > 0) {
    console.log("\n📝 Recent discussions:");
    discussions.forEach((f) => console.log(`  - discussion/${f}`));
  }

  if (pending.length > 0) {
    const prio = { high: "🔴", medium: "🟡", low: "🟢" };
    console.log("\nNext tasks:");
    pending.slice(0, 6).forEach((t) => {
      const src = t.designed_by === "architect" ? " [設計済]" : "";
      console.log(`  ${prio[t.priority] ?? "⚪"} [${t.id}]${src} ${t.title}`);
    });
  }
  console.log();
}

function cmdDiscuss() {
  let files = [];
  try {
    files = readdirSync(DISCUSSION_DIR)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .reverse()
      .slice(0, 3);
  } catch {}

  if (files.length === 0) {
    console.log("\n📭 No discussions yet. Run `node agents/pipeline.mjs plan` first.\n");
    return;
  }

  files.forEach((f) => {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`📄 ${f}`);
    console.log("=".repeat(60));
    try {
      const content = readFileSync(path.join(DISCUSSION_DIR, f), "utf-8");
      console.log(content.slice(0, 1000));
      if (content.length > 1000) console.log("\n... (truncated)");
    } catch {}
  });
}

// ────────────────────────────────────────────
// エントリーポイント
// ────────────────────────────────────────────

async function main() {
  const mode = process.argv[2] ?? "status";

  switch (mode) {
    case "plan":   await cmdPlan(); break;
    case "run":    await cmdRunOne(); break;
    case "loop":   await cmdLoop(); break;
    case "full":   await cmdFull(); break;
    case "status": cmdStatus(); break;
    case "discuss": cmdDiscuss(); break;
    default:
      console.log(`
Usage:
  node agents/pipeline.mjs plan     # 企画→設計→タスク生成
  node agents/pipeline.mjs run      # 実装→レビュー（1タスク）
  node agents/pipeline.mjs loop     # 実装→レビュー（全タスク）
  node agents/pipeline.mjs full     # plan → loop
  node agents/pipeline.mjs status   # 状態確認
  node agents/pipeline.mjs discuss  # 議論ログ表示
`);
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
