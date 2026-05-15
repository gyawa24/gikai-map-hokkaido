# gikai-mcp — 地方議会.com 横断検索 MCP サーバー

北海道全市町村の議事録・議員データを Claude Code / Claude Desktop に**個人利用前提**で公開する MCP サーバー。Max Plan のトークンだけで動く（Anthropic API 課金は発生しない）。

> **議員向けの配布版（リモート MCP / Claude.ai・ChatGPT 対応）は [REMOTE.md](./REMOTE.md) を参照。**
> こちらの stdio 版は restricted 自治体（札幌等）も含む個人専用。配布版は restricted を除外している。

## できること

| ツール | 用途 |
|---|---|
| `list_municipalities` | 全市町村のメタ情報一覧（振興局・機能で絞り込み） |
| `search_minutes` | 議事録の横断キーワード検索（議題単位） |
| `search_members` | 議員の横断検索（名前・会派・委員会） |
| `get_minutes_excerpt` | 議事録本文を ID 指定で取得 |
| `get_session_segment` | 動画セッションの AI 要約・Q&A・原文取得（千歳のみ） |
| `search_budgets` | 予算書OCRの横断検索（stdio個人利用のみ） |
| `get_budget_page` | 予算書のページ本文・原本画像URL取得（stdio個人利用のみ） |
| `research_public_records` | 議事録と予算書を同時検索して根拠候補を返す（stdio個人利用のみ） |

「千歳と旭川と函館で介護保険の議論を比較」「人口5万人帯の市町村でクマ対策を最も活発に議論しているのはどこ?」みたいな分析を Claude が複数ツール組み合わせて答える。

## セットアップ

```bash
# 1. 検索インデックスを作る（初回 / 議事録更新時）
cd /Users/yohei/gikai-map-hokkaido/site
npm run build-search-index

# 2. MCP サーバーの依存をインストール
cd /Users/yohei/gikai-map-hokkaido/mcp-server
npm install

# 3. Codex に登録
codex mcp add gikai -- node /Users/yohei/gikai-map-hokkaido/mcp-server/index.mjs

# 4. Codex を再起動 → gikai の MCP ツールが使える
```

### Claude Code にも登録する場合

```bash
claude mcp add gikai -- node /Users/yohei/gikai-map-hokkaido/mcp-server/index.mjs
```

### Claude Desktop に登録する場合

`~/Library/Application Support/Claude/claude_desktop_config.json` に追記：

```json
{
  "mcpServers": {
    "gikai": {
      "command": "node",
      "args": ["/Users/yohei/gikai-map-hokkaido/mcp-server/index.mjs"]
    }
  }
}
```

## 使い方の例

Claude に自然言語で投げるだけ：

- 「石狩管内6市町村で2024年以降、半導体産業について議論しているところを比較して」
- 「千歳市議会で『クマ対策』が話題になった議論を全部洗い出して、どの議員が何を発言したか整理して」
- 「『移住定住』を最も多く議論している市町村ランキング上位10、各市の代表的な議員発言と一緒に」
- 「千歳・恵庭・苫小牧の令和8年度予算書と議事録から『除雪』を比較して、根拠URLと予算書ページを付けて」

Claude は内部で `search_minutes` → `get_minutes_excerpt` を呼んで原文を確認した上で答える。返ってくる結果には常に `url`（chihougikai.com の該当ページ）が含まれるので、結論には必ずソースが付く。
予算書は `search_budgets` → `get_budget_page` で候補ページを確認する。`search_budgets` は `match_mode` で `normal`（標準）、`fuzzy`（表記ゆれ/OCR補正）、`exact`（完全一致）を切り替えられる。OCRは表の列ズレがあり得るため、金額は必ず返却される `image_url` または `page_url` の原本画像で確認する。

## ターミナルから直接使う

このリポジトリには、ローカル `MCP` をそのまま叩く補助CLIも入れてある。

```bash
# 単発検索
./scripts/gikai-search-minutes.mjs AI --limit 5

# 予算書検索
./scripts/gikai-search-budgets.mjs 除雪 --city chitose --city eniwa --city tomakomai --year 2026

# OCR表記ゆれも拾う
./scripts/gikai-search-budgets.mjs 士木費 --match-mode fuzzy

# 入力文字の完全一致
./scripts/gikai-search-budgets.mjs "高齢者除雪サービス" --match-mode exact

# AI活用っぽい語をまとめて集計
./scripts/gikai-ai-survey.mjs --year-from 2024
```

## 制約

- **検索インデックスは静的**: `site/data/_search-index.json` がビルド時生成。新しい議事録を反映するには `npm run build-search-index` を再実行する必要あり
- **予算書OCRは検索補助**: 表の金額や列位置はOCRだけで断定せず、原本画像で確認する
- **動画セッションは千歳のみ**: 全道展開時もインタフェースは同じなので、データが入れば自動的に他市も対応
- **ローカル個人利用前提**: stdio で動くので外部公開不可。一般公開向けには別途 Anthropic API 課金が必要

## 公開停止自治体（札幌など）を MCP からだけ検索する

`municipalities.json` で `minutes_access: "restricted"` が付いている自治体は、サイトのビルドフローからは除外されているが MCP の個人利用（私的使用の範囲）からは検索したい。そのために専用のインデックスを別ファイルで持てる。

```bash
cd /Users/yohei/gikai-map-hokkaido/mcp-server
npm run build-restricted-index
```

出力は `mcp-server/_restricted-index.json`（公開ビルドからは完全に独立）。MCP サーバーは起動時にこのファイルがあれば自動でマージして検索する。`get_minutes_excerpt` は元々 `data/{slug}/minutes/*.json` を直接読むので、追加対応なしで動く。

> **法的整理**: 札幌市のコピーライトポリシーは「複製・転用（公衆への提示）」を制限しているが、stdio で個人の Claude Code に返す MCP は私的使用の範囲。サイト側に出力されないことを確実にするため、出力先は `mcp-server/_restricted-index.json` に分離してある。

## トラブルシュート

| 症状 | 原因と対処 |
|---|---|
| `_search-index.json が見つかりません` | `cd site && npm run build-search-index` を実行 |
| Claude Code でツールが見えない | Claude Code を一度終了して再起動 |
| `claude mcp list` で server が unhealthy | `node /path/to/index.mjs` を直接叩いてエラーを確認 |
