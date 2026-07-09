# 検索PoC

本番検索をすぐ差し替えず、静的bigramシャード方式が地方議会ドットコムの検索に合うかを小さく検証する場所。

## 実行

```bash
node docs/search-poc/bigram-poc.mjs --write-report
```

前提として `site/public/generated/search-indexes/*.json` が生成済みであること。
未生成の場合は先に以下を実行する。

```bash
cd site
node scripts/build-search-index.mjs
```

## 見る数字

- 正解台帳チェックが通るか
- 千歳・恵庭・苫小牧の代表ケースが市内検索で壊れていないか
- 2文字語（除雪、防災、給食など）が候補を取れるか
- 議員名（小川陽平など）が空白なしでも拾えるか
- クエリに必要なposting shardのgzipサイズが500KB以下に収まるか

## 位置づけ

このPoCは、実装前にbigram方式の転送量と精度を見るための検証用。
本体側では、まず `/search?city=...` の市内検索だけで候補取得を置き換え、
全道横断検索は従来方式のまま残す。
