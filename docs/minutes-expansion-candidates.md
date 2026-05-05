# 議事録追加候補メモ

更新日: 2026-05-06

`docs/municipality-coverage.md` の「議員一覧のみ掲載中」から、公式サイト上に会議録本文が確認でき、次に `minutes` 化しやすい自治体を絞ったメモ。

## 優先候補

2026-05-06 時点で、このメモの旧上位候補だった `numata` / `kamisunagawa` / `shimokawa` / `biei` / `kuriyama` / `shinhidaka` / `toyoura` / `yakumo` は対応済み。
そのうえで `docs/municipality-coverage.md` の members only 残件から再確認した結果、次は `toyako` が最有力。

| 優先 | 自治体 | slug | 公式ページ | 取込方式 | 理由 | 主に触るファイル |
|---:|---|---|---|---|---|---|
| 1 | 洞爺湖町 | `toyako` | https://www.town.toyako.hokkaido.jp/town_administration/gikai/ | PDF / 通年会期制 | `toyoura` で追加した `月会議` 戦略を流用できる可能性が高い。HTTPS のホスト名揺れがあるため、実URLの掘り直しから始める。 | `scraper/scrape_minutes_pdf.py`, `data/toyako/`, `data/municipalities.json` |

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

## 見送り

| 自治体 | slug | 理由 |
|---|---|---|
| 和寒町 | `wassamu` | 公式ページに「議事録のインターネット公開は未実施」と明記。 |
| 岩内町 | `iwanai` | 調査済みメタデータでは会議録本文が確認できず、議会だより・一般質問順序表中心。 |
| 留寿都村 | `rusutsu` | 審議結果PDFはあるが、本会議会議録本文は未確認。 |
| 中標津町 | `nakashibetsu` | 一般質問の議員別PDF中心で、全文会議録として扱うには注記と範囲確認が必要。 |
| 初山別村 | `shosanbetsu` | 会議録PDFはあるがスキャン画像のためOCR前提。現行PDFテキスト抽出では優先度低。 |

## 次の実装順

1. `toyako` の実URLを `http` / `https` と公開ディレクトリ差分込みで再確認する。
2. `toyoura` の `monthly_meeting_linktext` 戦略で `python scraper/scrape_minutes_pdf.py --slug toyako --years 2024,2025,2026` を試す。
3. `node scripts/refresh-minutes.mjs --slug toyako --years 2024,2025,2026 --verify` で再取得から同期まで一気通しで確認する。
