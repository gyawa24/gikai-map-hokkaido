# 進行中worktreeの分割台帳

最終更新: 2026-08-13

## なぜ分けるか

現在の`main`には、公開時期と外部依存が異なる4つの未コミット作業がある。検証はまとめて実行してよいが、コミット・stagingデプロイ・本番反映は作業単位ごとに行う。

## 1. AWS政策リサーチAPI

AWSへ独立デプロイするバックエンド。通常サイトのCloudflare配信とは分離する。

```text
research-api/
```

含めないもの:

- `research-api/node_modules/`
- `research-api/dist/`
- `research-api/.aws-sam/`
- `.env`、API key、AWS credential

検証:

```bash
cd research-api
npm test
```

現在の外部状態は[`research-api/README.md`](../research-api/README.md)を参照する。

## 2. 政策リサーチ限定UI

AWS APIをブラウザへ直接公開せず、Cloudflare Workerのサーバーproxyから呼ぶ。

```text
site/src/app/research/
site/src/app/api/research/
site/src/components/research/
site/src/lib/researchAuth.ts
site/src/lib/researchCoverage.ts
site/src/types/research.ts
site/src/lib/security.ts
site/scripts/build-search-index.mjs
site/.env.example
```

`site/package.json`は予算Data Loopとも共有するため、コミット時に内容を確認する。

## 3. 予算Data Loop限定UI

5市のR7・R8予算を、共通認証後だけ表示する技術検証画面。

```text
site/src/app/data-loop-preview/
site/src/components/data-loop-preview/
site/src/lib/dataLoopPreview.ts
site/scripts/build-data-loop-preview.mjs
site/scripts/verify-data-loop-preview.mjs
site/scripts/verify-data-loop-preview-local.mjs
site/data/data-loop-preview/
site/src/middleware.ts
docs/data-loop-preview-runbook.md
```

`site/package.json`、`site/.env.example`、認証実装は政策リサーチ限定UIと共有する。

検証:

```bash
cd site
npm run check:data-loop-preview
npm run lint
```

## 4. 江別構造化議事録

AWS・予算Data Loopとは無関係な公開サイト改善。

```text
scripts/build-ebetsu-structured-minutes.mjs
scripts/prototype-ebetsu-turns.mjs
scripts/validate-ebetsu-20251002.mjs
data/ebetsu/turns/20251002.json
data/structured-minutes/ebetsu/20251002.json
site/data/ebetsu/turns/20251002.json
site/data/structured-minutes/ebetsu/20251002.json
site/src/app/[city]/minutes/
site/src/components/RemoteMinutesDetailClient.tsx
site/src/components/StructuredMinutesCallout.tsx
site/src/components/structured-minutes/
site/src/lib/minutesPresentation.ts
site/data/news.json
```

検証:

```bash
node scripts/validate-ebetsu-20251002.mjs
cd site
npm run validate:structured-minutes
npm run lint
```

## 共有・運用文書

```text
.gitignore
README.md
docs/operations-board.md
docs/repository-workstreams.md
```

これらは整理用の独立コミット候補。機能コミットへ混ぜても動作には影響しないが、先に保存すると後続レビューが分かりやすい。

## 推奨保存順

1. リポジトリ整理文書
2. AWS政策リサーチAPI
3. 江別構造化議事録
4. 政策リサーチ限定UIと予算Data Loop限定UI
5. Bedrock承認後、Cloudflare staging secret設定と限定公開

4は認証実装と`package.json`を共有するため、一つの限定UI基盤としてまとめるのが安全。staging確認後も、本番反映は別判断にする。
