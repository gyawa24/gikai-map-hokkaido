# 議事録追加候補メモ

更新日: 2026-05-06

`docs/municipality-coverage.md` の「議員一覧のみ掲載中」から、公式サイト上に会議録本文が確認でき、次に `minutes` 化しやすい自治体を絞ったメモ。

## 優先候補

2026-05-06 時点で、このメモの旧上位候補だった `numata` / `kamisunagawa` / `shimokawa` / `biei` / `kuriyama` / `shinhidaka` / `toyoura` / `yakumo` / `toyako` / `mori` は対応済み。

| 優先 | 自治体 | slug | 公式ページ | 取込方式 | 理由 | 主に触るファイル |
|---:|---|---|---|---|---|---|
| 1 | 月形町 | `tsukigata` | https://www.town.tsukigata.hokkaido.jp/page/4071.html | 年別ページの見出し + 日付PDFリンク | `h2` に定例会/臨時会、`h3` に第N回、会議録本文PDFは日付リンクとして並ぶ。既存 `nested_html_sections` に「会議録ブロック内の日付PDFだけ拾う」条件を足せば対応しやすい。令和8年ページも同構造。 | `scraper/scrape_minutes_pdf.py` |
| 2 | 秩父別町 | `chippubetsu` | https://www.town.chippubetsu.hokkaido.jp/category/detail.html?category=town&content=588 | 年別ページの議決結果リンク + 会議録リンク | 令和7年ページで会議録PDFが確認できる。議決結果リンクの直後に日別/会期別の「会議録」リンクが並ぶため、直前の議決結果リンクから会期情報を持ち回る戦略で対応できそう。 | `scraper/scrape_minutes_pdf.py` |

## 完了済み

| 自治体 | slug | 対応内容 |
|---|---|---|
| 沼田町 | `numata` | `linktext_pattern` 拡張で `minutes` / `segments` / `themes` まで対応済み。 |
| 上砂川町 | `kamisunagawa` | 年別ページ巡回に対応し、`minutes` / `segments` / `themes` まで対応済み。 |
| 下川町 | `shimokawa` | PDF主体の議事録を `minutes` / `segments` / `themes` まで対応済み。 |
| 美瑛町 | `biei` | 年度別会議録ページから `minutes` / `segments` / `themes` まで対応済み。 |
| 栗山町 | `kuriyama` | 新規 `scraper/kuriyama/scrape_minutes.py` を追加し、定例会HTML + 臨時会PDFの混在を `minutes` / `segments` まで対応済み。 |
| 新ひだか町 | `shinhidaka` | 新規 `scraper/shinhidaka/scrape_minutes.py` を追加し、令和6年HTML会議録 + 令和7年日別PDF会議録の混在を `minutes` / `segments` まで対応済み。 |
| 豊浦町 | `toyoura` | 共通 `scrape_minutes_pdf.py` に通年会期 `月会議` 戦略を追加し、`minutes` / `segments` まで対応済み。 |
| 八雲町 | `yakumo` | 共通 `scrape_minutes_pdf.py` の `multi_index_html` を年別複数URL対応に広げ、令和6年の定例会・臨時会PDFから `minutes` / `segments` / `themes` まで対応済み。 |
| 洞爺湖町 | `toyako` | 共通 `scrape_minutes_pdf.py` に月会議テーブル戦略を追加し、令和6年・令和7年の通年会期PDFから `minutes` / `segments` まで対応済み。 |
| 森町 | `mori` | 共通 `scrape_minutes_pdf.py` の月会議リンク戦略を拡張し、令和6年・令和7年・令和8年1月の通年会期PDFから `minutes` / `segments` まで対応済み。 |

## 見送り

| 自治体 | slug | 理由 |
|---|---|---|
| 和寒町 | `wassamu` | 公式ページに「議事録のインターネット公開は未実施」と明記。 |
| 岩内町 | `iwanai` | 調査済みメタデータでは会議録本文が確認できず、議会だより・一般質問順序表中心。 |
| 留寿都村 | `rusutsu` | 審議結果PDFはあるが、本会議会議録本文は未確認。 |
| 中標津町 | `nakashibetsu` | 一般質問の議員別PDF中心で、全文会議録として扱うには注記と範囲確認が必要。 |
| 初山別村 | `shosanbetsu` | 会議録PDFはあるがスキャン画像のためOCR前提。現行PDFテキスト抽出では優先度低。 |

## 次の実装順

1. `tsukigata` の年別会議結果ページに対応する。
2. `tsukigata` 完了後、`chippubetsu` の議決結果リンク直後の会議録PDFを会期ごとに束ねる。
3. どちらも既存PDF抽出の小拡張で済む見込み。詰まったら、候補再選定より先に抽出戦略を共通化する。
