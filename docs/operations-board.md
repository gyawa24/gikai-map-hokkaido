# 運営ボード

最終更新: 2026-05-06

このファイルは `今やること` の単一の真実源。
全体状況は `docs/municipality-coverage.md` を見て、ここには `直近で着手する単位` だけを書く。

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

## Now

### Coverage

- `toyako` の `minutes` 追加
  - 目的: `toyoura` で追加した通年会期制の `月会議` 戦略をそのまま横展開する
  - 完了条件: `data/toyako/minutes/` と `segments/` が生成されている
  - 主に触る場所: `scraper/scrape_minutes_pdf.py`, `data/toyako/`, `data/municipalities.json`

## Next

### Freshness

- `minutes_verified_at` が古い未公開自治体の再確認ルール整理
  - 目的: `未公開確認済み` の信頼性維持
  - 完了条件: どの条件で再確認するかが docs か script に落ちている

### Discoverability

- 自治体ページに `データ更新日 / 議事録確認日` の表示方針を揃える
  - 目的: 更新が続いているかを利用者に見せる
  - 完了条件: 少なくとも1つの共通表示パターンを決めて実装

## Later

### Coverage

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
- `suttsu` 議員名簿ページの再確認（2026-05-06時点でも画像埋め込みのため自動取得不可）
- SEO向けの metadata / sitemap / JSON-LD / 検索導線強化
- 市町村追加ワークフロー文書化
- 市町村機能充足一覧の整備
