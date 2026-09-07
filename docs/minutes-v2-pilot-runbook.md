# 議事録 v2 内部試験の手順

2026-09-07時点。対象はDNPの千歳 `578`、恵庭 `265`、苫小牧 `298`、函館 `1362`、厚真 `433`、およびgijiroku.comの岩見沢 `799`。契約と残課題は [データモデル](minutes-data-model-v2.md) を参照する。以下はローカル試験用であり、公開・同期・デプロイの手順ではない。

## 正本と保存先

| 用途 | 保存先 | 扱い |
|---|---|---|
| 自治体台帳 | `data/municipalities.json` | 自治体・provider・アクセス条件の正 |
| 既存会議録 | `data/{slug}/minutes/{council_id}.json` | 現在の収集側正本、互換照合の入力 |
| 公開会議台帳 | `site/data/{slug}/minutes/index.json`（既存配置では `site/data/{slug}/index.json` も参照） | preview対象の掲載確認。v2公開の認証ではない |
| raw原典bytes | `reports/council-record-v2/{slug}/{id}/snapshots/{sha256}.json` または `.html` | 不変の取得証跡。再取得で上書きしない |
| 取得・生成run | `reports/council-record-v2/{slug}/{id}/runs/{timestamp-uuid}/` | `capture-manifest.json`、`validation.json`、成功時の `record.json` |
| 表示用試験artifact | `reports/council-record-v2-preview/{slug}/{id}/{sha256}.json` | 元minutesと完全一致した非公開投影 |
| 表示先ポインタ | 同ディレクトリの `current.json` | artifact名とbytes hash。準備時に原子的に更新 |
| 質問候補 | `reports/council-record-v2-question-candidates/{slug}/{id}/{timestamp-uuid}/question-candidates.json` | 未review・人物未同定の候補と既存履歴との差分 |
| 一括実行の報告 | `reports/council-record-v2-pilot-runs/{timestamp-uuid}.json` | stage結果・実装hash・失敗箇所 |
| 検索投影の試験 | `reports/council-record-v2-segments-preview/{slug}/{id}/{run_hash}/` | 会議単位のsegments・indexとprovenance。公開検索は読まない |

`reports/*` は `.gitignore` の対象。別checkoutや別端末には自動で移らない。manifestは元legacy入力のpath・hashとsnapshotを参照するため、runの `record.json` だけを移しても原典検証は再現できない。検証結果だけを `data/` や `site/data/` へコピーしない。

## 保存済み原典を一括で再検証する

既にcapture manifestとsnapshotがある場合、リポジトリルートで次を実行する。

```sh
node scripts/run-council-record-v2-pilot.mjs --manifest /absolute/path/to/capture-manifest.json
```

新規ネットワーク取得は行わず、v2生成→minutes preview→segments preview→DNP質問候補の順に実行する。各stageは子プロセス終了と非公開出力を確認し、不正・失敗なら後続を停止する。既に完了したstageのローカルartifactは残り、報告の `state: "failed"` とstage別結果で区別する。公開データへロールバックや同期を行う処理ではない。

- `state: "completed"`: 適用対象の内部工程が終了した。公開認証・人手review・人物同定の完了を意味しない。
- `question_comparison_requires_review: false`: baselineが存在し、質問境界比較の差分が0。候補そのものは未reviewのまま。
- `question_comparison_requires_review: true`: baseline未取得または差分あり。baseline未取得時の `difference_count: null` を0件と解釈しない。
- `question_comparison_requires_review: null`: 質問候補工程が対象外。runnerは対応する文書providerで `not_applicable` と理由を記録し、質問0件とは扱わない。

DNP5会議の取得・照合台帳は `reports/council-record-v2/dnp-five-municipality-trials.json`。合計4,255原記録・1,907検索segments。取得済みmanifestのpathもここから選べる。5会議の一括実行は完了している。岩見沢799（gijiroku.com）は別枠で全文文書adapterを実装し、15原典レスポンスから7全文資料・Turn0の厳格検証と互換一致、ローカル画面の確認を完了した。7開催日・発言0件と読み替えない。

最終のオフライン再実行では、6会議すべてで過去runとのentity ID維持とstrict検証を確認した。詳細は `reports/council-record-v2/final-replay-verification.json` に保存する。

| 自治体 / 会議 | 元記録 | 検索segments | 質問候補 / 比較baseline | 境界差分 |
|---|---:|---:|---:|---:|
| 千歳 / 578 | 394 | 79 | 9 / 9 | 0 |
| 恵庭 / 265 | 75 | 20 | 0 / 0 | 0 |
| 苫小牧 / 298 | 3,669 | 1,746 | 34 / 34 | 0 |
| 函館 / 1362 | 71 | 54 | 0 / 0 | 0 |
| 厚真 / 433 | 46 | 8 | 0 / 0 | 0 |
| 岩見沢 / 799 | 7 | 33 | 対象外 | 未比較 |

計4,262元記録・1,940検索segments。質問候補は指定会議の抽出結果であり、自治体全体の活動件数ではない。

以下は個別stageを確認する手順。

## 1. 原典取得とv2生成

リポジトリルートで実行する。Nodeと `site/node_modules` のAjv依存が必要。

```sh
node scripts/build-dnp-council-record-v2.mjs --slug chitose --council 578
node scripts/build-dnp-council-record-v2.mjs --slug eniwa --council 265
node scripts/build-dnp-council-record-v2.mjs --slug tomakomai --council 298
node scripts/build-dnp-council-record-v2.mjs --slug hakodate --council 1362
node scripts/build-dnp-council-record-v2.mjs --slug atsuma --council 433
```

これは公式DNP APIへアクセスし、日程一覧と各日程のminutesを取得する。レスポンスbytesを保持し、既存minutesのID・順序・title・type・本文、日程数・名称・page番号と照合する。tenantや対象会議が違う、取得失敗、記録欠落、本文不一致の場合は停止する。エラーを通すために原典・人名・発言を修正しない。取得失敗時は完了済みと失敗したcaptureを `capture-failure.json` に残す。

成功時に出力された `record` と `manifest` の絶対パスを次の手順で使う。古いrunを自動で最新版と見なさず、使う取得runを明示する。

DNPの既存snapshotからネットワークアクセスなしで再生成する場合:

```sh
node scripts/build-dnp-council-record-v2.mjs --manifest /absolute/path/to/capture-manifest.json
```

新しいrunへ出力し、元captureの取得時刻を保持する。入力legacyのhashが取得時から変わった場合も停止する。

### gijiroku.comの新規取得とオフライン生成

岩見沢799では次の取得CLIを使う。これは公式サイトへアクセスする。取得には既存scraperと同じPython依存（requests）が必要。

```sh
python3 scripts/capture-gijiroku-council-v2.py --slug iwamizawa --council 799
```

raw Shift_JIS bytesを `snapshots/{sha256}.html` へ不変保存し、一覧ACT100・frameset ACT200・本文ACT203をFINO/KGNO/UNID/HUIDで対応付ける。目次を除外せず、既存容器と同数の全文文書として照合する。失敗時は `status: "failed"` のmanifestを残し、空本文で元データを上書きしない。

取得CLIが表示したmanifestを使い、オフラインで生成する。

```sh
node scripts/build-gijiroku-council-record-v2.mjs --manifest /absolute/path/to/capture-manifest.json
```

または冒頭の `run-council-record-v2-pilot.mjs` へ同じmanifestを渡すと、provider形式を判別して共通の画面・検索stageまで実行する。文書の質問候補stageは未実装のため対象外となる。保存済みlegacy、公開index、parser、snapshotのhashや識別子が変われば停止し、黙って再取得へ切り替えない。HTML parser再導出はNodeからPython helperを呼び出す。

## 2. 保存済み原典で再検証

```sh
node scripts/validate-council-record-v2.mjs /absolute/path/to/record.json --strict
```

snapshotを読み直してbytes hash、抽出本文hash、provider本文・title・順序、IDと参照、日程範囲、派生revisionを照合する。`--strict` は未確認の証跡に関するwarningでも終了コード1にする。過去runとのID対応を検査する場合は `--previous /absolute/path/to/previous-record.json` を加える。取得・ファイル更新は行わない。

`ok: true` と `publicationReady: false` が内部試験の正常な結果。public recordをこのCLIへ渡しても認証できない。quality、人手review、公式カレンダーの事実確認、HTTP取得時刻の独立認証はこの成功に含まれない。`freshness` は保存record内のcurrent revisionと入力・時刻の整合性で、公式サイトを再訪して最新内容を確認した結果ではない。

## 3. legacy完全一致の表示用artifactを作る

```sh
node scripts/prepare-council-record-v2-preview.mjs --record /absolute/path/to/record.json --manifest /absolute/path/to/capture-manifest.json
```

manifestとsnapshotを再読込し、recordの原典URL・provider ID・title・取得時刻・hash・snapshot pathを実captureへ完全照合してからvalidatorを再実行する。このcapture-bindingはsegments・DNP質問候補CLIの入口にも共通適用する。Turnと非発言DocumentItemを共通順序へ戻した投影について、元minutes全体との完全一致を確認する。ID・順序・本文だけでなく、元のtitle・type・省略値も対象になる。公開indexに会議がちょうど1件掲載され、自治体がrestrictedではないことも必要。

成功時は `legacy_equivalence: true`、`public_visible: false` と表示先pathが出る。表示用artifactのprovenanceにはrecord hash、入力revisionとhash、出力minutes hash、生成時刻・generatorを保持する。既存公開indexに本文hashがなくてもpreview比較はできるが、それを公開indexとのhash適合済みとは扱わない。

## 4. ローカル画面で比較

`MINUTES_V2_PREVIEW_ROOT` は手順3が出力した絶対パスを指定する。`site/` で以下を実行する。通常の `npm run dev` に付くpredevのデータ再生成を避け、ここではNext開発サーバーだけを起動する。

```sh
MINUTES_V2_PREVIEW_ROOT=/absolute/path/to/repository/reports/council-record-v2-preview npm exec -- next dev --hostname 127.0.0.1 --port 3101
```

Next開発サーバーの `NODE_ENV=development` と環境変数の両方が揃った場合だけ表示できる。`NODE_ENV` を手動で偽装してproductionへ持ち込まない。

| 通常表示 | 試験表示 |
|---|---|
| `/chitose/minutes/578` | `/chitose/minutes/578/preview` |
| `/eniwa/minutes/265` | `/eniwa/minutes/265/preview` |
| `/tomakomai/minutes/298` | `/tomakomai/minutes/298/preview` |
| `/hakodate/minutes/1362` | `/hakodate/minutes/1362/preview` |
| `/atsuma/minutes/433` | `/atsuma/minutes/433/preview` |
| `/iwamizawa/minutes/799` | `/iwamizawa/minutes/799/preview` |

日程または資料の選択、原文検索、全記録数、空本文議題、原典リンクを通常画面と比較する。岩見沢799は7全文資料・目次・本文・病院事業の原文検索・390px幅で横はみ出しがないことを確認した。千歳578の照合基準は7日程・271発言・123非発言・合計394記録。人物同定や質問ブロックの新生成をこの比較の完了条件に含めない。

preview loaderはartifactのbytes hash・自治体/会議ID・非公開状態・件数を確認する。ファイルなし/不正は準備案内、無効化状態・production・公開index外・restrictedは404となる。productionでは環境変数を設定してもpreviewは有効にならない。通常URL・公開検索・MCPのデータ経路は切り替わらない。

## 5. 検索segmentsの互換投影を試験する

```sh
node scripts/build-council-record-v2-segments-preview.mjs --record /absolute/path/to/record.json --manifest /absolute/path/to/capture-manifest.json
```

snapshot検証とminutes完全一致を経て、既存 `buildSegmentsForCouncil` を使い、v2投影とlegacy minutesの両方から同じ人物台帳で再生成した結果を完全比較する。非公開record、自治体一致、restrictedでないことが必要。不一致なら停止する。

出力は会議別run内の `segments/{id}.json`、`segments/_index.json`、`provenance.json`、`validation.json`。人物台帳のpath・hash・欠測状態、使用manifest、実装hash、segment/index hashを残す。一会議の試験indexで自治体全体の公開indexを上書きしない。

ここでの `legacy_equivalence` は現在の同一parserからの再生成同士の一致であり、保存済み旧segments JSONのID・分割との一致を保証しない。既存の検索分類「質問」も一般質問やQuestionBlockの認定ではない。v2の人物同定・安定ID移行・公開検索の切替は引き続き未完了。

## 6. 非公開質問候補と既存履歴を比較する

```sh
node scripts/prepare-council-record-v2-question-candidates.mjs --record /absolute/path/to/record.json --manifest /absolute/path/to/capture-manifest.json
```

原典とv2を厳格照合した後、共通DNP parserで一般・代表・本会議質疑の候補を抽出する。生成入力は原典上の話者ラベルで、現職人物台帳による人物確定は行わない。全候補が未review・人物未同定・非公開であり、正本QuestionBlockにはまだ移さない。

`members_activity.json` は比較用baselineとしてのみ読む。日程・種別・根拠minute IDと境界を一対一比較し、重複候補、候補側のみ、baseline側のみ、境界変更を差分として残す。baselineなしは `baseline_status: "unavailable"`、`baseline_count` / `difference_count: null` で比較未確認。候補IDと根拠の重複は生成時に停止する。

千歳578は一般4・代表5の計9候補、baseline9件との境界差分0を確認。候補に入らなかった `◆質問` 9発言も原文参照付きの未分類一覧に残す。委員長報告等を削除したり、未分類を活動0と表示したりしない。provenanceはrecord・manifest・baseline・実装ファイルのpath/hashと入力revisionを保持する。

## 再実行可能な検証

以下はネットワーク取得を伴わない合成fixtureの回帰テスト。

```sh
node --test scripts/tests/dnp-council-record-v2.test.mjs scripts/tests/council-record-v2-validation.test.mjs scripts/tests/council-record-v2-projection.test.mjs scripts/tests/council-record-v2-preview.test.mjs scripts/tests/council-record-v2-segments.test.mjs scripts/tests/council-record-v2-question-candidates.test.mjs scripts/tests/gijiroku-council-record-v2.test.mjs scripts/tests/council-record-v2-capture-binding.test.mjs
python3 -m unittest discover -s scripts/tests -p 'test_gijiroku_council_capture.py'
```

改変本文、発言者取り違え、質問と別日程の参照、原典の欠落・順序変更、旧ID再採番、hash不一致、未取得証跡、公開昇格を負例として拒否する。実6会議は各runの `--strict` とlegacy完全一致を別に実施する。過去のテスト件数だけで現在のrunを適合済みとみなさない。

## 未移行と公開境界

- 別artifactに質問候補を生成するが、v2 recordのQuestionBlock・TopicBlock・TopicSnippet・Reconciliationは空配列。人手review、人物照合、任期をまたぐ履歴、速報と正式版の接続は未実施。
- v2由来segmentsの互換投影CLIは上記の内部試験用。公開検索index、MCP、`members_activity` への切替は未実施。
- 岩見沢799のgijiroku.com全文文書adapterは実装・検証済み。発言・質問抽出、ほかのHTML/PDF/動画ASRのv2 adapterと品質認証は今後の課題。全文一致から発言者や開催日を認定しない。
- public認証はvalidatorが拒否する。内部試験の成功から自動で公開、標準同期、Git操作、デプロイへ進めない。
- 公開済みcommit `67da5c76` / PR #4のlegacy改善とは別の作業。内部試験のみなので公開newsは追加しない。
