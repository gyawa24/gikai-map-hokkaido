# 運営ボード

最終更新: 2026-05-20

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

判断基準は「継続できる環境」「綺麗なデータ」「次のスケジュールが明確」の3点。

---

## Now

### Operations

- 予算OCR候補6件から、次に公開取込する2自治体を選ぶ
  - 目的: 候補を増やすだけで終わらせず、公開OCR化する順番を決める
  - 完了条件: 札幌・小樽・岩見沢・江別・室蘭・北広島から2件を選び、原本PDF構成、ページ数、画像化/OCR難度、記事活用見込みをメモする
  - 主に触る場所: `site/data/budget_sources.json`, `docs/operations-board.md`, `data/{slug}/budgets/`

### Coverage

- 別feature候補14件の仕様メモを作る
  - 目的: 一般質問・質問答弁要旨・議決結果・要約資料を、正式会議録 `minutes` と混ぜずに扱える入口を決める
  - 完了条件: `general_questions` / `meeting_summaries` / `votes` などの候補feature、JSONスキーマ、最初に試す自治体を1つ決める
  - 主に触る場所: `docs/minutes-expansion-candidates.md`, `DESIGN.md`, `site/src/types/`

## Next

### Operations

- 1か月ごとの運用レビューを固定化する
  - 目的: 追加作業のあとに、台帳・出典・スケジュールが更新されない状態を防ぐ
  - 完了条件: 月末に見るチェックリストが `docs/operations-principles.md` と `docs/operations-board.md` に揃っている
  - 主に触る場所: `docs/operations-principles.md`, `docs/operations-board.md`, `docs/news-workflow.md`

### Coverage

- 90日再確認枠で未公開38件を再チェックする
  - 目的: 2026-05-06時点で未公開だった自治体に、本会議会議録本文が新規公開されていないか確認する
  - 完了条件: `minutes_verified_at` を再更新し、通常 `minutes` 化できる候補が出たら `Now` に移す
  - 主に触る場所: `data/municipalities.json`, `site/data/municipalities.json`, `docs/municipality-coverage.md`

## Later

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
