# 源内OSS AWSデプロイチェックリスト

調査日: 2026-05-09

対象:

- `digital-go-jp/genai-web`
- `digital-go-jp/genai-ai-api/aws/query-expansion-rag`

方針は「小さく、閉じて、費用上限を先に決める」。最初から公開サービスにしない。

## 0. デプロイ前の判断

まずは `genai-ai-api/aws/query-expansion-rag` 単体を優先する。

| 段階 | やること | 判定 |
|---|---|---|
| Phase 1 | RAG APIのみデプロイし、curlで検証 | 回答品質と引用品質を見る |
| Phase 2 | 必要なら源内Webをデプロイし、AIアプリとして登録 | UI・ログイン・チーム管理が必要になってから |
| Phase 3 | 運用設計後に外部公開検討 | 今回は対象外 |

## 1. AWSアカウント・リージョン

- 検証用AWSアカウント、または明確にタグ分けした検証環境を使う
- リージョンはまず `ap-northeast-1`
- Bedrockの利用モデルがリージョンで有効化済みか確認
- 使わないリージョンにはデプロイしない
- 全リソースに `Environment=chitose-rag-dev` などのタグを付ける

## 2. 費用ガードを先に設定

デプロイ前に必ず設定する。

- AWS Budgetsで月額予算を低めに設定
- 50%、80%、100%の通知
- Cost Anomaly Detectionを有効化
- Cost Explorerで日次確認
- Bedrock、OpenSearch Serverless、S3、Lambda、API Gateway、CloudWatch Logsをサービス別に見る
- 検証終了日を決め、不要なら即destroyする

注意: AWS Budgetsは通知であり、完全な停止装置ではない。費用を止めるにはリソース削除や権限制御が必要。

## 3. RAG API側の必須設定

対象: `genai-ai-api/aws/query-expansion-rag`

### 3.1 ツール

- Node.js v22.x
- npm
- AWS CLI
- AWS CDK
- Python / pip
- Bedrockモデルアクセス

```bash
cd aws/query-expansion-rag
npm ci
cdk bootstrap
```

### 3.2 `parameter.ts`

PoCでは1アプリだけにする。

```ts
const deploy_envs: Record<string, Partial<StackInput>> = {
  "-dev": {
    qeRagAppNamesWithSharedCmek: [
      { appName: "chitose-policy-rag", appParamFile: "chitose-policy-rag.toml" }
    ],
    allowedIpV4AddressRanges: [
      "自分の固定IP/32"
    ],
    bedrockRegions: ["ap-northeast-1"],
    logLevel: "INFO",
    apiLambdaIntegrationTimeout: 180
  }
};
```

`0.0.0.0/0` のままにしない。

### 3.3 アプリ設定TOML

`config/apps/chitose-policy-rag.toml` を作る。

```toml
name = "千歳市公開資料RAG"
description = "千歳市の公開行政資料を根拠に、政策調査と一般質問づくりを支援する検証用RAG"

responseFooter = """
※この回答は生成AIによって作成されています。必ず参考情報として表示された千歳市公開資料の原文を確認してください。個人情報や未公開情報は入力しないでください。
"""

[answer_generation]
modelId = "jp.amazon.nova-2-lite-v1:0"
temperature = 0
maxTokens = 4096
systemPrompt = """
あなたは地方議員の政策調査を支援するアシスタントです。
千歳市の公開資料から取得された<context>だけを根拠に回答してください。
根拠が不足する場合は、推測で補わず「資料内では確認できません」と明記してください。
回答には、争点、確認すべき担当部署、一般質問に使える観点を簡潔に含めてください。

<context>
{{context}}
</context>

<question>
{{question}}
</question>
"""

[query_expansion]
modelId = "jp.amazon.nova-2-lite-v1:0"
temperature = 0

[relevance_rating]
modelId = "jp.amazon.nova-2-lite-v1:0"
maxCitations = 6

[retrieve_and_generate]
modelId = "jp.amazon.nova-2-lite-v1:0"
temperature = 0
```

モデルIDは利用可否と料金を確認して調整する。

### 3.4 Knowledge Base設定

| 設定 | 推奨 |
|---|---|
| `embeddingModelId` | 初期値の `amazon.titan-embed-text-v2:0` |
| `ragKnowledgeBaseStandbyReplicas` | PoCでは `false` |
| `ragKnowledgeBaseAdvancedParsing` | 最初は `false` |
| `KB_NUM_RESULTS` | 初期20。多すぎるなら10へ調整検討 |
| `n_queries` | 初期3。費用を抑えるなら1〜2で比較 |

画像PDFや複雑な表を読みたい場合だけAdvanced Parsingを検討する。最初から有効化しない。

## 4. データ投入チェック

Bedrock Knowledge BaseのS3データソースは `docs/` prefixを対象にしている。

- 公開資料だけを入れる
- 個人情報、相談記録、未公開メモ、内部資料は入れない
- PDFは1ファイル50MB以下を目安にする
- ファイル名は短く、年度・資料名がわかる形にする
- 同名の `.metadata.json` を置く

例:

```text
docs/
  2025_sougoukeikaku.pdf
  2025_sougoukeikaku.pdf.metadata.json
```

メタデータ例:

```json
{
  "metadataAttributes": {
    "file_name": "2025_sougoukeikaku.pdf",
    "url": "https://www.city.chitose.lg.jp/...",
    "tags": "総合計画,2025,政策"
  }
}
```

テンプレート付属の `tools/add_metadata_json` は、ファイル名とURLの対応表からメタデータJSONを作れる。

## 5. API疎通

デプロイ後、CloudFormation Outputsから以下を取得する。

- `ApiEndpoint`
- `ApiKeyId`

APIキー取得:

```bash
aws apigateway get-api-key \
  --api-key <ApiKeyId> \
  --include-value \
  --query value \
  --output text
```

疎通:

```bash
curl -X POST "$API_ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "inputs": {
      "question": "千歳市の子育て支援で、今後の重点施策は何ですか。根拠資料つきで教えてください。",
      "n_queries": 2,
      "output_in_detail": false
    }
  }'
```

## 6. 源内Web側の設定

源内Webまで使う場合だけ実施する。

### 必須パラメータ

- `appEnv`
- `modelRegion`
- `modelIds`
- `allowedIpV4AddressRanges`
- `selfSignUpEnabled`
- `samlAuthEnabled`
- `hiddenUseCases`
- `dataRetentionDays`
- `monitoring`

### コストを抑える設定

- セルフサインアップを無効
- IP制限を設定
- 画像生成など不要なユースケースを非表示
- `dataRetentionDays` を短めにする
- カスタムドメイン、SAML、Slack通知は後回し
- `destination` によるログ外部転送は最初は使わない
- 検証が終わったらdestroyする

## 7. 主な費用要因

| サービス | 費用要因 | 注意 |
|---|---|---|
| Amazon Bedrock | 入力・出力トークン、埋め込み、RAG検索・生成、Advanced Parsing | `n_queries` と詳細回答が増えるほど増える |
| Bedrock Knowledge Bases | 直接機能利用というより、埋め込み・ベクトルDB・S3等の関連費用 | 同期のたびに埋め込み費用 |
| OpenSearch Serverless | OCU時間、ストレージ | 小規模でも最低OCUが費用要因。最大OCU設定を確認 |
| S3 | ドキュメント保存、リクエスト、ログ保存 | 大量PDF、アクセスログ増に注意 |
| Lambda | 実行回数、実行時間、メモリ | RAG Lambdaは最大900秒設定 |
| API Gateway | リクエスト数、ログ | usage planでquota設定あり |
| CloudWatch Logs | ログ取り込み、保存 | DEBUGログは短期検証だけ |
| KMS | キー、APIリクエスト | CMEKを複数作ると管理対象が増える |
| WAF | WebACL、リクエスト | IP制限に使う。必要性と費用を確認 |
| Cognito | MAU、メール送信 | Web利用時。MFAメールは制限・費用に注意 |
| CloudFront | 転送量、リクエスト | Web利用時 |

OpenSearch Serverlessは公式料金ページで、コンピュートとストレージが別課金、OCU時間で課金、最初のコレクションに最低OCUがある旨が説明されている。ここがPoCの最大費用リスク。

## 8. デプロイ後の停止・削除

検証終了時に必ず実施。

```bash
cd aws/query-expansion-rag
cdk destroy --all -c env=-dev
```

確認するもの。

- CloudFormation stackが消えている
- OpenSearch Serverless collectionが残っていない
- S3 bucketが残っていない
- CloudWatch Logsが残っていない
- KMS keyはRemovalPolicyにより残る場合がある
- Bedrock Knowledge Baseが残っていない
- AWS Cost Explorerで翌日以降も増加が止まっている

## 9. 本番化前に必要な追加判断

- 議員本人だけで使うのか、会派・事務所も使うのか
- 監査ログをどこまで残すか
- 資料更新の担当者と頻度
- 誤回答時の扱い
- AI出力を議会質問や広報に使う前の原文確認ルール
- 市民公開する場合の利用規約、免責、問い合わせ導線

## 参考資料

- [genai-ai-api: Query Expansion RAG README](https://github.com/digital-go-jp/genai-ai-api/tree/main/aws/query-expansion-rag)
- [Amazon Bedrock Pricing](https://aws.amazon.com/bedrock/pricing)
- [Amazon OpenSearch Service Pricing](https://aws.amazon.com/opensearch-service/pricing/)
- [AWS Budgets Pricing](https://aws.amazon.com/aws-cost-management/aws-budgets/pricing/)
- [AWS Cost Anomaly Detection](https://aws.amazon.com/aws-cost-management/aws-cost-anomaly-detection/)
- [Amazon Bedrock Knowledge Bases S3 data source](https://docs.aws.amazon.com/bedrock/latest/userguide/s3-data-source-connector.html)
