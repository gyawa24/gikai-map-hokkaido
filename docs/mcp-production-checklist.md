# gikai Remote MCP 本番化チェックリスト

対象: `site/src/app/api/mcp/route.ts` を Vercel 上で本番公開し、議員へ配布する運用。

## 1. 事前確認

- `site/data/_search-index.json` が最新である
- `site/data/municipalities.json` が最新である
- `get_minutes_excerpt` の配布対象が `chitose / eniwa / tomakomai` の3市に限定されていることを理解している
- restricted 自治体データが HTTP 配布版に含まれていないことを確認する
- 配布ドメインを確定する
  - 例: `https://chihougikai.com/api/mcp`

## 2. Vercel 設定

- `site/` を Vercel プロジェクトとして接続する
- Production Branch を固定する
  - 例: `main`
- Preview 環境を有効のままにする場合は、議員には preview URL を配らない
- Node.js runtime で動作することを確認する
- `next.config.ts` の `outputFileTracingIncludes["/api/mcp"]` が必要ファイルを含んでいることを確認する

## 3. 環境変数

- Production に `MCP_API_KEYS` を設定する
- 必要に応じて Preview / Development にも別値で設定する
- 本番用キーと検証用キーを混在させない
- `.env.local` に本番キーを置かない

### 最低限必要な環境変数

- `MCP_API_KEYS`
  - JSON マップ形式
  - 例: `{"議員A":"gkmcp_xxx","議員B":"gkmcp_yyy"}`

## 4. デプロイ前チェック

- `npm install` が通る
- `site` で `npm run build` が通る
- `site/src/app/api/mcp/route.ts` が `runtime = "nodejs"` のままである
- `mcp-server/REMOTE.md` の接続URLが本番URLと一致している
- 既存のサイト機能に影響が出ていない

## 5. デプロイ後の疎通確認

### 未認証リクエスト

以下で `401 missing_bearer_token` が返ること:

```bash
curl -i https://chihougikai.com/api/mcp
```

### 認証ありリクエスト

以下で `401 invalid_token` ではなく、MCP 由来の正常応答が返ること:

```bash
curl -i \
  -H 'Authorization: Bearer gkmcp_xxxxxxxxxxxxxxxx' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/list","params":{}}' \
  https://chihougikai.com/api/mcp
```

### Claude / ChatGPT 実機確認

- Claude.ai で custom connector として接続できる
- ChatGPT で custom connector として接続できる
- `search_minutes` が使える
- `get_minutes_excerpt` で 3市のみ本文取得できる

## 6. 配布前の運用確認

- 誰にどの API キーを渡したか台帳で追跡できる
- 失効・再発行の手順がある
- 問い合わせ先を決めている
- 使い方の1枚マニュアルを配布できる
- 禁止事項を明示している
  - キー共有禁止
  - 個人情報を投げない
  - AI要約を原文確認なしで使わない

## 7. 推奨する追加整備

現状でも配布は可能だが、継続運用するなら以下を優先する。

- レート制限を in-memory から外部ストアに移す
  - 例: Upstash Redis / Vercel KV
- 監査ログを残す
  - 少なくとも `key label / timestamp / tool name / status code`
- 失効済みキーの管理ルールを決める
- 429 と 401 の件数監視を入れる
- エラーログの通知先を決める

## 8. リリース判定

以下を満たしたら配布開始でよい。

- 本番 URL で未認証 401、認証あり 200 系を確認済み
- Claude.ai / ChatGPT の両方で実機確認済み
- API キー台帳を作成済み
- 配布マニュアルを配れる
- 問い合わせ窓口を決定済み
