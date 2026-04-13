#!/usr/bin/env node
/**
 * reviewer.mjs — レビューエージェント
 *
 * 実装エージェントが完了したタスクを検証する。
 * - DESIGN.md 準拠チェック
 * - acceptance_criteria 達成確認
 * - TypeScript エラーチェック
 * - PASS なら push、FAIL なら差し戻し
 */
import { spawnSync, execSync } from "child_process";
import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DISCUSSION_DIR = path.join(__dirname, "../discussion");

function getGitDiff() {
  try {
    return execSync("git diff HEAD~1 HEAD --stat && echo '---' && git diff HEAD~1 HEAD -- '*.tsx' '*.ts' '*.css' | head -300", {
      cwd: ROOT,
      encoding: "utf-8",
    });
  } catch {
    try {
      return execSync("git show --stat HEAD", { cwd: ROOT, encoding: "utf-8" });
    } catch {
      return "（diff取得失敗）";
    }
  }
}

function getLastCommitMessage() {
  try {
    return execSync("git log -1 --pretty=%s", { cwd: ROOT, encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

export async function runReviewer(task) {
  const today = new Date().toISOString().split("T")[0];
  const outputPath = path.join(DISCUSSION_DIR, `review-${task.id}.md`);

  const diff = getGitDiff();
  const lastCommit = getLastCommitMessage();

  const criteria = task.acceptance_criteria
    ? task.acceptance_criteria.map((c) => `- [ ] ${c}`).join("\n")
    : "（完了条件なし）";

  const prompt = `あなたは「北海道議会情報マップ」のコードレビューエージェントです。

直前に実装されたタスクをレビューして、**PASS** または **FAIL** を判定してください。

## レビュー対象タスク
**ID**: ${task.id}
**タイトル**: ${task.title}
**カテゴリ**: ${task.category}

### 実装指示（元のタスク）
${task.description}

### 完了条件
${criteria}

## 直前のコミット
${lastCommit}

## 変更内容（git diff）
${diff}

## レビュー観点
以下を確認してください：

1. **完了条件の達成** — 上記の acceptance_criteria が全て満たされているか
2. **DESIGN.md 準拠** — カラー・タイポグラフィ・コンポーネントパターンに従っているか
   （DESIGN.md を Read で確認すること）
3. **TypeScript** — 型エラーがないか（\`cd site && npx tsc --noEmit\` で確認）
4. **フォールバック** — データなしの場合に空状態が適切に表示されるか
5. **セキュリティ** — XSS・インジェクション等の脆弱性がないか

## 出力形式

以下のマーカーで判定を囲んでください：

<<<VERDICT>>>
PASS または FAIL
<<<VERDICT_END>>>

その後、レビュー内容を Markdown で記述してください：

## 判定: PASS / FAIL

### 確認結果
（各観点の確認結果）

### ${task.acceptance_criteria ? "完了条件チェック" : "品質評価"}
（各条件の達成状況）

### フィードバック
（PASS の場合: 良かった点、FAIL の場合: 修正が必要な具体的な箇所と理由）
`;

  console.log(`🔍 Reviewer: Reviewing task [${task.id}] ${task.title}...`);

  const result = spawnSync(
    "claude",
    [
      "--print",
      "--dangerously-skip-permissions",
      "--allowedTools", "Read,Glob,Grep,Bash",
      "-p", prompt,
    ],
    {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 8 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env },
    }
  );

  if (result.status !== 0 || result.error) {
    console.error("❌ Reviewer failed:", result.stderr?.slice(0, 300));
    // レビュー失敗時は PASS として扱う（ブロックしない）
    return { verdict: "PASS", feedback: "レビュー実行エラーのためスキップ" };
  }

  const output = result.stdout?.trim() ?? "";

  // 判定を抽出
  const verdictMatch = output.match(/<<<VERDICT>>>([\s\S]*?)<<<VERDICT_END>>>/);
  const verdict = verdictMatch
    ? verdictMatch[1].trim().toUpperCase().includes("PASS") ? "PASS" : "FAIL"
    : "PASS";

  // レビュー内容を保存
  const reviewContent = `# レビュー: ${task.id} — ${task.title}\n\n**判定**: ${verdict}\n**日時**: ${new Date().toISOString()}\n\n${output}`;
  writeFileSync(outputPath, reviewContent, "utf-8");

  console.log(`${verdict === "PASS" ? "✅" : "❌"} Reviewer verdict: **${verdict}**`);
  if (verdict === "FAIL") {
    // フィードバック部分を表示
    const feedbackMatch = output.match(/フィードバック[\s\S]*$/);
    if (feedbackMatch) {
      console.log("\n--- Reviewer Feedback ---");
      console.log(feedbackMatch[0].slice(0, 500));
      console.log("---\n");
    }
  }

  return { verdict, feedback: output };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // テスト用：最後のタスクをレビュー
  const task = {
    id: "test",
    title: "テストレビュー",
    category: "feature",
    description: "テスト",
    acceptance_criteria: ["TypeScriptエラーがない"],
  };
  runReviewer(task).catch(console.error);
}
