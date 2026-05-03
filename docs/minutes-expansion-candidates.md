# 議事録追加候補メモ

生成日: 2026-05-03

`docs/municipality-coverage.md` の「議員一覧のみ掲載中」から、公式サイト上に会議録本文が確認でき、次に `minutes` 化しやすい自治体を絞ったメモ。

## 優先候補

| 優先 | 自治体 | slug | 公式ページ | 取込方式 | 理由 | 主に触るファイル |
|---:|---|---|---|---|---|---|
| 1 | 沼田町 | `numata` | https://www.town.numata.hokkaido.jp/section/gikai/juegn8000000165x.html | PDF / 年度ページ巡回 | 年度別ページに会議録PDFがまとまっており、リンクテキストに「第N回（令和N年M月D日）」がある。`linktext_pattern` で既存PDFスクレイパーに寄せやすい。 | `scraper/scrape_minutes_pdf.py`, `data/municipalities.json` |
| 2 | 上砂川町 | `kamisunagawa` | https://town.kamisunagawa.hokkaido.jp/gikai_jimukyoku/kekka/index.html | PDF / 多階層HTML巡回 | 定例会・臨時会の年別ページから個別会議ページへ辿る構造。個別ページに `kaigiroku_r7_t4.pdf` のような会議録PDFがある。 | `scraper/scrape_minutes_pdf.py`, `data/municipalities.json` |
| 3 | 下川町 | `shimokawa` | https://www.town.shimokawa.hokkaido.jp/section/gikai/ | PDF / 年度記事巡回 | 年度別記事に「議案名」「目次」「議案審議」が並び、`title` に「会議録」を含むPDFだけを拾えば本文候補を抽出できる。 | `scraper/scrape_minutes_pdf.py`, `data/municipalities.json` |
| 4 | 美瑛町 | `biei` | https://www.town.biei.hokkaido.jp/administration/parliament/proceedings/ | PDF / 年度ページ巡回 | 年度別「会議録」ページがあり、各会議の日付開催PDFが本文。議案・資料・審議結果PDFを除外するルールが必要。 | `scraper/scrape_minutes_pdf.py`, `data/municipalities.json` |
| 5 | 栗山町 | `kuriyama` | https://www.town.kuriyama.hokkaido.jp/site/gikai/7389.html | HTML + PDF混在 | 定例会はHTML会議録、臨時会はPDFが多い。本文は豊富だがPDF専用スクレイパーだけでは完結しないため5番手。 | 新規 `scraper/kuriyama/scrape_minutes.py` またはHTML対応共通化候補 |

## 見送り

| 自治体 | slug | 理由 |
|---|---|---|
| 和寒町 | `wassamu` | 公式ページに「議事録のインターネット公開は未実施」と明記。 |
| 岩内町 | `iwanai` | 調査済みメタデータでは会議録本文が確認できず、議会だより・一般質問順序表中心。 |
| 留寿都村 | `rusutsu` | 審議結果PDFはあるが、本会議会議録本文は未確認。 |
| 中標津町 | `nakashibetsu` | 一般質問の議員別PDF中心で、全文会議録として扱うには注記と範囲確認が必要。 |
| 初山別村 | `shosanbetsu` | 会議録PDFはあるがスキャン画像のためOCR前提。現行PDFテキスト抽出では優先度低。 |

## 次の実装順

1. `numata` を `scraper/scrape_minutes_pdf.py` の新設定で試す。
2. `python scraper/scrape_minutes_pdf.py --slug numata --years 2024,2025,2026` で `data/numata/minutes/` を生成する。
3. `node scripts/build-segments.mjs numata` と `node site/scripts/enrich-minutes.mjs numata` を通す。
4. `site/data/` へ同期し、`data/municipalities.json` の `features` に `minutes` / `themes`、`system: "pdf_inhouse"` を反映する。
5. `/numata`, `/numata/minutes`, `/numata/topics` を実ブラウザで確認する。

