# ローカルチャンク検索手順

作成日: 2026-05-09

この文書は、`data/chunks/` に生成したJSONLを、AWSやLLM APIを使わずにキーワード検索するための手順である。目的は、RAG投入前にチャンク設計と引用メタ情報の見え方を確認すること。

## 目的

ローカル検索で見るのは、AI回答の良し悪しではない。

確認すること:

- 関連ページが上位に出るか
- ページ番号が引用に使えるか
- `section` が検索結果の理解に役立つか
- 抜粋だけで内容の見当がつくか
- チャンク粒度が細かすぎないか、粗すぎないか

## 前提

先に以下を実行しておく。

```bash
python3 scripts/chunk_text.py
python3 scripts/validate_chunks.py
```

`data/chunks/*.jsonl` は再生成できるためGitには入れない。

## 実行方法

基本:

```bash
python3 scripts/local_search.py "公共交通 課題" --top-k 5
```

JSONで出力:

```bash
python3 scripts/local_search.py "公共交通 課題" --top-k 5 --json
```

抜粋の長さを変える:

```bash
python3 scripts/local_search.py "バス 利用者 減少" --top-k 5 --excerpt-chars 400
```

特定のJSONLだけ検索:

```bash
python3 scripts/local_search.py "交通空白" --paths data/chunks/2025_chitose_public_transport_plan.jsonl
```

## 最初に試すクエリ

```bash
python3 scripts/local_search.py "公共交通 課題" --top-k 5
python3 scripts/local_search.py "バス 利用者 減少" --top-k 5
python3 scripts/local_search.py "高齢者 移動 手段" --top-k 5
python3 scripts/local_search.py "地域公共交通 計画 目標" --top-k 5
python3 scripts/local_search.py "交通空白" --top-k 5
```

## 表示項目

検索結果には以下を表示する。

| 項目 | 内容 |
|---|---|
| `score` | 簡易キーワードスコア |
| `source_title` | 資料名 |
| `source_file` | 元PDFまたは抽出元ファイル名 |
| `pages` | `page_start` / `page_end` |
| `section` | 見出し候補 |
| `matched_terms` | マッチした検索語 |
| `excerpt` | 本文抜粋 |

ページ番号と資料名は、引用確認のため必ず見る。

## スコアの考え方

`scripts/local_search.py` は、非常に単純なキーワード検索である。

- クエリを空白で分ける。
- 本文、見出し、資料名、ファイル名を検索する。
- 本文に出た語を加点する。
- `section` に出た語は少し強く加点する。
- `source_title` に出た語も加点する。
- 出現するチャンクが少ない語は少し強く見る。
- すべての検索語が入ったチャンクを少し強くする。

これは本番用ランキングではない。RAG投入前に「拾えるべき根拠チャンクが拾えているか」を見るための仮スコアである。

## 人間が確認する観点

### 1. 関連ページが上位に出るか

- 「公共交通 課題」で課題整理のページが出るか。
- 「バス 利用者 減少」でバス利用状況や減少要因のページが出るか。
- 「高齢者 移動 手段」で高齢者の移動や市民アンケート関連が出るか。
- 「地域公共交通 計画 目標」で基本目標や評価指標が出るか。

### 2. 引用できるか

- `source_title` が資料名として分かるか。
- `pages` を見て原文PDFに戻れるか。
- `section` と抜粋で、どの章の話か見当がつくか。

### 3. チャンク粒度

- 1つの結果に複数テーマが混ざりすぎていないか。
- 抜粋が短すぎて意味が取れない結果ばかりになっていないか。
- 似たページばかり上位に出て、多様な根拠が取れない状態になっていないか。

### 4. 検索語の作り方

うまく出ない場合は、質問文そのままではなく、資料にありそうな語に分ける。

例:

| 質問 | 検索語 |
|---|---|
| 公共交通の主な課題は何か | `公共交通 課題` |
| バス利用者は減っているか | `バス 利用者 減少` |
| 高齢者の移動支援はあるか | `高齢者 移動 手段` |
| 計画の目標は何か | `地域公共交通 計画 目標` |

## 次に改善するなら

今回の検索はシンプルなルールベースで十分。

必要になったら、次の順で改善する。

1. ストップワードを追加する
2. `section` やページ範囲による重みを調整する
3. BM25に差し替える
4. ローカル埋め込み検索を試す
5. 最後にBedrock Knowledge BasesなどのRAG基盤へ投入する

最初からベクトル検索にしない。まずは、資料名・ページ番号・見出し・抜粋が使える形で見えているかを確認する。
