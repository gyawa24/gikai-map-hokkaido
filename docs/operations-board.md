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

- `minutes` 追加候補を再選定する
  - 目的: members only 残件から、公式サイトに本文会議録PDFがある自治体を次に進める
  - 完了条件: `docs/minutes-expansion-candidates.md` の優先候補を次の2件程度に更新する
  - 主に触る場所: `docs/municipality-coverage.md`, `docs/minutes-expansion-candidates.md`

## Next

### Coverage

- `members` 名寄せミスマッチ自治体を確認する
  - 目的: `tsukigata` / `chippubetsu` など、議事録はあるが themes 化できない自治体の原因を切り分ける
  - 完了条件: 1自治体について、名簿側の表記ゆれか議事録側の話者抽出問題かを特定する

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

- `mori` の `minutes` / `segments` 整備（通年会期の月会議PDF対応、themes は話者名寄せ待ち）
- `tsukigata` の `minutes` / `segments` 整備（年別会議結果ページの日別PDF対応、themes は議員名簿ミスマッチ解消待ち）
- `chippubetsu` の `minutes` / `segments` 整備（議決結果リンク直後の会議録PDF対応、themes は議員名簿ミスマッチ解消待ち）
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
- `suttsu` 議員名簿ページの再確認（2026-05-06時点でも画像埋め込みのため自動取得不可）
- SEO向けの metadata / sitemap / JSON-LD / 検索導線強化
- 市町村追加ワークフロー文書化
- 市町村機能充足一覧の整備
