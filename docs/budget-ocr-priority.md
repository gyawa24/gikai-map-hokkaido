# 予算OCR候補 優先順位メモ

最終更新: 2026-05-20

`site/data/budget_sources.json` の `取得候補` から、次に公開OCRへ進める自治体を選ぶためのメモ。
公開データ化する時は、`data/{slug}/budgets/` と `site/data/{slug}/budgets/` を揃え、`budget_sources.json` を `取込済み` に更新する。

## 次に進める2件

### 1. 岩見沢市

- 公式ページ: [岩見沢市の予算](https://www.city.iwamizawa.hokkaido.jp/soshiki/zaisei/gyozaisei/4262.html)
- 既存データ: `members` / `minutes` / `themes` あり
- 令和8年度PDF:
  - `予算の概要`: 38ページ、約7.3MB、抽出文字数 約8.1万字
  - `一般会計`: 1ページ、約90KB、抽出文字数 約2,700字
  - `特別会計`: 3ページ、約140KB、抽出文字数 約7,100字
  - `病院事業会計`: 1ページ、約247KB、抽出文字数 約3,400字
- 良い点:
  - 令和8年度の会計別PDFが軽く、初回取込の失敗リスクが低い。
  - 病院事業会計が分かれており、公営企業の掲載範囲確認にも使いやすい。
  - 小樽と同じく既存の議事録・テーマデータと合わせて使える。
- 注意点:
  - ページには過年度PDFも多く、令和8年度だけを明確に拾うルールが必要。

## 取込済み

### 小樽市

- 公式ページ: [小樽市令和8年度予算](https://www.city.otaru.lg.jp/docs/2025102700021/)
- 既存データ: `members` / `minutes` / `themes` あり
- 予算書PDF:
  - `令和8年度小樽市予算書`: 34ページ、約1.2MB、抽出文字数 約6.0万字
  - `令和8年度小樽市予算説明書`: 407ページ、約21.1MB、抽出文字数 約124万字
- 取込結果:
  - 2本のPDFを結合し、441ページの公開OCRデータとして取込済み。
  - `data/otaru/budgets/2026/` と `site/data/otaru/budgets/2026/` を同期済み。
  - 原本画像は軽量設定（110dpi / quality 68）で `site/public/budgets/otaru/2026/pages/` に生成済み。
- 良い点:
  - 予算書と説明書が明確に分かれている。
  - 観光、宿泊税、ふるさと納税など、記事化・比較に使いやすいテーマがある。
  - 既存の議事録・テーマデータと組み合わせやすい。
- 注意点:
  - 説明書が407ページあるため、画像生成まで含めるとサイズ管理が必要。

## 3番手候補

### 江別市

- 公式ページ: [令和8年度予算書](https://www.city.ebetsu.hokkaido.jp/site/zaisei/148190.html)
- 予算書PDF:
  - `令和8年度各会計予算書及び予算説明書`: 261ページ、約1.1MB、抽出文字数 約50万字
- 良い点:
  - 単一PDFで全体を扱いやすい。
  - ファイルサイズが小さく、OCRではなく通常テキスト抽出で進めやすい。
- 位置づけ:
  - 小樽・岩見沢の次に進める候補。どちらかで詰まった時の代替にも向く。

## 後回し候補

### 札幌市

- 公式ページ: [令和8年度予算](https://www.city.sapporo.jp/zaisei/kohyo/yosan-kessan/r8/reiwa8nendo_yosan.html)
- 理由:
  - 予算書、説明書、企業会計、概要、局別資料などが揃っていて価値は高い。
  - ただし規模が大きく、ローカル専用データとの公開境界も慎重に扱う必要がある。

### 室蘭市

- 公式ページ: [予算](https://www.city.muroran.lg.jp/content/?content=1921)
- 理由:
  - 一般会計、特別会計、公営企業会計がきれいに分かれている。
  - 令和8年度一般会計予算書が約28.9MBと重く、まずは軽い候補で運用を固めてから進める。

### 北広島市

- 公式ページ: [令和8年度当初予算案記者会見記録](https://www.city.kitahiroshima.hokkaido.jp/hotnews/detail/00158503.html)
- 理由:
  - 現時点の候補URLは予算のポイント中心。
  - 予算書本体の公開元確認を先に行う。

## 次の作業

1. 岩見沢市の令和8年度PDF4本を結合または複数文書として扱う方針を決める。
2. 取込後、`site/data/budget_sources.json` の岩見沢を `取込済み` にする。
3. `node scripts/sync-site-data.mjs --slug <slug> --build-capabilities --verify` と `node scripts/data-health.mjs --strict` を通す。
