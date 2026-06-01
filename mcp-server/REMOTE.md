# gikai リモート MCP — 議員向けセットアップ（旧案）

> 現在の公開サイト本体では、無料運用優先のため `https://chihougikai.com/api/mcp` は削除済み。
> この文書は Remote MCP 旧案の控え。現時点ではローカル `mcp-server/index.mjs` を使う。
> このまま配布しない。

地方議会.com の横断議事録検索を、Claude.ai または ChatGPT のチャット画面から
直接呼び出せるようにする手順書。

## 前提

- Claude Pro **または** ChatGPT Plus（月額約 $20）の契約
- 配布された **API キー**（`gkmcp_xxxxxxxxxxxxxxxx`）。発行は地方議会.com 運営に依頼

## できること

「千歳・恵庭・苫小牧でファイターズ2軍誘致がどう議論されているか」
「介護人材について道内他市議員はどんな質問をしているか」
といった**他市の議員質問の横断検索**が、自分で AI にチャットで頼めます。

## 旧エンドポイント

```
URL:  https://chihougikai.com/api/mcp（現在は停止中）
認証: Bearer <APIキー>
```

---

## Claude.ai での設定（PC・スマホ共通）

1. https://claude.ai にログイン（Pro プランが必要）
2. 左下の自分のアイコン → **Settings** → **Connectors**
3. **Add custom connector** をクリック
4. 以下を入力:
   - Name: `地方議会.com`
   - Remote MCP server URL: `https://chihougikai.com/api/mcp`（現在は停止中）
   - Authentication: **OAuth** ではなく **Bearer token** を選択
   - Token: 配布された `gkmcp_...` キーを貼り付け
5. **Connect** で完了
6. 新しいチャットを開き、画面下部のツールアイコンに「地方議会.com」が表示されていればOK

### 試しに聞いてみる

```
千歳・恵庭・苫小牧で「ファイターズ2軍」について議員がどう発言しているか比較して
```

---

## ChatGPT での設定

1. https://chatgpt.com にログイン（Plus プランが必要）
2. 左下の自分の名前 → **Settings** → **Connectors**
3. **Add custom connector** → **MCP server**
4. 以下を入力:
   - Server URL: `https://chihougikai.com/api/mcp`（現在は停止中）
   - Auth: **Custom header**
   - Header name: `Authorization`
   - Header value: `Bearer gkmcp_xxxxxxxxxxxxxxxx`（前後にスペースなし）
5. 保存後、新規チャット → **Tools** メニューから「地方議会.com」を有効化

---

## 使い方の例

| やりたいこと | 投げる質問の例 |
|---|---|
| 自分の関心テーマで他市が何を議論してるか | 「『移住定住』を最も多く議論している道内市町村ランキング上位10、各市の代表的な議員発言と一緒に教えて」 |
| 自分が一般質問する前のリサーチ | 「介護人材確保について、千歳と苫小牧の議員の質問を時系列で並べて」 |
| 議員の発言傾向の比較 | 「千歳市議の落野議員の質問テーマを年度別に整理して」 |

すべて、結果には **chihougikai.com の該当ページ URL** が含まれるので、原文をすぐ確認できます。
**AIの要約だけで一般質問を作らない** こと。必ず原文URLを踏んで内容を確認してから引用してください。

---

## 現在の制限

- **search_minutes（横断検索）** は北海道全市町村を対象（抜粋は80字前後）
- **get_minutes_excerpt（本文取得）** は当面 **千歳・恵庭・苫小牧の3市のみ** 対応
  - 旧Vercel案では Function のサイズ制限（250MB）のため。834MBある全議事録の本文を一度にバンドルできない
  - 3市以外は `search_minutes` の結果に付くURLを踏んで chihougikai.com で確認してください
  - 全道の本文取得対応は外部ストレージに載せ替え完了後

## やってはいけないこと

- **API キーを他人に渡さない**。1人1キー発行で発言ログが追跡できる仕組み
- **市民の固有名詞・相談内容を AI に投げない**（プライバシー）
- **AI 出力の文章をそのままコピペで議事に使わない**。必ず原文確認
- **公開停止自治体（札幌など）の議事録**は配布版に含まれていません。検索しても出ません

## トラブル

| 症状 | 原因と対処 |
|---|---|
| `401 missing_bearer_token` | Authorization ヘッダが付いていない。Bearerトークンの設定を確認 |
| `401 invalid_token` | キーが間違っているか失効。運営に確認 |
| `429 rate_limit_exceeded` | 短時間に叩きすぎ（毎分60超）。時間を空けて再試行 |
| 接続できない | URL/auth方式の入力ミス、または Pro/Plus 未契約 |

問い合わせ: 地方議会.com 運営（小川）
