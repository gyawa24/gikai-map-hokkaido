# 地方議会ドットコム site

地方議会ドットコムの Next.js フロントエンド。

本番は Cloudflare Workers / Static Assets（OpenNext）で配信する。Vercel は当面 rollback 用として保持する。

## ローカル起動

```bash
cd site
npm install
npm run dev
```

`predev` で次の公開用生成データを更新してから Next.js dev server を起動する。

- `site/data/_city-capabilities.json`
- `site/data/_search-index.json`
- `site/data/opendata/`

## よく使うコマンド

```bash
# lint
npm run lint

# Next.js build
npm run build

# Cloudflare local preflight
npm run cf:preflight

# Cloudflare production host check
npm run cf:post-cutover-check
```

## 作業時の注意

- Next.js 16 固有の注意は [`AGENTS.md`](AGENTS.md) を確認する。
- UI を触る場合はリポジトリルートの [`DESIGN.md`](../DESIGN.md) を確認する。
- 大きい議事録本文を Worker / Function bundle に戻さない。
- `site/data/` は公開ビルド入力。収集・編集の正は原則としてルートの `data/{slug}/`。
- 市町村ごとの機能出し分けは `_city-capabilities.json` を使い、画面側で特定自治体名をハードコードしない。

## 関連ドキュメント

- [`../AGENTS.md`](../AGENTS.md)
- [`../DESIGN.md`](../DESIGN.md)
- [`../docs/operations-principles.md`](../docs/operations-principles.md)
- [`../docs/cloudflare-deploy-runbook.md`](../docs/cloudflare-deploy-runbook.md)
- [`../docs/news-workflow.md`](../docs/news-workflow.md)
