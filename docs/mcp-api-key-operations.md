# gikai Remote MCP APIキー発行・運用案

目的: 議員ごとに個別キーを配布し、最低限の追跡・失効・再発行を回せる状態を作る。

## 運用方針

- 1人1キー
- 会派共有キーは原則作らない
- 本番キーと検証キーを分ける
- キーは `MCP_API_KEYS` にだけ保存する
- メールやチャットに平文で再掲し続けない

## 最低限の台帳

スプレッドシートで十分。列は以下を推奨。

- `label`
- `recipient_name`
- `recipient_role`
- `issued_at`
- `issued_by`
- `status`
  - `active`
  - `revoked`
  - `rotated`
- `revoked_at`
- `notes`

トークン本体を台帳に書くなら、閲覧権限を強く絞る。

## ラベル命名ルール

`氏名-用途-年月`

例:

- `小川-運営-202604`
- `田中議員-本番-202604`
- `佐藤議員-検証-202604`

## キー生成

追加した `scripts/generate-mcp-api-key.mjs` を使う。

```bash
node scripts/generate-mcp-api-key.mjs
```

必要なら複数件まとめて生成:

```bash
node scripts/generate-mcp-api-key.mjs 5
```

出力例:

```text
gkmcp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
gkmcp_yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
```

## 発行フロー

1. 台帳に発行予定者を追加
2. キーを生成
3. `MCP_API_KEYS` に反映
4. Vercel Production に保存
5. 疎通確認
6. 受領者へ個別送付
7. 台帳の `issued_at` と `status=active` を更新

## 失効フロー

1. 台帳の対象キーを特定
2. `MCP_API_KEYS` から該当キーを削除
3. Vercel Production に保存
4. 401 になることを確認
5. 台帳を `revoked` に更新

## 再発行フロー

1. 旧キーを失効
2. 新キーを生成
3. `MCP_API_KEYS` を更新
4. 台帳に新旧関係を記録
5. 受領者へ新キーを再配布

## 推奨する配布方法

- 原則として 1対1 の安全なチャネルで送る
- 送る内容は以下だけでよい
  - 接続URL
  - APIキー
  - 1枚マニュアル

## 事故時の初動

### キー漏えいが疑われる

- 該当キーを即失効
- 必要なら全キーをローテーション
- 台帳に記録

### 利用が急増している

- 該当ラベルのキーを一時失効
- 利用者に確認
- レート制限強化を検討

## 将来の改善候補

- `MCP_API_KEYS` を単一JSONではなく外部ストア管理へ移行
- 管理画面なしでも、台帳CSVから JSON を生成するスクリプトを追加
- ラベルごとのアクセスログ集計を追加
