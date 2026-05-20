# 議事録追加候補メモ

更新日: 2026-05-20

`docs/municipality-coverage.md` の「議員一覧のみ掲載中」から、公式サイト上に会議録本文が確認でき、次に `minutes` 化しやすい自治体を絞ったメモ。

2026-05-06時点で、通常のPDF/HTML抽出で公開用 `minutes` に昇格できる候補は残っていない。残54件は下記の運用分類で扱う。

## 優先候補

2026-05-06 時点で、このメモの旧上位候補だった `numata` / `kamisunagawa` / `shimokawa` / `biei` / `kuriyama` / `shinhidaka` / `toyoura` / `yakumo` / `toyako` / `mori` / `tsukigata` / `chippubetsu` / `shintotsukawa` / `rankoshi` / `shihoro` / `kamishihoro` / `assabu` / `urahoro` / `horokanai` / `urakawa` / `kushirocho` / `rausu` / `oozora` / `embetsu` / `ashoro` / `otofuke` / `toyotomi` / `imakane` / `nakatombetsu` / `esashi` は対応済み。

| 優先度 | 分類 | 件数 | 対象 | 想定対応 |
|---|---:|---:|---|---|
| 1 | 別feature候補 | 14 | `nakashibetsu` / `sarufutsu` / `kaminokuni` / `toma` / `minamifurano` / `shinshinotsu` / `aibetsu` / `omu` / `saroma` / `takinoue` / `teshio` / `kenbuchi` / `rusutsu` / `iwanai` | 一般質問・質問答弁要旨・議決結果・要約資料などを、正式会議録とは別のfeatureにするか検討する。 |
| 2 | OCR待ち | 2 | `shosanbetsu` / `yubetsu` | 画像系PDF。公開昇格は原文照合と誤認識評価を通すまで保留する。 |
| 3 | 再確認待ち | 38 | 下記「再確認待ち」 | 2026-08-04以降の90日再確認で、会議録本文のWeb公開が増えていないか確認する。 |

## 未公開54件の運用分類

### 再確認待ち 38件

公式サイト上で本会議会議録本文のWeb公開を確認できなかったもの。2026-05-06に確認済みのため、次回は原則90日後の再確認枠で扱う。

`kamikawa` / `ikeda` / `nakagawa` / `naganuma` / `shimamaki` / `suttsu` / `kuromatsunai` / `kimobetsu` / `kyogoku` / `kyowa` / `tomari` / `kamoenai` / `shakotan` / `samani` / `erimo` / `shikabe` / `otobe` / `okushiri` / `takasu` / `higashikagura` / `pippu` / `nakafurano` / `wassamu` / `otoineppu` / `mashike` / `obira` / `tomamae` / `hamatombetsu` / `rebun` / `rishiri` / `rishirifuji` / `shari` / `okoppe` / `nishiokoppe` / `teshikaga` / `tsurui` / `shiranuka` / `shibetsucho`

### OCR待ち 2件

会議録PDFはあるが画像系PDFのため、通常のPDFテキスト抽出では本文が取れないもの。公共情報としての正確性を優先し、OCR結果は下書きに隔離して評価する。

| 自治体 | slug | 状態 |
|---|---|---|
| 初山別村 | `shosanbetsu` | 下書き評価済み。誤検出疑いと原文照合が残るため公開保留。 |
| 湧別町 | `yubetsu` | OCR実測済み。固有名詞誤認識が多く、公開保留。 |

### 別feature候補 14件

一般質問、質問・答弁要旨、議決結果、要約資料、古い会議録など、正式な本会議会議録本文とは別の扱いが必要なもの。`minutes` には混ぜない。

| 自治体 | slug | 候補feature |
|---|---|---|
| 中標津町 | `nakashibetsu` | 一般質問・委員会代表質問PDF |
| 猿払村 | `sarufutsu` | 一般質問PDF |
| 上ノ国町 | `kaminokuni` | 一般質問の質問・答弁要旨 |
| 当麻町 | `toma` | 一般質問と答弁 |
| 南富良野町 | `minamifurano` | 会議結果・一般質問 |
| 新篠津村 | `shinshinotsu` | 議決結果・一般質問 |
| 愛別町 | `aibetsu` | 一般質問動画 |
| 雄武町 | `omu` | 一般質問単位の議事録 |
| 佐呂間町 | `saroma` | 令和2年までの古い会議録 |
| 滝上町 | `takinoue` | 会議結果・議会広報・瓦版 |
| 天塩町 | `teshio` | 議会だより・視察研修報告書 |
| 剣淵町 | `kenbuchi` | 議会だより・YouTube配信・議会情報 |
| 留寿都村 | `rusutsu` | 議事日程・議決結果・議会活動 |
| 岩内町 | `iwanai` | 議事日程・議会だより・一般質問順序表 |

#### 別feature設計 v0

目的は、公開資料として有用な情報を拾いながら、正式な本会議会議録本文と混同しないこと。
まずは `publications/index.json` の候補スキーマとして扱い、1自治体で試験してから capability 化する。

| feature_type | 何を扱うか | 候補自治体 |
|---|---|---|
| `general_questions` | 一般質問、質問・答弁要旨、質問者別PDF、一般質問動画 | `nakashibetsu` / `sarufutsu` / `kaminokuni` / `toma` / `aibetsu` / `omu` / `iwanai` |
| `meeting_summaries` | 会議結果、議事日程、議会活動、会議概要 | `minamifurano` / `takinoue` / `rusutsu` / `iwanai` |
| `votes` | 議決結果、賛否、議案ごとの結果 | `shinshinotsu` / `rusutsu` / `minamifurano` |
| `council_reports` | 議会だより、議会広報、瓦版、視察研修報告書 | `takinoue` / `teshio` / `kenbuchi` / `iwanai` |
| `legacy_minutes` | 古い会議録。現行年度の本文会議録とは分けて扱う | `saroma` |

#### JSONスキーマ案

候補パス:

- 収集元: `data/{slug}/publications/index.json`
- 公開用: `site/data/{slug}/publications/index.json`

```json
{
  "schema": "council_publication.v1",
  "municipality_slug": "kaminokuni",
  "generated_at": "2026-05-20T00:00:00.000Z",
  "source_checked_at": "2026-05-20",
  "items": [
    {
      "id": "kaminokuni-general-questions-2026-01",
      "feature_type": "general_questions",
      "title": "令和8年第1回定例会 一般質問の質問・答弁要旨",
      "published_date": "2026-03-01",
      "fiscal_year": "2026",
      "meeting_name": "令和8年第1回定例会",
      "source_url": "https://example.jp/",
      "source_label": "上ノ国町議会 一般質問",
      "source_type": "pdf",
      "official_status": "summary",
      "document_url": "https://example.jp/file.pdf",
      "coverage": {
        "has_full_minutes": false,
        "includes_questions": true,
        "includes_answers": true,
        "includes_votes": false,
        "includes_agenda": false
      },
      "people": [{ "name": "山田太郎", "role": "質問者" }],
      "tags": ["一般質問"],
      "notes": "正式な本会議会議録ではなく、質問・答弁要旨として扱う。"
    }
  ]
}
```

#### 運用ルール

- `publications` は `minutes` / `segments` / `themes` に自動昇格させない。
- 本会議全文ではない資料は、検索結果・MCP・記事作成時に「要旨」「議決結果」「議会だより」などの資料種別を明示する。
- 公式URL、資料URL、確認日、全文会議録ではないことを必ず残す。
- 数字、賛否、発言内容を記事に使う場合は、`document_url` または `source_url` を原典として確認する。

#### 最初の試験対象

1件目は `kaminokuni` の `general_questions` を候補にする。
理由は、一般質問の質問・答弁要旨として資料の性格が明確で、`minutes` ではないことをUI上でも説明しやすいため。
2件目は `shinshinotsu` の `votes` を候補にし、議決結果を既存 `decisions` とどう分けるか確認する。

#### 試験データ

| 自治体 | feature_type | データ | 状態 |
|---|---|---|---|
| 上ノ国町 | `general_questions` | `data/kaminokuni/publications/index.json` | 令和7年9月定例会の一般質問PDF 1件を試験登録。質問・答弁本文は含むが、本会議全体の正式会議録ではないため `official_status: "summary"` とする。 |

OCRメモ:

- ローカル環境では `pdftoppm` と `tesseract` / `tesseract-lang` が利用可能。`ocrmypdf` / `pytesseract` は未導入。
- `yubetsu` は会議結果・会議録ページから令和6年・令和7年の会議録PDF 25件を抽出できるが、現行の `pdfplumber` テキスト抽出では大半が0文字。令和6年第1・第2臨時会だけは本文テキストが取れるが、定例会が取れないため掲載対象にはしない。
- `yubetsu` の令和7年第1回定例会1日目は、200dpi + `tesseract -l jpn+eng --psm 6` で全51ページ約126秒、約4.7万字。本文は拾えるが、`湧別町` が `湖別町` / `清別町` / `江別町` になるなど固有名詞誤認識がある。
- `shosanbetsu` の令和7年第1回定例会は、300dpi + `--psm 11` で発言本文を比較的よく取得できる。発言者は `議長 木村健一 A` / `7 番 三谷博子 君` のように抽出されるため、既存segments抽出に渡す前の正規化が必要。
- `scraper/scrape_minutes_pdf.py` には明示指定時のみ動く `--ocr-fallback` / `--ocr-psm` / `--ocr-dpi` / `--ocr-max-pages` を追加済み。通常実行ではOCRしない。
- OCR下書き生成は `scripts/build-ocr-draft.py`、評価は `scripts/evaluate-ocr-draft.mjs` で行う。下書きは `data/{slug}/ocr_drafts/` に隔離し、公開用 `minutes/` には入れない。
- `shosanbetsu` 令和7年第1回定例会の下書き評価では、34ページ・約2.5万字・発言者候補146件。既存segments評価では23セグメント、議員名寄せ9件、うち1件は「記載省略」由来の誤検出疑い。公開昇格にはこの誤検出除去と原文照合が必要。
- 次に進めるなら、OCR後処理として発言者行の復元・不要文字除去・固有名詞の明示的な補正可否を検証する。公共情報の正確性を優先し、補正できない誤認識が多い場合は公開対象外にする。

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
| 月形町 | `tsukigata` | 共通 `scrape_minutes_pdf.py` の見出し構造戦略を年別複数ページ対応に広げ、令和6年・令和7年・令和8年1月の会議結果ページから `minutes` / `segments` / `themes` まで対応済み。 |
| 秩父別町 | `chippubetsu` | 共通 `scrape_minutes_pdf.py` に議決結果直後の会議録PDFを束ねる戦略を追加し、令和6年・令和7年・令和8年1月の会議録PDFから `minutes` / `segments` / `themes` まで対応済み。 |
| 新十津川町 | `shintotsukawa` | 共通 `scrape_minutes_pdf.py` のPDFヘッダー戦略を実年度で再絞り込み、タイムスタンプ形式PDFから令和6年・令和7年・令和8年4月までの会議録を `minutes` / `segments` まで対応済み。 |
| 蘭越町 | `rankoshi` | 共通 `scrape_minutes_pdf.py` の年度別HTML戦略に年別ページを追加し、令和6年・令和7年・令和8年1月の会議録PDFから `minutes` / `segments` まで対応済み。 |
| 士幌町 | `shihoro` | 共通 `scrape_minutes_pdf.py` に会議見出し + 会議録セクション戦略を追加し、令和6年・令和7年・令和8年3月までの会議録PDFから `minutes` / `segments` まで対応済み。 |
| 上士幌町 | `kamishihoro` | 共通 `scrape_minutes_pdf.py` に一覧記事詳細の添付PDF戦略を追加し、令和6年の定例会・臨時会PDFから `minutes` / `segments` まで対応済み。 |
| 厚沢部町 | `assabu` | 共通 `scrape_minutes_pdf.py` の年別一覧 → 会議詳細戦略で、令和6年・令和7年の議事録本文PDFから `minutes` / `segments` / `themes` まで対応済み。 |
| 浦幌町 | `urahoro` | 共通 `scrape_minutes_pdf.py` の年度別HTML戦略で、令和6年・令和7年・令和8年1月の定例会・臨時会PDFから `minutes` / `segments` まで対応済み。 |
| 幌加内町 | `horokanai` | 共通 `scrape_minutes_pdf.py` に表形式の会議録PDF戦略を追加し、令和7年・令和8年の定例会・臨時会PDFから `minutes` / `segments` まで対応済み。令和6年ページはPDF掲載なし。 |
| 浦河町 | `urakawa` | 共通 `scrape_minutes_pdf.py` の年別本会議一覧 → 会議詳細戦略で、令和6年・令和7年・令和8年1月の会議録PDFから `minutes` / `segments` まで対応済み。 |
| 釧路町 | `kushirocho` | 共通 `scrape_minutes_pdf.py` に年別一覧 → 会議録詳細 → 日別PDF戦略を追加し、令和6年・令和7年の定例会・臨時会PDFから `minutes` / `segments` まで対応済み。 |
| 羅臼町 | `rausu` | 共通 `scrape_minutes_pdf.py` に年・種別見出し配下の行内PDF戦略を追加し、令和6年・令和7年の定例会・臨時会PDFから `minutes` / `segments` まで対応済み。 |
| 大空町 | `oozora` | 共通 `scrape_minutes_pdf.py` のリンクテキスト戦略で、令和6年の定例会・臨時会PDFから `minutes` / `segments` まで対応済み。 |
| 遠別町 | `embetsu` | 共通 `scrape_minutes_pdf.py` のリンクテキスト戦略を `R07` 表記に対応させ、令和6年・令和7年・令和8年1月のPDFから `minutes` / `segments` まで対応済み。 |
| 足寄町 | `ashoro` | 共通 `scrape_minutes_pdf.py` に年見出し + 会議名表の日別PDF戦略を追加し、令和6年・令和7年・令和8年1月のPDFから `minutes` / `segments` まで対応済み。 |
| 音更町 | `otofuke` | 共通 `scrape_minutes_pdf.py` にDBSR会議録ライブラリHTML戦略を追加し、令和6年・令和7年・令和8年1月の本文HTMLから `minutes` / `segments` まで対応済み。 |
| 豊富町 | `toyotomi` | 共通 `scrape_minutes_pdf.py` のリンクテキスト戦略に本文PDFフィルタを追加し、令和6年の定例議会・臨時議会PDFから `minutes` / `segments` まで対応済み。令和7年分は議事概要PDFのため対象外。 |
| 今金町 | `imakane` | 共通 `scrape_minutes_pdf.py` にp見出し + 表行PDF戦略を追加し、令和6年・令和7年・令和8年2月の定例会・臨時会PDFから `minutes` / `segments` まで対応済み。 |
| 中頓別町 | `nakatombetsu` | 共通 `scrape_minutes_pdf.py` のPDFヘッダー戦略を年別ページの年度ヒント対応に広げ、令和6年・令和7年の定例会PDFから `minutes` / `segments` まで対応済み。 |
| 江差町 | `esashi` | 共通 `scrape_minutes_pdf.py` のPDFヘッダー戦略にファイル名フィルタを追加し、令和6年・令和7年の会議結果ページから `minutes` / `segments` / `themes` まで対応済み。 |

## 見送り

| 自治体 | slug | 理由 |
|---|---|---|
| 和寒町 | `wassamu` | 公式ページに「議事録のインターネット公開は未実施」と明記。 |
| 岩内町 | `iwanai` | 調査済みメタデータでは会議録本文が確認できず、議会だより・一般質問順序表中心。 |
| 留寿都村 | `rusutsu` | 定例会・臨時会の記事と議事日程・議決結果はあるが、本会議会議録本文は未公開。 |
| 中標津町 | `nakashibetsu` | 一般質問の議員別PDF中心で、全文会議録として扱うには注記と範囲確認が必要。 |
| 初山別村 | `shosanbetsu` | 会議録PDFはあるがスキャン画像のためOCR前提。現行PDFテキスト抽出では優先度低。 |
| 猿払村 | `sarufutsu` | 村議会議事録PDFは一般質問全員分・質問者別PDFで、本会議全体の会議録本文としては扱えない。 |
| 湧別町 | `yubetsu` | 会議録PDFはあるが現行PDFテキスト抽出で本文0文字の画像系PDF。OCR処理待ち。 |
| 滝上町 | `takinoue` | 会議結果・議会広報・瓦版などの要約資料のみで、本会議会議録本文のWeb公開は未確認。 |
| 雄武町 | `omu` | 議会議事録検索ページは確認できるが、公開対象は一般質問単位が中心で、本会議全体の会議録本文としては扱えない。 |
| 佐呂間町 | `saroma` | 会議録ページは令和2年までで、令和3年以降の本会議会議録本文は未公開。 |
| 上ノ国町 | `kaminokuni` | 一般質問の質問・答弁要旨PDFのみで、本会議全体の会議録本文としては扱えない。 |
| 剣淵町 | `kenbuchi` | 議会だより・YouTube配信・議会情報中心で、本会議会議録本文のWeb公開は未確認。 |
| 南富良野町 | `minamifurano` | 会議結果PDFと一般質問のみで、本会議全体の会議録本文は未確認。 |
| 当麻町 | `toma` | 町議会定例会の一般質問と答弁のみで、本会議全体の会議録本文は未確認。 |
| 天塩町 | `teshio` | 議会だより・視察研修報告書などで、本会議会議録本文は未確認。 |

## 次の実装順

1. 通常の `minutes` 追加は、90日再確認で新規公開が見つかるまで待機する。
2. 次に実装するなら、一般質問・議決結果・要約資料を `minutes` と分離する別feature設計から着手する。
3. OCR対応は `shosanbetsu` / `yubetsu` の下書き評価に留め、原文照合フローが固まるまで公開用 `minutes` には入れない。
