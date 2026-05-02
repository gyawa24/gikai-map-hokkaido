# gikai Remote MCP 環境変数整理

対象: `site/src/app/api/mcp/route.ts`

## 現在の実装で実際に使っている環境変数

### `MCP_API_KEYS`

- 必須
- 用途: Bearer トークン認証
- 形式: JSON 文字列
- 例:

```env
MCP_API_KEYS={"議員A":"gkmcp_xxxxxxxxxxxxxxxx","議員B":"gkmcp_yyyyyyyyyyyyyyyy"}
```

### 実装上の注意

- キー名は人間が識別しやすいラベルにする
  - 例: `議員A`, `小川-検証`, `会派共有-停止予定`
- 値は重複させない
- 1人1キーを原則にする
- JSON として壊れる書き方をしない
  - 末尾カンマ禁止
  - 全体を1行で入れる

## Vercel 側で自動付与されるが、MCP 実装では前提にしていないもの

- `VERCEL_ENV`
- `VERCEL_URL`
- `VERCEL_PROJECT_PRODUCTION_URL`

これらは運用補助には使えるが、現時点の `api/mcp` では必須ではない。

## 他機能で使っているが、MCP では必須でないもの

以下は別 API やスクリプト用であり、Remote MCP を公開するだけなら必須ではない。

- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `STORAGE_KV_REST_API_URL`
- `STORAGE_KV_REST_API_TOKEN`
- `ANTHROPIC_API_KEY`

## 推奨する Vercel Environment の分け方

### Production

- 実配布用キーのみ設定
- 議員に渡したキーだけを置く

### Preview

- 検証専用キーのみ設定
- 本番キーは置かない

### Development

- ローカル疎通確認用のダミーキーまたは検証キーのみ

## 例: Vercel Production の設定値

```json
{
  "小川-運営": "gkmcp_xxxxxxxxxxxxxxxx",
  "議員A": "gkmcp_yyyyyyyyyyyyyyyy",
  "議員B": "gkmcp_zzzzzzzzzzzzzzzz"
}
```

これをそのまま1行の文字列として `MCP_API_KEYS` に設定する。

## ローカル開発用 `.env.local` の例

`site/.env.example` を参照。

本番キーはローカルファイルに保存しない。必要なら検証専用キーを発行する。
