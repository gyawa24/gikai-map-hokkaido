# Notion読みものCMS運用メモ

地方議会ドットコムの読みものは、Notion DBを設定するとNotionから取得し、未設定または取得失敗時は `site/content/articles/*.md` を表示する。

## 作成済みDB

- Notion DB: https://www.notion.so/72e1c3080f5e475b8783baf5492820d4
- Data source ID: `ba85313f-8475-4303-a891-119f8626af92`
- 作成先: `国民民主党 千歳市政策委員 小川陽平オフィシャルサイト` 配下

## 環境変数

本番・検証環境とローカルの `site/.env.local` に必要なもの:

```bash
NOTION_TOKEN=secret_xxx
NOTION_ARTICLES_DATA_SOURCE_ID=ba85313f-8475-4303-a891-119f8626af92
NOTION_VERSION=2026-03-11
```

`NOTION_ARTICLES_DATA_SOURCE_ID` が分からない場合は、代わりに `NOTION_ARTICLES_DATABASE_ID` を設定できる。この場合、最初の data source を自動で読む。

## Notion DBの推奨プロパティ

| プロパティ | 種別 | 必須 | 例 |
|---|---|---:|---|
| `title` | Title | 必須 | 議会質問の背景を読む |
| `slug` | Text | 必須 | good-question-interview-series |
| `status` | Status / Select | 必須 | `Published` または `公開` |
| `summary` | Text | 推奨 | 記事一覧やOGP説明に使う短い説明 |
| `published_at` | Date | 推奨 | 2026-05-15 |
| `category` | Select | 任意 | 企画 / 解説 / インタビュー |
| `tags` | Multi-select | 任意 | 議会質問, 予算 |
| `author` | Text | 任意 | 地方議会ドットコム編集部 |
| `readingMinutes` | Number | 任意 | 4 |
| `body` | Text | 任意 | Markdown本文 |

本文はNotionページ本文の見出し・段落からも取得できる。`body` プロパティを使う場合はMarkdownとして `## 見出し` と本文を入れる。

## 公開ルール

- `status` が `Published` / `公開` / `公開済み` のページだけ公開する。
- `slug` は公開URLになるため、変更するとURLも変わる。
- 議事録や予算書を根拠にした記事は、`docs/editorial/article-source-policy.md` に従い、本文内または末尾に原典リンクを置く。
- Notion API取得は10分単位で再検証する。即時反映したい場合は、再デプロイまたは将来のrevalidate webhookを使う。
