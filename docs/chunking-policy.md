# RAG投入前チャンク分割方針

作成日: 2026-05-09

この文書は、`data/processed/` の抽出済みMarkdownまたはテキストを、RAG基盤に渡しやすいJSONLへ分割する方針を定める。AWS、Bedrock、OpenSearch、RAG APIにはまだ投入しない。

## 目的

チャンク分割で最も大事なのは、あとから根拠確認できる単位にすること。

悪い例:

```text
千歳市の公共交通には課題があります。
```

この形だけでは、どの資料の何ページを見ればよいか分からない。

良い例:

```text
資料名: 千歳市地域公共交通計画
ページ: 12
章: 第2章 公共交通を取り巻く現状
本文: ...
```

この状態なら、AI回答の根拠を人間が原文に戻って確認しやすい。

## 対象

対象は `data/processed/` 配下の `.md` と `.txt`。

`scripts/extract_text.py` が出力したMarkdownでは、以下のページ区切りを使う。

```markdown
## Page 12
```

ページ区切りがない `.txt` は、フォームフィードがあればページ区切りとして扱い、なければ1ページの文書として扱う。

## 出力

出力先は `data/chunks/`。

```text
data/chunks/
  2025_chitose_public_transport_plan.jsonl
```

JSONL本体は再生成できるためコミットしない。`data/chunks/.gitkeep` だけを管理する。

## JSONLスキーマ

各行は1チャンクを表す。

```json
{
  "id": "2025_chitose_public_transport_plan-0001-abcdef1234",
  "source_file": "2025_chitose_public_transport_plan.pdf",
  "source_title": "千歳市地域公共交通計画",
  "page_start": 2,
  "page_end": 3,
  "section": "1.1. 千歳市地域公共交通計画策定の背景と目的",
  "text": "本文...",
  "char_count": 1032
}
```

必須項目:

| 項目 | 内容 |
|---|---|
| `id` | 安定したチャンクID |
| `source_file` | 元PDFまたは抽出元ファイル名 |
| `source_title` | 資料名 |
| `page_start` | チャンク開始ページ |
| `page_end` | チャンク終了ページ |
| `section` | 見出し候補。取れない場合は `null` |
| `text` | 本文 |
| `char_count` | 空白を除いた文字数 |

## 分割ルール

初期ルールはシンプルにする。

- 目安は1チャンク800〜1,200文字程度。
- デフォルトは `target_chars=1000`、`max_chars=1200`。
- ページ番号を必ず保持する。
- ページをまたぐ場合は `page_start` と `page_end` に範囲を記録する。
- 1ページが長い場合は、段落または行単位で分ける。
- 見出し候補があれば `section` に入れる。
- 表や数値は、できるだけ説明文と同じチャンクに残す。
- 目次の末尾、表紙、巻末などは短いチャンクが残る場合がある。無理に別テーマと結合して引用性を落とさない。

## 見出し候補

`scripts/chunk_text.py` は、ページ本文の先頭付近から簡易的に見出し候補を拾う。

拾いやすい例:

- `第2章 公共交通を取り巻く現状`
- `1.1. 千歳市地域公共交通計画策定の背景と目的`
- `地域公共交通を取り巻く課題と基本方針`

見出し候補は完璧でなくてよい。誤りが目立つ場合は、後で資料別の補正ルールを追加する。

## 実行方法

すべての抽出済みファイルを処理する。

```bash
python3 scripts/chunk_text.py
```

特定ファイルだけ処理する。

```bash
python3 scripts/chunk_text.py data/processed/2025_chitose_public_transport_plan.md
```

サイズを調整する。

```bash
python3 scripts/chunk_text.py --target-chars 900 --max-chars 1200
```

## 確認すること

チャンク生成後、数行だけ中身を見る。

```bash
head -3 data/chunks/2025_chitose_public_transport_plan.jsonl
```

確認観点:

- `source_title` が資料名になっているか。
- `source_file` が元PDF名になっているか。
- `page_start` / `page_end` が入っているか。
- `section` が見出しとして使えそうか。
- `text` だけを読んでも文脈が分かるか。
- `char_count` が極端に小さいチャンクばかりになっていないか。

## 初回PoCでの判断

そのまま使ってよい:

- チャンクの多くが800〜1,200文字に収まる。
- ページ番号が正しく残る。
- 見出しまたはページ本文から文脈が分かる。
- 根拠確認時に、資料名とページで原文へ戻れる。

保留:

- ほとんどのチャンクが短すぎる。
- 長すぎる表が1チャンクに入り、意味が取りづらい。
- `section` がノイズだらけになる。
- ページ範囲が広すぎて引用確認しづらい。

除外または再抽出:

- 抽出元Markdown自体が文字化けしている。
- OCRが必要な画像PDFだった。
- 表や図面だけで本文が少ない。
- 公式公開資料か確認できない。

## 次の作業

1. 3資料を抽出する。
2. `scripts/analyze_extracted_text.py` で品質を確認する。
3. 品質が許容できる資料だけ `scripts/chunk_text.py` でJSONL化する。
4. JSONLを数件目視確認する。
5. 問題がなければ、次にローカル検索またはRAG投入前の台帳整備へ進む。
