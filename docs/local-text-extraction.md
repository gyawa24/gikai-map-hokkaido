# 千歳市RAG PoC ローカルPDFテキスト抽出手順

作成日: 2026-05-09

この手順は、AWSやRAG APIに投入する前に、千歳市の公開PDFが引用に使える粒度でテキスト化できるかをローカルで確認するためのもの。

## この段階の目的

AIの回答品質ではなく、資料そのものがきれいにテキスト化できるかを見る。

確認するポイント:

- ページ番号が残るか
- 表が崩れすぎないか
- 見出しが分かるか
- 余計なヘッダー・フッターが多すぎないか
- 引用に使える粒度になっているか
- OCRが必要な画像PDFを対象外にできるか

## 最初に試す資料

`docs/ingestion-plan.md` の初回投入候補から、まずは以下の3種類を推奨する。

| 優先 | 資料 | 理由 |
|---|---|---|
| 1 | 千歳市第7期総合計画 | 市政全体の方向性を確認でき、一般質問の入口にしやすい |
| 2 | 千歳市こども計画 | 子育て・教育分野の質問作成に直結しやすい |
| 3 | 千歳市地域公共交通計画 | 交通・都市課題のPoC価値を見やすい |

防災計画や予算書は重要だが、ページ数、表、章構成が複雑になりやすいため、最初のテキスト抽出テストでは後回しにする。

## ディレクトリ

```text
data/
  raw/         # 手元に置いた公開PDF。Gitには入れない
  processed/   # 抽出したMarkdown。Gitには入れない
```

`data/raw/.gitkeep` と `data/processed/.gitkeep` だけをリポジトリに残す。PDF本体や抽出済みMarkdownは再生成できるため、コミットしない。

## PDFの置き方

公式ページからPDFを取得し、`data/raw/` に英数字のファイル名で保存する。

例:

```text
data/raw/2026_chitose_general_plan_basic.pdf
data/raw/2025_chitose_children_plan.pdf
data/raw/2025_chitose_public_transport_plan.pdf
```

PDF直URLは本文に多用せず、公式の取得元ページをメタデータに残す。

任意で、PDFと同名のメタデータJSONを置ける。

```text
data/raw/2025_chitose_public_transport_plan.pdf
data/raw/2025_chitose_public_transport_plan.pdf.metadata.json
```

例:

```json
{
  "metadataAttributes": {
    "title": "千歳市地域公共交通計画",
    "url": "https://www.city.chitose.lg.jp/docs/23549.html",
    "year": "2025",
    "category": "交通",
    "department": "企画部",
    "priority": "A",
    "source_type": "PDF"
  }
}
```

## 実行方法

`data/raw/` 内のPDFをまとめて抽出する。

```bash
python3 scripts/extract_text.py
```

1ファイルだけ試す場合:

```bash
python3 scripts/extract_text.py data/raw/2025_chitose_public_transport_plan.pdf
```

メタデータJSONをまだ作らずに試す場合:

```bash
python3 scripts/extract_text.py \
  data/raw/2025_chitose_public_transport_plan.pdf \
  --title "千歳市地域公共交通計画" \
  --source-url "https://www.city.chitose.lg.jp/docs/23549.html"
```

表の位置関係を少し残したい場合:

```bash
python3 scripts/extract_text.py data/raw/2025_chitose_public_transport_plan.pdf --layout
```

## 出力

抽出結果は `data/processed/` にMarkdownで保存される。

```text
data/processed/2025_chitose_public_transport_plan.md
```

出力には以下を含める。

- 資料名
- 元PDFファイル名
- 公式取得元ページ
- 抽出日時
- 抽出エンジン
- ページ数
- テキスト抽出できたページ数
- ページごとの本文

ページごとに以下の見出しが入る。

```markdown
## Page 12

<!-- source_file: 2025_chitose_public_transport_plan.pdf; page: 12; chars: 842 -->
```

この `Page` とコメントを使い、あとで引用元確認に戻れるかを見る。

## OCRが必要なPDFの扱い

`scripts/extract_text.py` は、テキスト層が少なすぎるPDFをOCRが必要な資料としてスキップする。

主な判定:

- 抽出文字数が少なすぎる
- テキストを取得できるページ比率が低すぎる
- ページはあるが本文がほぼ空

スキップされた場合は、初回PoCでは無理に扱わない。

```text
SKIP OCR likely required: sample.pdf (...)
```

OCR対象は、抽出品質の評価方法を別に決めてから扱う。

## 抽出結果の見方

1. `data/processed/*.md` を開く。
2. 目次や章見出しが読めるか見る。
3. ページ番号ごとに本文が分かれているか見る。
4. 表が読める範囲で残っているか見る。
5. ヘッダー・フッターが毎ページ大量に混ざっていないか見る。
6. 数値、年度、計画期間が崩れていないか見る。
7. 引用に使うなら、該当ページへ戻れるか確認する。

評価メモの観点:

| 観点 | 見ること |
|---|---|
| ページ番号 | `## Page N` で追えるか |
| 見出し | 章・節・施策名が残っているか |
| 表 | 数値と項目の対応が崩れすぎていないか |
| ノイズ | ヘッダー、フッター、ページ番号だけの行が多すぎないか |
| 引用性 | 回答の根拠として該当箇所を再確認できるか |

## 次にやること

1. 3資料を抽出する。
2. それぞれ5ページ程度を目視確認する。
3. 表が崩れる資料は `--layout` あり・なしを比較する。
4. OCRスキップされた資料は初回対象から外す。
5. 抽出品質が良い資料だけ、次のPoC投入候補に残す。
