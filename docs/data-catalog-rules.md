# データ台帳と読み取りルール

地方議会ドットコムでは、自治体ごとの公開機能を `municipalities.json` の手書き `features` で判定しない。
サイトで表示する導線は、原則として `site/data/{slug}/` 配下の実ファイルから生成する台帳を読む。
収集・編集の正は `data/`、公開ビルドの入力は `site/data/` と分ける。

## 単一の入口

- 収集元データ: `data/{slug}/`
- 公開用データ: `site/data/{slug}/`
- 生成台帳: `site/data/_city-capabilities.json`
- 生成スクリプト: `site/scripts/build-city-capabilities.mjs`
- 読み取りAPI: `site/src/lib/cityCapabilities.ts`
- 同期スクリプト: `scripts/sync-site-data.mjs`

`_city-capabilities.json` はビルド生成物なので直接編集しない。
ローカル起動時とビルド前に自動生成する。

## 機能判定

| capability | 判定ファイル |
|---|---|
| `members` | `members.json` |
| `minutes` | `minutes/index.json` または `index.json` |
| `sessions` | `sessions/index.json` |
| `themes` | `members_activity.json` |
| `budgets` | `budgets/index.json` |
| `decisions` | `decisions.json` |
| `schedule` | `schedule.json` |
| `newsletter` | `newsletter.json` |
| `election` | `election.json` |
| `plan` | `comprehensive_plan.json` |
| `segments` | `segments/_index.json` |

画面、サイトマップ、MCP の `list_municipalities` はこの台帳を優先して読む。
`municipalities.json` は自治体の基本メタデータ、スクレイピング設定、未公開確認状況を持つ。
`features` は持たせない。

## 運用ルール

- 新しい自治体データを足したら、対象ファイルを `data/{slug}/` に置き、`node scripts/sync-site-data.mjs --slug <slug> --build-capabilities --verify` で公開用データへ同期する。
- 予算OCRは `data/{slug}/budgets/` を収集元、`site/data/{slug}/budgets/` を公開用コピーとする。ページ単位OCRは大きいが、公開導線の判定は `budgets/index.json` に一本化する。
- `segments` は重いローカル調査用データなので、公開用コピーには通常同期しない。必要な時だけ `--include-segments` を付ける。
- 導線を出すかどうかは `hasCityCapability(slug, key)` を使う。
- 静的生成対象の市町村一覧は `site/src/lib/staticCityParams.ts` を使う。
- capability が無いページは `generateStaticParams` に含めず、`dynamicParams = false` で直接アクセスも 404 にする。
- `municipalities.json` に `features` を戻さない。
- `features.includes(...)` を新規に増やさない。
- MCP や表示文言として「features」という名前を使う場合も、元データは capability 台帳にする。
- 検証は `node scripts/verify-municipality.mjs <slug>` で行い、台帳と実ファイルの不一致を確認する。
- 全体の健診は `node scripts/data-health.mjs` で行う。警告までCI的に止めたい場合は `--strict` を付ける。
