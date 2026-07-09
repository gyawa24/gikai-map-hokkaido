# 横断検索アーキテクチャ選定メモ

最終更新: 2026-07-09

## 結論

推奨は **静的シャード型の自作 bigram 転置インデックス**。

理由は、地方議会ドットコムの優先順位が「継続できる環境・綺麗なデータ・更新スケジュール」であり、Cloudflare Static Assets だけで完結する構成が最も運用負荷と費用リスクを抑えられるため。D1 FTS5 は魅力があるが、2文字の日本語語彙（例: 除雪、防災、給食）に弱い可能性が高く、無料枠では行読み・CPU・失敗時の調査コストも増える。

T8 の暫定対応により、現在の既定検索インデックスは次のサイズまで下がった。

| 指標 | 実測 |
|---|---:|
| フル版 `search-index.json` | 25,705,093 bytes / gzip 4,950,318 bytes |
| 直近2年版 `search-index-recent.json` | 7,083,633 bytes / gzip 1,392,435 bytes |
| 市別インデックス数 | 181 |
| 最大市別インデックス | `chitose.json` 2,900,705 bytes |
| 収録件数 | agendas 22,785 / memberActivities 7,842 / members 2,280 |

T8 は当面の体感改善として十分。ただし 179自治体すべてに議事録本文が入ると、現方式の全量JSON配信は再び厳しくなる。

## 評価表

| 観点 | 静的シャード型インデックス | Cloudflare D1 SQLite FTS5 | 現方式 + T8軽量化 |
|---|---|---|---|
| 初回検索の転送量（179自治体想定） | 自作 bigram ならクエリ語に必要な posting shard だけ取得。設計目標は初回 100〜500KB 程度。Pagefind は実測が必要だが、公式は静的検索・少帯域を目的としている。 | APIレスポンスのみなので初回転送は小さい。ただし毎検索でWorker/D1実行。 | 現在 gzip 1.39MB。議事録対応自治体が 26 → 179 に増えると単純比例で recent でも 9〜10MB 級になり得る。 |
| 検索レイテンシ（スマホ） | JSで小さな shard を読んで照合。端末側CPUは現方式より大幅減。 | Worker + D1 の往復。FTSが効けば安定するが、行読みとWorker CPUの監視が必要。 | 直近版は改善済み。ただし JSON.parse と全件走査は残る。 |
| ビルド時間・デプロイへの影響 | build-search-index の後段に index builder を追加。出力ファイル数は増えるが、Cloudflare Workers Free の Static Assets 20,000 files / version には余裕を持たせる設計が必要。 | DB同期工程が増える。デプロイとDB更新の順序管理、失敗時のロールバック手順が必要。 | 既存工程の延長で最も簡単。 |
| 運用コンポーネントの追加 | なし。Static Assets のファイルだけ増える。 | D1 DB、migration、同期ジョブ、監視が増える。 | なし。 |
| 月額コスト概算 | Static Assets は保存追加費用なし、静的アセットリクエストは無料・無制限。 | D1 Free は無料で試せるが、上限超過時はクエリ不可。Free はDB 10個、最大DB 500MB、アカウント合計5GB。 | Static Assets中心なので費用は低い。 |
| 日本語対応の確度 | 自作 bigram は2文字語に強い。Pagefind は日本語/CJKの精度を実データで要検証。 | SQLite FTS5 trigram は3文字以上の部分一致には強いが、ローカルSQLite確認では「除雪」のような2文字語がMATCHで拾えなかった。D1上での最終実証が必要。 | 既存の同義語・正規化ロジックで動作実績あり。 |
| 既存機能（ファセット/同義語/ハイライト）の移植性 | 同義語はクエリ展開後に shard を引けば維持しやすい。ハイライトは取得した record snippet に対して現行関数を再利用できる。ファセットは候補集合から再集計。 | SQL側で候補抽出、アプリ側で同義語・ハイライトを再計算。ファセット集計SQLが必要。 | そのまま維持。 |

## 調査メモ

### Pagefind

Pagefind は NodeJS API で `addCustomRecord` を使い、HTML以外の任意コンテンツからインデックスを作れる。検索APIもブラウザ側から利用できるため、静的配信だけで完結できる。

懸念は、議事録の「議員名 + 市町村 + 議題 + 抜粋 + 年度 + 種別」という既存のランキング・ファセットをどこまで自然に移せるか。Pagefindは候補だが、まず千歳・恵庭・苫小牧 + 10自治体程度で、日本語2文字語と議員名検索の精度を測るのが先。

### Cloudflare D1 FTS5

D1 はFreeでも使えるが、公式制限では Free の最大DBサイズは 500MB、アカウント合計ストレージは 5GB、Worker invocationあたりのD1 read subrequestは50。無料運用の範囲では、検索1回ごとの行読みとCPUを継続監視する必要がある。

SQLite FTS5 の trigram tokenizer は3文字単位で部分一致を可能にする。ただしローカルSQLiteで以下を確認したところ、3文字以上の「ロータリー」はMATCHしたが、2文字の「除雪」はMATCHしなかった。

```sql
CREATE VIRTUAL TABLE docs USING fts5(title, body, tokenize='trigram');
INSERT INTO docs VALUES ('千歳市 除排雪', '小型ロータリー除雪車購入と町内の除雪対策について');
SELECT count(*) FROM docs WHERE docs MATCH '除雪';      -- 0
SELECT count(*) FROM docs WHERE docs MATCH 'ロータリー'; -- 1
```

地方議会検索では2文字語が多いので、D1案を採るなら bigram補助テーブル、LIKE fallback、または独自正規化列が必要。これは「無料でシンプル」から外れやすい。

### 現方式 + T8

T8で既定検索は直近2年の 1.39MB gzip まで下がった。今すぐの体感改善には十分で、失敗してもフル版に戻せる。短期はこのまま運用し、自治体追加のたびに recent gzip サイズを監視する。

限界は、JSONを丸ごとダウンロードして `JSON.parse` し、ブラウザで全件走査する構造。対応自治体が増えるほど線形に重くなる。

## 推奨移行ステップ

1. T8を本番運用し、Search Console / Cloudflare / 実機スマホで検索離脱と重さを確認する。
2. `docs/operations-board.md` に「検索アーキテクチャP2」を置き、まず自作 bigram shard の小さなPoCを `scripts/` ではなく `docs/search-poc/` か一時ブランチで作る。
3. PoC対象は千歳・恵庭・苫小牧 + 議事録が厚い上位5自治体。検索語は `search_quality_cases.json` に加えて「除雪」「防災」「給食」「小川陽平」「スケート学習」「ラピダス」。
4. PoCの成功条件は、初回転送 500KB以下、2文字語対応、議員名検索、年度・市町村ファセット維持。
5. D1は本命にしない。D1を試す場合は、D1上でFTS5/trigram可否と2文字語問題を小さなDBで実証してから、運用コスト表に戻す。

## PoC実測（2026-07-09）

`docs/search-poc/bigram-poc.mjs` で、千歳・恵庭・苫小牧と市別インデックスが重い上位5自治体を対象に自作bigram転置インデックスを試した。

| 指標 | 実測 |
|---|---:|
| 対象自治体 | 8 |
| 対象ドキュメント数 | 14,243 |
| bigram語数 | 88,596 |
| postings全体 | 10.59MB / gzip 4.18MB |
| 最大postingシャード | 354.7KB / gzip 137.1KB |
| クエリ別posting shard最大 | `スケート学習` 153.8KB |
| 正解台帳 | 16/16 PASS |

2文字語の `除雪` / `防災` / `給食`、空白なし議員名の `小川陽平` に加え、恵庭・苫小牧の議員名 + 政策テーマ検索も候補取得できた。PoC範囲では「市内検索から段階導入する価値あり」と判断する。

実装では、いきなり全道横断を置き換えず、まず `/search?city=...` の市内検索で候補取得だけをbigram shardへ差し替える。市別JSONが250KB以上の自治体だけbigram索引を生成し、それ以外は従来の市別JSONにフォールバックする。

## 参考資料

- Pagefind NodeJS API: https://pagefind.app/docs/node-api/
- Pagefind browser search API: https://pagefind.app/docs/api/
- SQLite FTS5 tokenizer: https://www.sqlite.org/fts5.html
- Cloudflare D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- Cloudflare D1 pricing: https://developers.cloudflare.com/d1/platform/pricing/
- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare Workers Static Assets billing: https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
