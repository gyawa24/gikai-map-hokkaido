# 源内Web ローカル起動手順

調査日: 2026-05-09

対象: `digital-go-jp/genai-web`

Macで源内Webをローカル起動するための整理。重要なのは、源内Webのローカル起動は「完全なローカル完結」ではなく、先にAWSへCDKデプロイされた環境のCloudFormation Outputsを読み取って動く点。

## 前提

ローカル起動だけ先にやるのではなく、最低1つのAWS検証環境が必要。

- Node.js 22.22.2
- npm
- AWS CLI
- AWS CDK CLI
- jq
- AWS認証情報
- Bedrockモデル利用許可
- genai-webのCDKデプロイ済み環境

## Macでの準備

Homebrewがある場合の例。

```bash
brew install jq awscli
npm install -g aws-cdk
```

Node.jsはリポジトリの `engines` で `22.22.2` が指定されている。miseを使うなら以下。

```bash
mise trust
mise install
node -v
```

## リポジトリ取得

```bash
git clone https://github.com/digital-go-jp/genai-web.git
cd genai-web
npm ci
```

## AWS認証

AWS CLIで対象アカウント・リージョンに接続できる状態にする。

```bash
aws sts get-caller-identity
aws configure get region
```

PoCではリージョンを `ap-northeast-1` に寄せるのが無難。Bedrockで使うモデルがそのリージョンで利用可能かは事前確認する。

## CDK Bootstrap

対象AWSアカウントとリージョンで初回のみ実行。

```bash
npm -w packages/cdk run cdk -- bootstrap
```

## 検証用パラメータ作成

```bash
cd packages/cdk/env-parameters
cp self-hosting-template.ts self-hosting-dev.ts
```

`self-hosting-dev.ts` では、PoC向けに最低限以下を調整する。

| 項目 | 推奨値 |
|---|---|
| `appEnv` | `chitose-rag-dev` など |
| `selfSignUpEnabled` | `false` |
| `samlAuthEnabled` | 最初は `false` |
| `allowedIpV4AddressRanges` | 自分のIPに限定 |
| `hiddenUseCases` | RAG検証に不要な画像生成などは非表示検討 |
| `monitoring` | 最初は `true` でもよいが、通知先未設定ならCloudWatchアラーム中心 |
| `modelIds` | 利用予定の軽量モデル中心 |
| `imageGenerationModelIds` | 使わないなら最小化 |
| `dataRetentionDays` | PoCでは短め |

`packages/cdk/parameter.ts` に作成した環境を追加する。

```ts
import { selfHostingDevParams } from "./env-parameters/self-hosting-dev";

const deploy_envs: Record<string, Partial<StackInput>> = {
  "-selfHostingDev": selfHostingDevParams,
};
```

## デプロイ

```bash
npm -w packages/cdk run cdk -- deploy --all --require-approval never -c env=-selfHostingDev
```

デプロイ後、CloudFormation Outputsに以下が出ることを確認する。

- `WebUrl`
- `ApiEndpoint`
- `UserPoolId`
- `UserPoolClientId`
- `IdPoolId`
- `TeamAccessControlApiEndpoint`

## ローカル起動

genai-webのREADMEでは、デプロイ済み環境名を渡して起動する。

```bash
sh scripts/run.sh -selfHostingDev
```

成功すると以下で起動する。

```text
http://localhost:5173/
```

内部的には `scripts/setup-env.sh` がCloudFormation Outputsを読み、以下のような `VITE_APP_*` を設定する。

- `VITE_APP_API_ENDPOINT`
- `VITE_APP_REGION`
- `VITE_APP_USER_POOL_ID`
- `VITE_APP_USER_POOL_CLIENT_ID`
- `VITE_APP_IDENTITY_POOL_ID`
- `VITE_APP_MODEL_REGION`
- `VITE_APP_MODEL_IDS`
- `VITE_APP_TEAM_ACCESS_CONTROL_API_ENDPOINT`
- `VITE_APP_ENV`

## AIアプリ接続の流れ

源内WebにRAG APIを接続するには、RAG API側のデプロイ後に以下が必要。

1. RAG APIの `ApiEndpoint` を控える
2. `ApiKeyId` からAPIキーを取得する
3. 源内Webに管理者でログインする
4. チーム管理からAIアプリを作成する
5. エンドポイントURL、APIキー、リクエスト形式JSONを登録する

RAG APIの標準入力は以下。

```json
{
  "question": {
    "title": "質問",
    "desc": "千歳市の公開資料について質問してください。",
    "type": "textarea",
    "required": true
  },
  "n_queries": {
    "title": "検索の広げ方",
    "type": "number",
    "default_value": 3,
    "min": 1,
    "max": 3
  },
  "output_in_detail": {
    "title": "詳しい回答",
    "type": "radio",
    "items": [
      { "title": "通常", "value": false },
      { "title": "詳しく", "value": true }
    ],
    "default_value": false
  }
}
```

## ローカル起動時の注意

- `packages/web/` の変更はViteで即時反映される。
- `packages/cdk/` やAWSリソースの変更は再デプロイが必要。
- AWS認証情報が切れていると `scripts/setup-env.sh` がCloudFormation Outputsを取得できない。
- `env` 名と `parameter.ts` のキーが一致しないと起動できない。
- ローカル起動でもAWS APIを呼ぶため、モデル実行やログ保存の費用は発生しうる。

## PoCでは後回しでよいこと

- カスタムドメイン
- SAML認証
- Slack通知
- GitHub Actionsデプロイ
- 共通チーム以外の複雑なチーム設計
- 市民公開向けUI整備

## 参考資料

- [genai-web README](https://github.com/digital-go-jp/genai-web)
- [genai-web ローカル開発環境](https://github.com/digital-go-jp/genai-web/blob/main/docs/%E3%83%AD%E3%83%BC%E3%82%AB%E3%83%AB%E9%96%8B%E7%99%BA%E7%92%B0%E5%A2%83.md)
- [genai-web デプロイ手順](https://github.com/digital-go-jp/genai-web/blob/main/docs/%E3%83%87%E3%83%97%E3%83%AD%E3%82%A4%E6%89%8B%E9%A0%86.md)
- [genai-web AIアプリAPI仕様](https://github.com/digital-go-jp/genai-web/blob/main/docs/AI%E3%82%A2%E3%83%97%E3%83%AAAPI%E4%BB%95%E6%A7%98.md)
