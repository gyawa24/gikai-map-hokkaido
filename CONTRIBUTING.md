# Contributing

地方議会ドットコムへの貢献を歓迎します。

このプロジェクトは、北海道内の市町村議会情報を市民が横断的に探せるようにするための非公式 OSS です。正確性、出典、継続運用を重視します。

## 貢献できること

- 公式ページ URL のリンク切れ報告
- 議員名、会派、任期、議事録タイトルなどの誤り報告
- 新しい自治体データの追加
- スクレイパやデータ検証スクリプトの改善
- 検索、MCP、サイト UI の改善
- ドキュメントの改善

## Issue を出す前に

できる範囲で次を含めてください。

- 対象自治体名
- 対象ページ URL
- 公式資料 URL
- 何が誤っているか、または何を追加したいか
- 確認日

議員氏名、発言、議決結果、予算額などは公共情報として扱うため、推測だけで変更せず、必ず公式資料を根拠にしてください。

## Pull Request の方針

- 変更範囲を小さくしてください。
- 頼まれていないリファクタは避けてください。
- UI 変更は `DESIGN.md` を確認してください。
- データ変更は `docs/data-catalog-rules.md` と `docs/open-data-policy.md` を確認してください。
- 記事や読みものに関わる変更は `docs/editorial/article-source-policy.md` を確認してください。

## よく使う検証

```bash
# データ全体の健診
node scripts/data-health.mjs --strict

# 自治体単位の確認
node scripts/verify-municipality.mjs <slug>

# サイト実装を触った場合
cd site
npm run lint
npm run build
```

変更内容によって必要な検証は変わります。迷った場合は `AGENTS.md` と `docs/operations-principles.md` を確認してください。

## セキュリティ

脆弱性や秘密情報の漏えいを見つけた場合は、公開 Issue ではなく `SECURITY.md` の手順に従って連絡してください。
