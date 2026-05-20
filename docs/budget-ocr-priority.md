# 予算OCR候補 優先順位メモ

最終更新: 2026-05-20

`site/data/budget_sources.json` の `取得候補` から、次に公開OCRへ進める自治体を選ぶためのメモ。
公開データ化する時は、`data/{slug}/budgets/` と `site/data/{slug}/budgets/` を揃え、`budget_sources.json` を `取込済み` に更新する。

## 次に進める1件

### 1. 室蘭市

- 公式ページ: [予算](https://www.city.muroran.lg.jp/content/?content=1921)
- 位置づけ:
  - 一般会計、特別会計、公営企業会計がきれいに分かれている。
  - ただし令和8年度一般会計予算書が約28.9MBと重いため、画像品質・公開サイズの方針確認が先。
- 次の判断:
  - 最初から3本すべて結合するか、一般会計から段階取込するかを決める。
  - 公営企業会計を上下水道・病院・その他の表示にどう反映するかを確認する。

## 取込済み

### 江別市

- 公式ページ: [令和8年度予算書](https://www.city.ebetsu.hokkaido.jp/site/zaisei/148190.html)
- 予算書PDF:
  - `令和8年度各会計予算書及び予算説明書`: 261ページ、約1.1MB、抽出文字数 約50万字
- 取込結果:
  - 単一PDFから261ページの公開OCRデータとして取込済み。
  - `data/ebetsu/budgets/2026/` と `site/data/ebetsu/budgets/2026/` を同期済み。
  - 原本画像は軽量設定（110dpi / quality 68）で `site/public/budgets/ebetsu/2026/pages/` に生成済み。
- 良い点:
  - 単一PDFで全体を扱いやすい。
  - ファイルサイズが小さく、OCRではなく通常テキスト抽出で進めやすい。
- 位置づけ:
  - 小樽・岩見沢に続く公開予算OCRの継続取込として完了。

### 岩見沢市

- 公式ページ: [岩見沢市の予算](https://www.city.iwamizawa.hokkaido.jp/soshiki/zaisei/gyozaisei/4262.html)
- 既存データ: `members` / `minutes` / `themes` あり
- 令和8年度PDF:
  - `予算の概要`: 38ページ、約7.3MB、抽出文字数 約8.1万字
  - `一般会計`: 1ページ、約90KB、抽出文字数 約2,700字
  - `特別会計`: 3ページ、約140KB、抽出文字数 約7,100字
  - `病院事業会計`: 1ページ、約247KB、抽出文字数 約3,400字
- 取込結果:
  - 4本のPDFを結合し、43ページの公開OCRデータとして取込済み。
  - `data/iwamizawa/budgets/2026/` と `site/data/iwamizawa/budgets/2026/` を同期済み。
  - 原本画像は軽量設定（120dpi / quality 72）で `site/public/budgets/iwamizawa/2026/pages/` に生成済み。
- 良い点:
  - 令和8年度の会計別PDFが軽く、初回取込の失敗リスクが低い。
  - 病院事業会計が分かれており、公営企業の掲載範囲確認にも使いやすい。
  - 小樽と同じく既存の議事録・テーマデータと合わせて使える。
- 注意点:
  - ページには過年度PDFも多く、令和8年度だけを明確に拾うルールが必要。

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

## 後回し候補

### 札幌市

- 公式ページ: [令和8年度予算](https://www.city.sapporo.jp/zaisei/kohyo/yosan-kessan/r8/reiwa8nendo_yosan.html)
- 理由:
  - 予算書、説明書、企業会計、概要、局別資料などが揃っていて価値は高い。
  - ただし規模が大きく、ローカル専用データとの公開境界も慎重に扱う必要がある。

### 北広島市

- 公式ページ: [令和8年度当初予算案記者会見記録](https://www.city.kitahiroshima.hokkaido.jp/hotnews/detail/00158503.html)
- 理由:
  - 現時点の候補URLは予算のポイント中心。
  - 予算書本体の公開元確認を先に行う。

## 次の作業

1. 室蘭市の令和8年度PDF構成とサイズを再確認する。
2. 一般会計から段階取込するか、会計別PDFを結合するか決める。
3. `node scripts/sync-site-data.mjs --slug <slug> --build-capabilities --verify` と `node scripts/data-health.mjs --strict` を通す。
