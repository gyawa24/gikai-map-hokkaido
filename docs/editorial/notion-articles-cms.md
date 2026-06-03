# Notion読みものCMS運用メモ

地方議会ドットコムの読みものは、公開安定性とSEOを優先し、本番では原則 `site/content/articles/*.md` を正とする。
Notionは下書き・編集・同期元として使い、公開前にMarkdownへ固定する。

`ARTICLE_SOURCE=hybrid` / `ARTICLE_SOURCE=notion` を設定すると、検証環境でNotion記事を直接読むこともできる。
ただし、本番常時CMS運用はNotion APIやsecret管理に依存するため、通常は使わない。

## 作成済みDB

- Notion DB: https://www.notion.so/72e1c3080f5e475b8783baf5492820d4
- Data source ID: `ba85313f-8475-4303-a891-119f8626af92`
- 作成先: `国民民主党 千歳市政策委員 小川陽平オフィシャルサイト` 配下

## 環境変数

ローカルの `site/.env.local` に必要なもの:

```bash
ARTICLE_SOURCE=local
NOTION_TOKEN=secret_xxx
NOTION_ARTICLES_DATA_SOURCE_ID=ba85313f-8475-4303-a891-119f8626af92
NOTION_VERSION=2026-03-11
```

`NOTION_ARTICLES_DATA_SOURCE_ID` が分からない場合は、代わりに `NOTION_ARTICLES_DATABASE_ID` を設定できる。この場合、最初の data source を自動で読む。

## 記事ソースのモード

| モード | 用途 | 挙動 |
|---|---|---|
| `ARTICLE_SOURCE=local` | 本番基本 | `site/content/articles/*.md` だけを読む |
| `ARTICLE_SOURCE=hybrid` | ローカル・ステージング確認 | MarkdownとNotionを読み、同じslugはNotion側で上書き |
| `ARTICLE_SOURCE=notion` | 検証用 | Notionだけを読む |

未設定時は `local` として扱う。

## NotionからMarkdownへ同期

公開前に次のコマンドでNotion記事をMarkdownへ変換する。

```bash
cd site
npm run articles:sync-notion:dry-run
npm run articles:sync-notion
```

同期対象は `status` が `Published` / `公開` / `公開済み` / `公開候補` / `ready` の記事。
同期後は `site/content/articles/*.md` を確認し、通常のGit変更として公開する。

この運用にすると、Notion連携をOFFにしても公開済み記事のURLと本文は消えない。

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
同期スクリプトは、ページ本文の見出しを公開Markdownの `##` 見出しとして出力する。

## 公開ルール

- `status` が `Published` / `公開` / `公開済み` / `公開候補` / `ready` のページだけMarkdown同期対象にする。
- `slug` は公開URLになるため、変更するとURLも変わる。
- 議事録や予算書を根拠にした記事は、`docs/editorial/article-source-policy.md` に従い、本文内または末尾に原典リンクを置く。
- 本番は原則 `ARTICLE_SOURCE=local` のままにする。
- Notion API取得を直接使う場合は、検証環境で `ARTICLE_SOURCE=hybrid` を使う。
- Notionで公開候補にした記事は、Markdown同期後にGitで公開する。
