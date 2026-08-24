# 横断検索アーキテクチャ選定メモ

最終更新: 2026-08-24

## 結論

採用構成は **Static Assets の2/3-gram文書転置索引 + 原文block確認**。

postingは文書IDを厳密昇順のdelta-varintへ圧縮する。2文字語は単一bigram、3文字語は単一trigram、頻出語は専用exact postingで一致が確定する。それ以外の4文字以上はtrigram候補を原文blockで必ず再確認する。manifest・asset catalog・posting・表示文書・原文blockの合計が96 requests / gzip 16MiB / 展開後64MiBを超える検索は、400文字版へ退避せず、語句追加を求めて取得前にfail-closedにする。

原文確認は最大64文書 / 1MiBを一つのgzip memberにし、**1 gzip memberを1つの`.bin` asset**として保存する。Cloudflare Static AssetsはRange要求を無視して`200`でasset全体を返すため、複数memberを一つのassetへ連結しない。ブラウザはblock全体を通常取得し、`200`はcatalog上の`byte_start=0`かつblock bytesとasset総長が完全一致する場合だけ許可する。`206`を返す配信元では`Content-Range`の開始・終了・asset総長も厳密照合する。assetには句読点・漢字表記を保った`cleanText`原文を保存し、検索照合時だけ正規化する。圧縮/展開bytesとSHA-256の不一致や上限超過時は、400文字版へ退避せず全文検索をfail-closedにする。1MiB上限は代表クエリの転送量検証に加え、Cloudflareローカルpreviewのasset数も実運用範囲へ収める。

公開会議録のcoverageは会議単位ではなくschedule単位で管理する。公式minuteのうち空本文、名簿、明示的な`is_procedural`だけを本文索引から除き、`○議長`・`△議題`を含む他のtypeは原文全文を対象にする。各scheduleの原文hash・文字数・minute type別の対象/除外行数・文字数・理由をmanifestへ残し、目次・CID文字化け・画像PDFは理由付きでのみ除外する。

議員活動は表示用のAI要約と厳密検索用原文を分離する。`member_activity` のpostingに入る内容は、市町村名・議員名・会議メタデータと、`evidence_segment_ids` / `evidence_minute_ids` が指す公式原文だけ。速報は明示されたevidenceの文字起こしだけを対象にする。`summary_topics` / `generated_topics` / AI要約は表示用のままで、公式本文一致に使わない。

検索結果用の公開文書にもAI要約を混ぜない。`overview` / `summary_topics` / `generated_topics` は検索runtime・表示文書から除外し、テーマ表示は公式evidenceに正規化後の完全包含がある `canonical_topics` と原文抜粋だけに限定する。APIのファイルfallbackで同じevidence照合を再現できない場合は、テーマを省略してfail-closedにする。

`municipalities.json` で `minutes_access: "restricted"` の自治体は、議事録・会議録速報・AI要約・議員活動を全文検索資産へ一切入れない。議員名や議決結果など、議事録本文を複製しない公開メタデータだけを索引できる。city/statewide/runtime/member-activity manifestに制限台帳を残し、verifierが全Static Assetで漏洩0を確認する。

## 全道シャード実装（2026-08-23）

全量 `search-index.json` が Cloudflare Static Assets の単一ファイル上限へ達したため、全道全文検索を静的シャード型へ移行した。

| 生成物 | 用途 |
|---|---|
| `search-index.json` / `search-indexes/{slug}.json` | Research APIと議事録一覧向けの全期間agenda-only互換payload |
| `search-bigram-statewide/postings/*.json.gz` | 1,024 bucketの2/3-gram文書ID delta posting |
| `search-bigram-statewide/documents/*.json.gz` | 候補確定後に読む表示用メタデータ |
| `search-bigram-statewide/exact-text/*.bin` | 専用exact postingで確定しない4文字以上の候補を照合する、1 gzip member単位の原文block |
| `search-bigram-statewide/asset-catalog.json.gz` | posting・表示文書・各原文blockの圧縮/展開bytesとSHA-256を持つ実行時整合台帳 |
| `search-bigram-statewide/coverage/{slug}.json.gz` | schedule別hash・type別文字数・除外理由を保持する監査専用台帳 |
| `search-bigram-cities/{slug}/manifest.json` | 市別文書範囲と全道postingへの参照 |

詳細coverageは検索manifestへ重複格納しない。city/statewide manifestには監査assetのURL・hash・圧縮/展開bytes・集計件数だけを置き、通常検索ではcoverage assetを取得しない。statewide manifestは2MiB、city manifestは512KiBを上限とし、取得前にその上限を転送台帳へ仮予約してから実bodyへ精算する。代表クエリの転送量にはmanifestとasset catalogの両方を含める。

旧`search-index-recent.json`とブラウザ/runtime用`search-index-shards`は公開しない。互換URLのglobal/city JSONは`agendas`と自治体メタだけを持ち、Research APIの全期間検索と議事録一覧の本文冒頭検索を維持する。production検索は2/3-gram Static Assets、明示的な非Cloudflare server modeは`site/data/_search-index.json`を直接読む。

2文字以上の全期間検索は最初からngram経路を使う。1文字検索はruntime全shard取得と候補爆発を避けるため、UI/APIとも取得前に拒否する。「直近2年に1件あれば全期間検索をしない」方式は、他会議の本文400文字以降を欠落させるため廃止した。strictのactive city/source/year/faction/tab適用後が0件のときだけfallback同義・関連語を追加取得し、明示filterは0件でも自動解除しない。

クライアントはmanifest以外のassetを検索1回限定のcacheに保持する。strict→fallbackはURL/blockとcatalog fingerprintが同じ取得だけを共有し、検索終了後に解放する。manifest・catalog・posting・表示文書・原文blockは一つのattempt別転送台帳で管理する。失敗した取得やoptional snippetも消費済みbytesを戻さず、retryは別attemptとして加算する。入力変更時は各callerの`AbortSignal`でfetch・解凍を止め、別検索と中断済みPromiseを共有しない。

ビルドとverifierは次の上限を同じ値で保つ。

- 1 asset: 24MiB以下
- `public/generated`: 16,500 files / 750MiB以下
- 代表クエリ: manifest・asset catalog・posting・文書・原文blockを合計96 requests以下 / gzip 16MiB / 展開後64MiB以下
- posting中間spool: 8GiBを超えたら停止し、成否にかかわらず`finally`で削除

`npm run build` のprebuildは索引生成直後に `verify-search-index-shards.mjs` を必ず実行する。手動確認だけに依存せず、publication schedule coverage、restricted自治体の漏洩、文書ID、catalogのorphan/欠落、全assetと原文blockの圧縮/展開hash、代表クエリ転送量、asset数・展開後サイズのいずれかが不正なら本番buildへ進まない。開発起動時だけは入力fingerprintと必須assetを確認する `--if-stale` を使い、変更がなければ再生成を省略する。

以下はCDNのRange非対応を確認する前の連結asset版baseline。1 gzip member / 1 asset版の生成時間・files・総量は、次回release preflight後に更新する。

| 指標 | 実測 |
|---|---:|
| full build | 13分43秒 / 最大RSS 2.02GiB / peak footprint 3.05GiB |
| posting spool | peak 1,459.88MiB / open handle peak 1 |
| `public/generated` | 4,229 files / 610.90MiB / 最大asset 20.00MiB |
| statewide postings | 1,024 files / gzip 279.62MiB / 展開後914.38MiB |
| document payload | 6 files / gzip 2.88MiB / 展開後20.79MiB |
| exact-text Range | 14 files / gzip 260.75MiB / 展開後1,048.47MiB |
| coverage ledger | 180 files / gzip 0.78MiB / 展開後9.29MiB |
| asset catalog | gzip 0.83MiB / 展開後3.38MiB |
| agenda-only互換payload | global 19.67MiB / city合計19.70MiB |
| member activity shards | 2,459 files / 20.10MiB |
| 独立verifier | 5分7秒 / 4,229 asset・8,911 catalog entries・24件品質台帳すべてPASS |

最大の単一gzip展開は4.00MiB（gzip 0.55MiB）。代表クエリの実測worstは22 requests / gzip 8.25MiB / 展開後36.55MiBで、96 / 16MiB / 64MiB gateに収まった。既知長句「千歳市民の入院を受け入れた」は15 requests / gzip 5.97MiB / 展開後18.91MiBで千歳市の1会議だけに確定した。`中学校`・`町内会`・`図書館`・`道路整備`・`地域活性化`・`議会`・`町長`・`予算`も21 requests、gzip約7.9〜8.0MiB、展開後約35.2〜35.7MiBだった。

verifierはcatalog内のhashだけでなく、statewideの正規1,024 posting集合、posting本文から逆算したcity別bucket集合、active自治体slug集合、city/statewide Range、物理assetのmissing/orphanを双方向で照合する。`_postings-build`・旧recent/runtime shard・一時build stateも残存を許さない。総量610.90MiBは750MiB gate内だが軽量ではないため、自治体追加時はfull build時間・peak footprint・変更asset数/bytes・Cloudflare upload時間を継続記録する。

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
