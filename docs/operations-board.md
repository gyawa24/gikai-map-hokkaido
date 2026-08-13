# 運営ボード

最終更新: 2026-08-13

このファイルは `今やること` の単一の真実源。
全体状況は `docs/municipality-coverage.md` を見て、ここには `直近で着手する単位` だけを書く。
上位方針は `docs/operations-principles.md` を見る。

## 使い方

- `Now`: 今すぐ着手してよいもの
- `Next`: Now が空いたら次に着手するもの
- `Later`: 方針としてはやるが、今は着手しないもの
- `Done`: 最近終えたものを短く残す

書き方のルール:

- 1項目は `AIにそのまま渡せる粒度` にする
- 1項目に複数自治体を詰め込みすぎない
- 実装対象、期待する完了条件、主に触る場所を書く

---

## 運用リズム

- 毎回: 作業開始時に差分確認、終了時に該当する健診コマンドを通す
- 毎週: `node scripts/operations-check.mjs --weekly`
- 毎月: `node scripts/operations-check.mjs --monthly`
- 年度更新: `node scripts/operations-check.mjs --yearly`
- Cloudflare本番確認: `node scripts/operations-check.mjs --cloudflare`

判断基準は「継続できる環境」「綺麗なデータ」「次のスケジュールが明確」の3点。

---

## 進行中の作業単位

同じworktree上にあるが、保存・検証・公開判断は次の4単位に分ける。別単位の差分を一緒にコミット・デプロイしない。

| 作業単位 | 主な場所 | 現在地 | 次の停止点 |
|---|---|---|---|
| AWS政策リサーチAPI | `research-api/` | CloudFormationデプロイ済み。固定3ケース成功。BedrockはNova 2 Liteクォータ0のため定型fallback | AWSサポートのクォータ承認後にBedrock再テスト |
| 政策リサーチ限定UI | `site/src/app/research/`, `site/src/app/api/research/`, `site/src/components/research/` | AWS APIへ接続するサーバーproxyと共通パスワード認証を実装済み | Bedrock承認後、AWS API URL/keyをCloudflare staging secretへ登録して限定確認 |
| 予算Data Loop限定UI | `site/src/app/data-loop-preview/`, `site/src/components/data-loop-preview/`, `site/data/data-loop-preview/` | 5市・R7/R8、426 facts、224比較、53 CoverageをCloudflareローカルWorkerで検証済み | 政策リサーチUIと同じ認証secretでstaging限定公開。public/RAG/raw gateは開けない |
| 江別構造化議事録 | `data/ebetsu/turns/`, `data/structured-minutes/ebetsu/`, `site/src/components/structured-minutes/` | 313発言・一般質問12件・67テーマのfixture検証済み | Data Loop/AWSと分離してレビュー・公開判断 |

共通ルール:

- `research-api/`のAWSリソースと、`site/`のCloudflare配信は別システムとして扱う。
- AWS API key、Cloudflare secret、アクセスパスワードをリポジトリや`NEXT_PUBLIC_*`へ置かない。
- `/research`と`/data-loop-preview`は同じ限定公開セッションを共有する。
- 予算Data Loopの限定表示は技術検証であり、一般公開・公開RAG・原本再配布の承認を意味しない。

---

## Now

### Operations

- Cloudflare本番移行後の安定確認を数日だけ続ける
  - 目的: 無料運用への切替直後に、DNS・検索・大きい議事録・更新情報・Search Consoleの異常を早めに見つける
  - 完了条件: `node scripts/operations-check.mjs --cloudflare` / `npm run cf:post-cutover-check` / `npm run cf:dns-status` が継続して通り、Search Consoleで大きな異常がないことを確認する。`npm run cf:release-status` は外部再反映前のゲートとして見る
  - 主に触る場所: `docs/cloudflare-release-log.md`, `docs/cloudflare-migration-checklist.md`
  - 直近確認: 2026-06-02 00:02 JST に `node scripts/operations-check.mjs --cloudflare` と `npm run cf:post-cutover-check` を再実行して通過。Search Console URL-prefix property `https://chihougikai.com/` は2026-06-01 23:40 JSTに確認済みで、サイトマップは2026/06/01読み込み成功、検出ページ1,417
  - 自動監視: Codex heartbeat `cloudflare-dns` が1時間ごとに `operations-check --cloudflare` / `cf:post-cutover-check` / `cf:dns-status` / `cf:release-status` / `git diff --check` を確認し、公開ホスト・DNS・smoke・空白差分の異常時だけ通知する。作業中の preflight stamp stale と verified deploy URL not ready は公開監視では非ブロッキング扱い

- Vercel連携停止を段階的に進める
  - 目的: Cloudflare無料運用へ寄せつつ、短期rollback経路だけを残して不要なVercel Preview buildを止める
  - 完了条件: `docs/vercel-decommission-plan.md` に沿って、まず `git.deploymentEnabled=false` を置き、数日安定後にVercel ProjectのGit連携を切る
  - 主に触る場所: `vercel.json`, `site/vercel.json`, `docs/vercel-decommission-plan.md`

### Discoverability

- 検索品質の正解台帳を千歳市から育てる
  - 目的: 市民が入力しそうな検索語で、該当する議員・会議・質問テーマ・公式議事録へ到達できるかを継続確認する
  - 完了条件: `site/data/search_quality_cases.json` に期待結果を追加し、`cd site && npm run check:search-quality` が通る。まず千歳市で10件程度、次に恵庭市・苫小牧市へ広げる
  - 主に触る場所: `docs/search-data-cleanup-plan.md`, `site/data/search_quality_cases.json`, `site/scripts/check-search-quality.mjs`, `site/scripts/build-member-activity.mjs`, `site/scripts/build-search-index.mjs`

## Next

### Coverage

- 90日再確認枠で未公開38件を再チェックする
  - 目的: 2026-05-06時点で未公開だった自治体に、本会議会議録本文が新規公開されていないか確認する
  - 完了条件: 2026-08-04以降に `node scripts/list-stale-minutes-verifications.mjs --category recheck` で出る38件を再確認し、`minutes_verified_at` を再更新する。通常 `minutes` 化できる候補が出たら `Now` に移す
  - 主に触る場所: `data/municipalities.json`, `site/data/municipalities.json`, `docs/municipality-coverage.md`, `docs/municipality-information-inventory.md`

## Later

### Operations

- 札幌市の予算OCR公開範囲は一旦保留する。再開時は令和8年度予算資料のPDF構成・サイズ・ページ数を確認し、公開サイトに出す範囲とローカルMCP専用に留める範囲を分ける

### Coverage

- OCR待ち2件（`shosanbetsu` / `yubetsu`）は、原文照合と誤認識評価の運用が固まるまで公開用 `minutes` への昇格を保留する
- フル機能自治体を 3市から 5市へ増やす

### Discoverability

- 生活課題別の固定入口ページを追加
- 議員詳細から議決結果への導線追加
- `topics` の上位テーマを地域別にも辿れるようにする

### Automation

- scraper の系統別テンプレート整理
- `coverage` の生成と `operations-board` 候補抽出の半自動化
- `news.json` 追記の定型化強化

## Done

- 議員活動データの名寄せで、同姓議員が複数いる場合の誤帰属を防止。`build-member-activity.mjs` の前方一致・部分一致を候補一意のときだけ採用する方式に変更し（曖昧時は名寄せ失敗としてログ）、千歳・室蘭の `members_activity.json` を再生成（千歳は令和3年以降の全会期に追いつき）。旭川は出力不変を確認。千歳の今期議事録に登場するが名簿に不在の質問者名（松隈・佐々木由紀・飯田・安部）と旭川「のむらパターソン和孝」の名寄せ失敗は要確認として残存
- 中立性ポリシー草案と公開ページを整備。`docs/neutrality-policy.md` に全議員同一基準、順位付けをしない方針、役職文脈、選挙期間中の凍結、算出方法公開と訂正窓口の5原則を作者レビュー待ち草案として作成し、`/methodology` に算出方法・中立性・AI生成物・訂正対応を説明する公開ページを追加。フッター、`/about`、sitemap、`site/data/news.json` に導線を反映
- 議員任期満了日マスタを整備。北海道選挙管理委員会「市町村の長及び議会議員の任期満了一覧（令和8年5月15日現在）」を出典に、179市町村の `council_term_end` / `council_term_end_source` / `council_term_end_verified_at` を `data/municipalities.json` に追加し、`sync-site-data --all-active --build-capabilities` で `site/data/municipalities.json` へ同期。`data-health` に3点セット・日付形式・年範囲チェックを追加し、`report-election-terms` で2027統一地方選推定対象132件を出せるようにした
- `sync-site-data` / `onboard-municipality` に公開データ同期後の運用リマインドを追加。dry-runでも、公開データ一般の `site/data/news.json` 追記要否、coverage / inventory 再生成要否、`publications` のfeature扱い、議事録の segments / themes / 検索index反映要否、予算出典台帳の確認結果を具体的に確認できる
- `list-stale-minutes-verifications` と `operations-check` の未公開議事録分類を、再確認待ち38件 / OCR待ち2件 / 別feature候補14件に揃えた。`node scripts/list-stale-minutes-verifications.mjs --due-by 2026-08-04 --category recheck` で、次回90日再確認の38件だけを事前に出せる
- Cloudflare移行差分を `scripts/review-cloudflare-migration.mjs` で分類し、`docs/cloudflare-migration-checklist.md` に保存順を明記。2026-06-01時点では Cloudflare本体70ファイル、公開本文・運用ツール30ファイル、新篠津村publications3ファイル、雨竜町segments23ファイル、部分stage対象1ファイル、未分類0ファイル。保存時は `node scripts/review-cloudflare-migration.mjs --commit-plan` で最新のstage案を再生成し、`docs/operations-board.md` は `--mixed-guide` を見ながら部分stageする
- `uryu` の議事録から380件の `segments` を生成し、`site/data/uryu/segments/` に同期。議題マーカーがない雨竜町の本文も横断検索に載るよう、`site/data/search_segment_fallbacks.json` でsegments検索fallback対象に追加した。`verify-municipality uryu` と coverage 再生成で、segments あり自治体が125件に更新された。議員名寄せ率は23%のため、深掘りするなら質問者・答弁者の名寄せ改善は別タスクで扱う
- 2026-06-01月次レビューとして、`node scripts/operations-check.mjs --monthly` と `node scripts/data-health.mjs --strict` を実行。`docs/municipality-coverage.md` / `docs/municipality-information-inventory.md` を再生成し、予算書13件、保留1件、議事録未掲載54件、90日以上の再確認候補0件の状態を反映。`site/data/news.json` はCloudflare移行のお知らせを先頭に追加済み
- Cloudflare無料運用移行として、OpenNext / Wrangler 構成、GitHub Raw画像配信、静的検索index、静的CSV、Remote MCP・like・動的OGPの本体切り離し、preview noindex、`cf:preflight` と外部反映前安全ゲートを整備。`chihougikai.com` / `www.chihougikai.com` を Cloudflare Workers / Static Assets へ切替済み。最新 production Worker Version ID は `6cb22188-6266-4910-b49c-7c3fea062467`。本番 robots / sitemap / search / GitHub Raw画像 / 大きい議事録詳細 / 旧URL転送 / 非公開API 404 を確認済み
- 新篠津村の `votes` 試験データとして、令和8年第1回定例会の議決結果PDF 1件を `data/shinshinotsu/publications/index.json` と `site/data/shinshinotsu/publications/index.json` に追加。議案単位の審議結果表で、議員個人別の賛否は含まないため、既存 `decisions` ではなく `publications` の別feature候補として比較メモを整理
- 上ノ国町の `general_questions` 試験データとして、令和7年9月定例会の一般質問PDF 1件を `data/kaminokuni/publications/index.json` と `site/data/kaminokuni/publications/index.json` に追加。`sync-site-data` と `verify-municipality` でも `publications` の同期を確認できるようにした
- 別feature候補14件を `general_questions` / `meeting_summaries` / `votes` / `council_reports` / `legacy_minutes` に分類し、`publications/index.json` 候補スキーマと最初の試験対象（`kaminokuni`）を整理
- 1か月ごとの運用レビューを固定化し、月次チェック項目・成果物・ニュース確認ルールを `docs/operations-principles.md` / `docs/news-workflow.md` / `scripts/operations-check.mjs` に反映
- 北広島市の令和8年度一般会計・特別会計・予算編成方針・予算案のポイント・附属資料・水道事業会計・下水道事業会計予算書7本を結合し、535ページの公開OCRデータとして `data/kitahiroshima/budgets/2026/` と `site/data/kitahiroshima/budgets/2026/` に取込。原本画像は軽量設定（95dpi / quality 60）で生成
- 室蘭市の令和8年度予算概要・説明資料・一般会計・特別会計・公営企業会計予算書11本を結合し、390ページの公開OCRデータとして `data/muroran/budgets/2026/` と `site/data/muroran/budgets/2026/` に取込。一般会計予算書は画像PDFのためOCR補完し、原本画像は軽量設定（100dpi / quality 64）で生成
- 江別市の令和8年度各会計予算書及び予算説明書を単一PDFから、261ページの公開OCRデータとして `data/ebetsu/budgets/2026/` と `site/data/ebetsu/budgets/2026/` に取込
- 岩見沢市の令和8年度予算の概要・一般会計・特別会計・病院事業会計を結合し、43ページの公開OCRデータとして `data/iwamizawa/budgets/2026/` と `site/data/iwamizawa/budgets/2026/` に取込。ラベルは一般会計・特別会計・病院事業会計を判別できるよう補正
- 小樽市の令和8年度予算書・予算説明書を結合し、441ページの公開OCRデータとして `data/otaru/budgets/2026/` と `site/data/otaru/budgets/2026/` に取込。原本画像は軽量設定（110dpi / quality 68）で生成し、`site/data/budget_sources.json` を `取込済み` に更新
- 予算OCR候補6件を確認し、次に進める2件を小樽市・岩見沢市に決定。PDF構成・ページ数・抽出文字数・注意点を `docs/budget-ocr-priority.md` に整理
- 予算OCR候補として札幌・小樽・岩見沢・江別・室蘭・北広島の公式ページを `site/data/budget_sources.json` に追加し、公開OCR取込済み8件・取得候補6件に整理。`node scripts/data-health.mjs --strict` 通過
- 小樽・岩見沢の既存構造化データを `node scripts/verify-municipality.mjs otaru` / `node scripts/verify-municipality.mjs iwamizawa` で確認し、公開データ台帳との整合性に問題なし
- `suttsu` の公式ページ掲載画像を目視確認し、画像ファイル名が一致する場合だけ出力する確認済み転記として `members.json` を追加。これで対象180自治体すべてに議員一覧あり
- 未公開54件を `再確認待ち38` / `OCR待ち2` / `別feature候補14` に分類し、通常抽出で追加できる `minutes` 候補がいったん空であることを整理
- `scripts/build-ocr-draft.py` と `scripts/evaluate-ocr-draft.mjs` を追加し、OCR下書きを公開用 `minutes` から隔離して評価できるようにした。`shosanbetsu` 令和7年第1回定例会は23セグメント・議員名寄せ9件・誤検出疑い1件
- `scrape_minutes_pdf.py` に明示指定時のみ動くOCR fallbackオプションを追加し、`build-segments.mjs` にOCR由来の発言者見出し（`〇議 長` / `7 番 三谷博子 君`）向けの小さな正規化を追加
- `tesseract` / `tesseract-lang` を導入し、`yubetsu` 令和7年第1回定例会1日目の全51ページOCRを実測（約126秒、約4.7万字）。`shosanbetsu` は `--psm 11` で本文取得可能だが、発言者行の後処理が必要
- OCR対象を棚卸しし、ローカル環境には `pdftoppm` はあるが `tesseract` / `ocrmypdf` / `pytesseract` が未導入であること、`yubetsu` は会議録PDF 25件中ほとんどが現行PDFテキスト抽出0文字であることを確認
- `esashi` の空 `minutes/index.json` を解消し、令和6年・令和7年の会議結果ページから `minutes` / `segments` / `themes` まで対応済みに更新
- `kushirocho` / `urahoro` / `toyako` / `otofuke` / `toyoura` / `imakane` / `shinhidaka` / `mori` / `ashoro` / `rausu` / `urakawa` / `engaru` / `rankoshi` / `shintotsukawa` / `nakatombetsu` / `kamishihoro` / `kuriyama` / `horokanai` / `toyotomi` / `embetsu` / `shihoro` の `members_activity.json` と `themes` feature を追加
- `oozora` の `◇` 話者記号に対応し、`members_activity.json` と `themes` feature を追加（テーマ別データあり 125自治体）
- `tsukigata` / `chippubetsu` / `assabu` の話者名寄せを改善し、`members_activity.json` と `themes` feature を追加（テーマ別データあり 103自治体）
- `nakatombetsu` の `minutes` / `segments` 整備（年別会議録ページのランダム名PDFをPDF本文ヘッダーで判定）
- `imakane` の `minutes` / `segments` 整備（会議録閲覧ページのp見出し + 表行PDFを取得）
- `members` のみ掲載中の未公開自治体を全件再確認し、`minutes_verified_at` を 2026-05-06 に更新（公開増加なし、次回再確認候補0件）
- `toyotomi` の `minutes` / `segments` 整備（令和6年の定例議会・臨時議会PDFを取得、令和7年は議事概要PDFのため対象外）
- `kaminokuni` / `kenbuchi` / `minamifurano` / `toma` / `nakashibetsu` / `shosanbetsu` / `teshio` の取込可否を再確認し、未公開・OCR待ち・一般質問のみとして確認済みに更新
- `otofuke` の `minutes` / `segments` 整備（DBSR会議録ライブラリの本文HTMLを取得し、話者記号を正規化して発言分割）
- `embetsu` / `ashoro` の `minutes` / `segments` 整備（遠別町は `R07` 表記のリンクテキスト、足寄町は年別表の日別PDFを取得）
- `oozora` の `minutes` / `segments` 整備（本会議会議録ページの令和6年PDFを取得）
- `omu` は議会議事録検索ページを確認したが一般質問単位中心のため取込対象外として確認済みに更新
- `saroma` は会議録ページが令和2年までで令和3年以降未公開として確認済みに更新
- `rausu` の `minutes` / `segments` 整備（年・種別見出し配下の行内PDFを会議単位に束ねる）
- `kushirocho` の `minutes` / `segments` 整備（年別一覧から会議録詳細ページを辿り、本会議の日別PDFを取得）
- `sarufutsu` は一般質問PDFのみのため `minutes` 取込対象外として確認済みに更新
- `yubetsu` は会議録PDFが画像系で本文抽出0文字のためOCR待ちとして確認済みに更新
- `urakawa` の `minutes` / `segments` 整備（年別本会議一覧から会議詳細の会議録PDFを取得、令和8年第2回定例会は作成中）
- `horokanai` の `minutes` / `segments` 整備（表形式の会議録PDFから本会議のみ取得、令和6年ページはPDF掲載なし）
- `urahoro` の `minutes` / `segments` 整備（年別会議録ページのh3見出し直下PDFを会議単位に束ねる）
- `assabu` の `minutes` / `segments` 整備（年別一覧から会議詳細の「議事録本文」PDFのみ取得）
- `minutes` 追加候補を再選定し、`urahoro` / `horokanai` を次候補に更新
- `kamishihoro` の `minutes` / `segments` 整備（一覧ページから記事詳細の添付PDFを取得、令和7年は本会議録未掲載のため令和6年分を対象）
- `shihoro` の `minutes` / `segments` 整備（会議見出し配下の「会議録」セクションPDFのみ抽出、画像スキャンPDF 1件はOCR待ち）
- `rankoshi` の `minutes` / `segments` 整備（年別会議録ページのh1見出し直下PDFを会議単位に束ねる、themes は話者名寄せ待ち）
- `shintotsukawa` の `minutes` / `segments` 整備（タイムスタンプ形式PDFをPDF本文ヘッダーで判定、themes は話者名寄せ待ち）
- `mori` の `minutes` / `segments` 整備（通年会期の月会議PDF対応、themes は話者名寄せ待ち）
- `tsukigata` の `minutes` / `segments` 整備（年別会議結果ページの日別PDF対応）
- `chippubetsu` の `minutes` / `segments` 整備（議決結果リンク直後の会議録PDF対応）
- `minutes` 追加候補を再選定し、`tsukigata` / `chippubetsu` を次候補に更新
- 自治体ページに `データ更新日 / 議事録確認日` の共通表示を追加
- `minutes_verified_at` が古い未公開自治体の再確認ルールを `list-stale-minutes-verifications.mjs` と workflow に整理
- `toyako` の `minutes` / `segments` 整備（通年会期の月会議PDF対応、themes は話者名寄せ待ち）
- `refresh-minutes.mjs` を追加し、既知スクレイパごとの議事録再取得を一括実行できるようにした
- 自治体追加の一気通しコマンド化（`onboard-municipality.mjs --verify` 追加）
- `verify-municipality.mjs` に `themes` 整合性チェックを追加
- `esashi` の `themes` feature 過剰反映を解消
- `numata` の `minutes` / `segments` / `themes` 整備
- `kamisunagawa` の `minutes` / `segments` / `themes` 整備
- `kuriyama` の `minutes` / `segments` 整備（定例会HTML + 臨時会PDF対応、themes は話者抽出待ち）
- `shinhidaka` の `minutes` / `segments` 整備（令和6年HTML + 令和7年日別PDF対応、themes は話者名寄せ待ち）
- `toyoura` の `minutes` / `segments` 整備（通年会期の月会議PDF対応、themes は話者名寄せ待ち）
- `yakumo` の `minutes` / `segments` / `themes` 整備（令和6年の定例会・臨時会PDFを追加、令和7年は結果ページのみ確認）
- `shimokawa` / `biei` が既に完了済みであることを coverage と候補メモに反映
- `minutes` 候補の再選定（`yakumo` / `toyako` を次点に更新）
- `suttsu` 議員名簿ページの再確認（2026-05-06時点では画像埋め込みのため、確認済み画像ファイル名に限定した目視転記で対応）
- SEO向けの metadata / sitemap / JSON-LD / 検索導線強化
- 市町村追加ワークフロー文書化
- 市町村機能充足一覧の整備
