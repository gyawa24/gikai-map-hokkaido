# gikai-map-hokkaido

北海道内の全市町村議会情報（議員・議事録・議決・行事・議会だより）を横断閲覧できる**市民向け非公式情報サイト**のソースコード。

公開URL: **https://chihougikai.com**

## 現状

- **運用中**: 26 市町村 + 北海道議会で議事録データ提供中
- **完全機能 3 市**: 千歳・恵庭・苫小牧（議員一覧・議事録・議決・行事・議会だより・選挙結果など全機能）
- **目標**: 北海道 179 市町村全てへの拡張

## 主な機能

- 横断キーワード検索（全議会の議事録を AND/OR 検索）
- 議員一覧・プロフィール
- 議事録の議題別閲覧
- 議決履歴
- 動画セッション + AI 要約（千歳・道議会で運用中）
- MCP サーバー（AI 経由でこの議会データを参照可能）

## 技術スタック

| レイヤ | 技術 |
|---|---|
| フロントエンド | Next.js 16 (App Router, Turbopack) |
| 言語 | TypeScript / JavaScript (ES Modules) |
| スタイル | Tailwind CSS |
| ホスティング | Vercel |
| データ | JSON ファイル (議事録は後日 Blob/CDN 退避予定) |
| MCP サーバー | `@modelcontextprotocol/sdk`（stdio + HTTP） |
| スクレイピング | Node.js / Python（市町村ごとに個別実装） |

## ディレクトリ構成

```
gikai-map-hokkaido/
├── site/              Next.js フロントエンド（メイン）
│   ├── src/app/       ページ（[city] 動的ルート）
│   ├── src/components/共通コンポーネント
│   ├── src/lib/mcp/   MCP ツール定義（共通）
│   └── data/          ビルド時に読む市町村データ
├── mcp-server/        stdio 版 MCP サーバー（個人用 Claude Code 連携）
├── scripts/           バッチ・CLI スクリプト
├── scraper/           市町村別スクレイピングスクリプト
├── data/              スクレイパが書き出す生データ（site/data/ にも複製）
├── agents/            自動化パイプライン
└── docs/              運用・MCP ドキュメント
```

## ドキュメント

| ファイル | 内容 |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | プロジェクト方針・AI エージェント向け作業指針 |
| [`DESIGN.md`](DESIGN.md) | UI 仕様（カラー・タイポ・コンポーネント） |
| [`SECURITY.md`](SECURITY.md) | セキュリティ・脆弱性報告 |
| [`site/AGENTS.md`](site/AGENTS.md) | Next.js 16 固有の注意事項 |
| [`docs/`](docs/) | MCP API キー運用、リリースチェックリストなど |

## ローカル開発

### サイト

```bash
cd site
npm install
npm run dev
# http://localhost:3000
```

### MCP サーバー（stdio 版、個人 Claude Code/Desktop 連携用）

```bash
cd mcp-server
npm install

# Claude Code に登録するときの設定例（~/.claude.json など）
# {
#   "mcpServers": {
#     "gikai": {
#       "command": "node",
#       "args": ["/absolute/path/to/mcp-server/index.mjs"]
#     }
#   }
# }
```

提供ツール: `list_municipalities` / `search_minutes` / `search_members` / `get_minutes_excerpt` / `get_session_segment` / `search_segments`

## ライセンス

[MIT License](LICENSE)

データ自体は各市町村議会の公式サイトに掲載された公開情報を整理したもので、原文は各議会の著作物です。本リポジトリのライセンスはコード部分に対して適用されます。

## 作者

**小川陽平**（千歳市議会議員 / 国民民主党）
GitHub: [@gyawa24](https://github.com/gyawa24)
連絡: ogawayohei.hkd@gmail.com

## ステータス

ベータ版（β）として運用中。フィードバックや誤りの指摘は Issue または上記メールまで。
