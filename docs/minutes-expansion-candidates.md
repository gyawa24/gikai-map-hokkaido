# 議事録追加候補メモ

更新日: 2026-05-06

`docs/municipality-coverage.md` の「議員一覧のみ掲載中」から、公式サイト上に会議録本文が確認でき、次に `minutes` 化しやすい自治体を絞ったメモ。

## 優先候補

2026-05-06 時点で、このメモの旧上位候補だった `numata` / `kamisunagawa` / `shimokawa` / `biei` / `kuriyama` / `shinhidaka` / `toyoura` / `yakumo` / `toyako` / `mori` / `tsukigata` / `chippubetsu` / `shintotsukawa` / `rankoshi` / `shihoro` / `kamishihoro` / `assabu` / `urahoro` / `horokanai` は対応済み。

| 優先度 | 自治体 | slug | 根拠 | 想定対応 |
|---|---|---|---|---|
| 1 | 浦河町 | `urakawa` | 本会議詳細ページに日別会議録PDFがあるが、親一覧から会議詳細へ辿る必要がある。 | 多階層巡回の追加で対応可能。 |
| 2 | 猿払村 | `sarufutsu` | 一般質問PDFは確認済みだが、全文会議録として扱える範囲か再確認が必要。 | 全文会議録ではなく一般質問のみなら見送り更新。 |

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
| 月形町 | `tsukigata` | 共通 `scrape_minutes_pdf.py` の見出し構造戦略を年別複数ページ対応に広げ、令和6年・令和7年・令和8年1月の会議結果ページから `minutes` / `segments` まで対応済み。 |
| 秩父別町 | `chippubetsu` | 共通 `scrape_minutes_pdf.py` に議決結果直後の会議録PDFを束ねる戦略を追加し、令和6年・令和7年・令和8年1月の会議録PDFから `minutes` / `segments` まで対応済み。 |
| 新十津川町 | `shintotsukawa` | 共通 `scrape_minutes_pdf.py` のPDFヘッダー戦略を実年度で再絞り込み、タイムスタンプ形式PDFから令和6年・令和7年・令和8年4月までの会議録を `minutes` / `segments` まで対応済み。 |
| 蘭越町 | `rankoshi` | 共通 `scrape_minutes_pdf.py` の年度別HTML戦略に年別ページを追加し、令和6年・令和7年・令和8年1月の会議録PDFから `minutes` / `segments` まで対応済み。 |
| 士幌町 | `shihoro` | 共通 `scrape_minutes_pdf.py` に会議見出し + 会議録セクション戦略を追加し、令和6年・令和7年・令和8年3月までの会議録PDFから `minutes` / `segments` まで対応済み。 |
| 上士幌町 | `kamishihoro` | 共通 `scrape_minutes_pdf.py` に一覧記事詳細の添付PDF戦略を追加し、令和6年の定例会・臨時会PDFから `minutes` / `segments` まで対応済み。 |
| 厚沢部町 | `assabu` | 共通 `scrape_minutes_pdf.py` の年別一覧 → 会議詳細戦略で、令和6年・令和7年の議事録本文PDFから `minutes` / `segments` まで対応済み。themes は議員名簿ミスマッチ解消待ち。 |
| 浦幌町 | `urahoro` | 共通 `scrape_minutes_pdf.py` の年度別HTML戦略で、令和6年・令和7年・令和8年1月の定例会・臨時会PDFから `minutes` / `segments` まで対応済み。 |
| 幌加内町 | `horokanai` | 共通 `scrape_minutes_pdf.py` に表形式の会議録PDF戦略を追加し、令和7年・令和8年の定例会・臨時会PDFから `minutes` / `segments` まで対応済み。令和6年ページはPDF掲載なし。 |

## 見送り

| 自治体 | slug | 理由 |
|---|---|---|
| 和寒町 | `wassamu` | 公式ページに「議事録のインターネット公開は未実施」と明記。 |
| 岩内町 | `iwanai` | 調査済みメタデータでは会議録本文が確認できず、議会だより・一般質問順序表中心。 |
| 留寿都村 | `rusutsu` | 審議結果PDFはあるが、本会議会議録本文は未確認。 |
| 中標津町 | `nakashibetsu` | 一般質問の議員別PDF中心で、全文会議録として扱うには注記と範囲確認が必要。 |
| 初山別村 | `shosanbetsu` | 会議録PDFはあるがスキャン画像のためOCR前提。現行PDFテキスト抽出では優先度低。 |

## 次の実装順

1. `urakawa` の親一覧から本会議詳細ページを辿り、PDF本文が取れるか確認する。
2. `sarufutsu` は一般質問PDFのみか全文会議録かを確認し、取り込み可否を確定する。
