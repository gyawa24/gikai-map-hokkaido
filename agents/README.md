# 地方議会ドットコム — 自律改善エージェントシステム

Claude Code を使って議会情報マップを自律的に改善し続けるエージェント管理システム。

## セットアップ

```bash
cd /Users/yohei/gikai-map-hokkaido/agents
npm install
```

## 使い方

### 状態確認

```bash
node orchestrator.mjs status
```

```
📋 Gikai-Map Agent System

  ✅ Completed : 3
  ⏳ Pending   : 5
  🔄 Running   : 0
  ❌ Failed    : 0

Next tasks (by priority):
  🔴 [task-001] 旭川・函館・室蘭・釧路をサイトに追加
  🔴 [task-002] トップページのクイックアクセスに恵庭・苫小牧の議事録リンク追加
  🟡 [task-003] 各市ページに議事録件数バッジを追加
  ...
```

### 次のタスクを1件実行

```bash
node orchestrator.mjs run
```

### 全ペンディングタスクを連続実行

```bash
node orchestrator.mjs loop
```

タスクが失敗した場合は自動停止します。

### 新タスクを AI で自動生成

```bash
node orchestrator.mjs generate
```

Anthropic API でコードベースを分析し、新しい改善タスクを `backlog.json` に追加します。

### フルサイクル（生成 → 全実行）

```bash
node orchestrator.mjs full
```

## ファイル構成

```
agents/
  orchestrator.mjs       # メインエントリーポイント
  generate-tasks.mjs     # Anthropic API でタスク自動生成
  backlog.json           # 実行待ちタスクキュー
  history.json           # 完了済みタスクアーカイブ
  prompts/
    agent-system.md      # 各エージェントへの共通指示
  README.md
```

## タスクのバックログ管理

`backlog.json` を直接編集してタスクを追加・編集できます。

### タスクのステータス

- `pending` — 実行待ち
- `running` — 実行中
- `done` — 完了（history.json にも記録される）
- `failed` — 失敗（修正後 `pending` に戻して再実行）

### 優先度

- `high` 🔴 — 最優先（データの欠如・大きなUX問題）
- `medium` 🟡 — 通常（機能改善・デザイン統一）
- `low` 🟢 — 余裕があれば（アクセシビリティ・細部の改善）

### 失敗したタスクの再実行

```bash
# backlog.json でステータスを "failed" → "pending" に変更後
node orchestrator.mjs run
```

## 仕組み

1. `orchestrator.mjs` がバックログから最高優先度のタスクを選択
2. `prompts/agent-system.md` + `DESIGN.md` + タスク詳細を結合してプロンプトを作成
3. `claude --print --dangerously-skip-permissions` でエージェントを非インタラクティブ起動
4. エージェントがファイルを読み書きし、git commit する
5. 結果を `history.json` に記録

## 注意事項

- エージェントは `git commit` まで自動で行います
- 実行前に `git status` で作業中の変更がないことを確認してください
- `ANTHROPIC_API_KEY` 環境変数が設定されている必要があります（generate コマンド使用時）
