# 地方議会.com Remote MCP 使い方 1枚版

地方議会.com の議事録検索を、Claude または ChatGPT から直接使えます。

## 1. 必要なもの

- Claude Pro または ChatGPT Plus
- 配布された API キー

## 2. 何ができるか

- 北海道内の議会議事録を横断検索
- 他市の議員質問を比較
- 関心テーマの議論状況を調べる

例:

```text
千歳・恵庭・苫小牧で「介護人材」について議員がどう質問しているか比較して
```

## 3. Claude での設定

1. Claude にログイン
2. Settings
3. Connectors
4. Add custom connector
5. 以下を入力

- Name: `地方議会.com`
- Remote MCP server URL: `https://chihougikai.com/api/mcp`
- Authentication: `Bearer token`
- Token: 配布された API キー

## 4. ChatGPT での設定

1. ChatGPT にログイン
2. Settings
3. Connectors
4. Add custom connector
5. MCP server を選択
6. 以下を入力

- Server URL: `https://chihougikai.com/api/mcp`
- Header name: `Authorization`
- Header value: `Bearer 配布されたAPIキー`

## 5. まず試す質問

```text
千歳・恵庭・苫小牧で「移住定住」がどう議論されているか比較して
```

```text
北海道内で「介護保険 値上げ」を議論している自治体を一覧にして
```

## 6. 注意

- API キーは他人に渡さない
- 市民の個人情報を入力しない
- AI の要約だけで使わず、必ず原文 URL を確認する
- 公開停止自治体の議事録は配布版に含まれない

## 7. 現在の制限

- 横断検索は北海道内広範囲で利用可能
- 本文取得は当面 `千歳・恵庭・苫小牧` の3市中心

## 8. よくあるエラー

- `missing_bearer_token`
  - API キー設定漏れ
- `invalid_token`
  - キー誤りまたは失効
- `rate_limit_exceeded`
  - 短時間に使いすぎ

## 9. 困ったとき

運営連絡先: 地方議会.com 運営
