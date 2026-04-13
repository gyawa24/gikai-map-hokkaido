# 設計メモ 2026-04-13

これで設計に必要な情報がそろいました。以下に設計メモとタスクJSONを出力します。

---

## 設計メモ

### 調査で判明した実態

**企画エージェントの前提との差異:**
- 「19市の enriched が空」という前提は既に解消済み。調査の結果、esashi（江差町）を除く全24市に enriched データが存在する（muroran 22件、memuro 23件、nakagawa 21件など）。
- `enrich-minutes.mjs` / `batch-transcribe.mjs` の M 状態は「Anthropic SDK → `claude -p` CLI 移行」が完了しているが未コミットの状態。スクリプト自体は動作可能であり、追加の修正は不要と判断。

**esashi の実態:**
- `data/esashi/minutes/index.json` は存在するが中身は1件のみかつ enriched ゼロ。
- `site/src/app/esashi/` ディレクトリは存在しない。
- `site/src/app/page.tsx` の CITIES 配列に esashi は未登録（24市のみ）。

**AI 横断比較検索の実態:**
- `api/ai-search/route.ts` の `CITY_META` は現在16市。enriched データを持つが未登録の市が8市ある（hokuto, noboribetsu, ikeda, kutchan, memuro, nakagawa, kamikawa, fukushima）。
- `buildCompareBaseContext()` は members.json / decisions.json のみ参照し、enriched summaries を使っていない。enriched を追加すれば回答精度が向上する。

### 実装方針

| タスク | 対象ファイル | 規模 |
|---|---|---|
| 038 | enrich/transcribe スクリプト 2 本 | 小（確認・コミット準備） |
| 039 | esashi ページ 3 本 + page.tsx + CityHeader | 中 |
| 040 | site/src/app/page.tsx | 小〜中 |
| 041 | topics/page.tsx + topics/[tag]/page.tsx | 中 |
| 042 | api/ai-search/route.ts | 小 |

---