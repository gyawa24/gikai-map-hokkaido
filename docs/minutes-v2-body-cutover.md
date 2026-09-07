# v2正本から既存本文への限定切替

対象は千歳578の、すでに公開されている議事録本文。v2から従来minutesへ投影し、旧本文と全フィールド・ID・順序・ファイルbytesが同一であることを確認して配信元の管理を切り替える。原典発言は改変しない。実本番の反映結果は末尾へ別途記録する。

## 公開範囲と正本

- `record.publication` は `internal_preview` / `public_visible: false` を維持する。共通validatorのcanonical public認証拒否も変えない。
- 別の `body_only` receiptが、掲載済みの同値な従来本文だけを承認する。人物同定、質問候補、QuestionBlock、活動履歴、検索segmentsの公開認証には使わない。
- 話者未確定や日付不明を確定値へ変えない。取得時刻と原典の鮮度は明示的な確認記録であり、HTTP観測や暦日の事実を第三者が独立認証したことにはならない。
- `internal_preview` は処理上の公開状態であり、Gitに保存するファイルのアクセス制御を意味しない。

永続配置は以下。`reports/` の試験runはGitignoredであり、公開後の復旧をそこへ依存させない。

```text
data/{slug}/council-records/index.json                 # active / rolled_back台帳
data/{slug}/council-records/{id}/snapshots/{sha}.json   # 原典レスポンスbytes
data/{slug}/council-records/{id}/releases/{run}/
  record.json / capture-manifest.json                 # 永続パスへ結合した正本と取得台帳
  record-origin.json / capture-origin.json            # 元runの入力
  baseline.json / minutes.json                        # 旧本文と同一bytesの投影
  published-index.json / previous-index.json
  publication.json / storage-manifest.json            # 本文許可・入力/実装hash
  previous-pointer.json                              # 対象会議の復旧用
data/{slug}/minutes/{id}.json                         # 管理された従来互換投影
data/{slug}/publications/minutes/{id}.json             # 公開用の軽量出典pointer
site/data/{slug}/minutes/{id}.json                    # 同期後の配信コピー
site/data/{slug}/publications/minutes/{id}.json        # 同期後のpointer
```

`council-records` 全体を `site/data` へ同期したり、minutesをWorker tracingへ戻したりしない。force-dynamicとGitHub Raw fallbackを維持する。公開minutes indexの対象行に `content_sha256` と `body_source` を持たせ、軽量pointerから永続正本・receipt・storage manifestを特定する。

## 準備と適用

リポジトリルートで実行する。新たに取得・検証したDNPのrecordとmanifestを使う。`--capture-sha256` は移設前の入力manifestファイルのSHA-256、`--capture-verified-at` は実際にその取得を確認したISO時刻を指定する。生成時刻で確認事実を代用しない。

最古の原典観測から確認まで、および確認からrelease生成まで、それぞれ24時間以内が必要。確認時刻は全captureの取得後でなければならない。承認参照・承認者・承認時刻には、既に得られた本文限定の承認を記録する。

```sh
shasum -a 256 /absolute/path/to/capture-manifest.json
node scripts/publish-council-record-v2-body.mjs \
  --record /absolute/path/to/record.json \
  --manifest /absolute/path/to/capture-manifest.json \
  --capture-sha256 <manifest-sha256> \
  --capture-verified-at <ISO-confirmation-time> \
  --approval-ref <approval-reference> \
  --approved-by <actor> \
  --approved-at <ISO-approval-time>
```

既定はdry-runで、ファイルを書かない。原典bytes/hashとmetadataの結合、strict検証、現在の自治体台帳、source/siteの対象本文・掲載行、v2投影の完全一致を確認する。`body_bytes_unchanged: true` と対象会議を確認した後、同じ引数へ `--apply` を付けて適用する。

```sh
node scripts/publish-council-record-v2-body.mjs --slug chitose --council 578 --verify
node scripts/sync-site-data.mjs --slug chitose --build-capabilities --verify
```

適用はまず `data/` 側の永続証跡・投影・pointer・台帳を更新する。`verified` や `sync_required: true` は本番配信の確認ではない。同期はactive releaseの実装hash、原典、receipt、投影、対象index行を再検証してから公開コピーを更新する。ほかの会議のindex更新は保持する。

active会議への追加prepare/activationは拒否する。現行を確認する場合は `--verify`、置き換える場合は明示的rollbackを先に行う。実装hashが変わった場合も再検証が必要であり、検証エラーを消すためにreceiptや投影JSONを手編集しない。

## 本番での確認

既存のリリース手順に従って、永続証跡・台帳・公開コピー・関連コードを同じ公開単位として扱う。少なくとも次を記録する。

- 配信に使うGit ref。既定のGitHub Rawは `main` を参照するため、PR branchやWorkerの更新だけでは本文の切替証明にならない。
- `main` の `site/data/chitose/minutes/578.json` のbytes SHA-256とreceipt出力hashの一致。本文が以前と同値でも、`site/data/chitose/publications/minutes/578.json` と対象indexの `body_source` が新releaseを指すことを確認する。
- 本番 `/chitose/minutes/578` の表示、日程・原典リンク・本文、およびブラウザが実際に取得したRaw URL/ref。原典記録数や未確定の人物状態を併記する。

本文receiptは入力と派生物の追跡証拠であり、本番HTTP取得の代わりにはならない。

## 1会議だけ戻す

```sh
node scripts/publish-council-record-v2-body.mjs --slug chitose --council 578 --rollback
node scripts/publish-council-record-v2-body.mjs --slug chitose --council 578 --rollback --apply
node scripts/sync-site-data.mjs --slug chitose --build-capabilities --verify
```

最初は書込みなしの復旧計画。適用すると保存済みbaselineと元index行・pointerを戻し、台帳を `rolled_back` にする。元pointerがなければ、本文hash付きの `legacy_body` / `rolled_back` pointerを残す。対象行が欠落・重複しても1行へ復旧し、ほかの会議の追加・更新を保持する。

壊れた現行本文に依存せず、独立した復旧archiveのhash・会議ID・receiptとの結合を検証する。保存baselineの破損や、他会議を安全に保持できないindex全体のparse失敗は拒否する。同期後は通常のリリースと本番Raw/pointer確認が必要。二重rollbackは行わない。

## 回帰検証と実反映記録

```sh
node --test scripts/tests/council-record-v2-body-publication.test.mjs scripts/tests/council-record-v2-body-storage.test.mjs
```

本文・原典・receipt改変の拒否、無書込みdry-run、明示的な鮮度確認、active二重昇格拒否、破損本文と欠落/重複indexの復旧、他会議の保持を検証する。

### 2026-09-07 千歳578の本番反映

- 対象release: `data/chitose/council-records/578/releases/2026-09-07T03-02-34-981Z-5ca79940d97c`。台帳は `active`、範囲は `body_only`。
- 実装commit: `d25d67fb7d486bcf87e7fec5c37e704d1896c848`。[PR #6](https://github.com/gyawa24/gikai-map-hokkaido/pull/6)をmainへマージしたcommitは `e6c42e99b58dae1e344a3fd9bc4a3b4e1058408f`。
- Cloudflare本番Worker: `e2ab9a34-dbea-4a13-b91f-56ed8c37d99b`（deployment記録: 2026-09-07T03:36:54.130Z）。直前のWorkerは `faa75486-cfe6-4265-9114-e804219b015f`。Workerだけを戻してもmain参照のRawデータは戻らないため、本文の復旧には上記rollback・同期・Git反映も必要。
- 公開本文bytes SHA-256: `c0ec7706520f8e3cd92c230e3590d4eb08d146bff5f6aaa81e97ee7cb18f9cc8`。旧本文との同一性を維持。7日程・271発言・123非発言の394原記録で、画面の387発言・議題は日程見出し7件を除く既存集計。
- 標準同期と最終 `--verify` が成功。GitHub Rawのmainにある本文、minutes/index、publications/minutes/578.jsonを独立HTTP取得し、すべて200・ローカルbytes hash一致を確認。ブラウザのネットワークログ取得とは区別する。
- 本番ブラウザで本文・日程・`#minute-4-8` の発言直接リンク・更新情報を確認。`cf:post-cutover-check` と `cf:finalize-production` が成功。最初の公開smokeで通信失敗が2件出たが、組込みの再試行で成功。
- 検証: JS 271成功・既存fixture欠落1スキップ、Python 53成功。data-healthはエラー0・既存のroot-only候補52件による警告1。`--strict` の全面成功とは扱わない。保存コピーで本文破損からのrollbackと他会議の保持を確認。
- 証跡は作業checkoutの `reports/body-cutover-*` と、同じMacの `/Users/yohei/gikai-map-hokkaido/reports/minutes-v2-body-cutover-20260907/` に保存。後者の `production-release.json`、各検証ログ、`SHA256SUMS` がリリース時点の記録。原典・正本・復旧baseline自体はGit追跡済みの上記releaseに保持する。

これは記録時点の確認結果であり、将来の原典変更や本番状態を保証するものではない。以後の切替では対象会議の原典を新規取得し、実装hashの変更が既存active会議へ及ぼす影響も確認する。
