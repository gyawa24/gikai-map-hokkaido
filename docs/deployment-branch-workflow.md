# デプロイ前ブランチ運用メモ

更新日: 2026-05-06

Vercel Pro化後にビルド時間と利用量を膨らませないため、普段のAI作業は作業ブランチでまとめ、production deploy は必要なタイミングだけに絞る。

## 基本方針

- `main` は production 用。直接細かくpushしない
- 作業は `codex/<task>` ブランチで行う
- 大量データ生成はローカルで検証してから1コミットにまとめる
- Vercel Preview は原則スキップし、必要なPreviewだけ明示的に建てる
- `site/data` が大きいので、通常 `minutes` 展開とデプロイ確認を同じ試行錯誤ループにしない

## 推奨フロー

1. `main` を最新化する
2. `codex/<task>` ブランチを切る
3. 実装・データ生成・ドキュメント更新を行う
4. ローカルで確認する
   - `node scripts/verify-municipality.mjs <slug>`
   - `npm run lint` in `site/`
   - `npm run deploy:footprint` in `site/`
   - UI変更がある場合は `npm run dev` で画面確認
5. 必要な単位でコミットする
6. production に出す直前だけ `main` に取り込む

## Vercel Preview の抑制

Vercel の Ignored Build Step に次を設定する。

```sh
node scripts/vercel-ignore-build.mjs
```

このスクリプトは `production` だけ通常ビルドし、Preview はスキップする。Preview を明示的に建てたい場合は、コミットメッセージに `[deploy]` または `[vercel]` を入れるか、Vercel 側で `FORCE_VERCEL_BUILD=1` を設定して再実行する。

Vercel の仕様上、Ignored Build Step は exit `0` でスキップ、exit `1` 以上でビルド実行。

## デプロイ前チェック

- `git status --short` に不要な未追跡ファイルがない
- `gikaimap/`, `tmp_audio/`, `.DS_Store`, `.vercel`, `.env*.local` が混ざっていない
- `site/data/news.json` の追記要否を確認済み
- `docs/operations-board.md` が次の作業に更新済み
- `docs/municipality-coverage.md` が必要に応じて再生成済み
- `npm run deploy:footprint` で `site/data` の膨らみを把握済み

## すぐ使うコマンド

```sh
git checkout main
git pull --ff-only origin main
git switch -c codex/<task>
```

作業後:

```sh
git status --short
git add <必要なファイル>
git commit -m "<短い説明>"
git push -u origin codex/<task>
```
