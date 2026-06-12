# データ台帳と読み取りルール

地方議会ドットコムでは、自治体ごとの公開機能を `municipalities.json` の手書き `features` で判定しない。
サイトで表示する導線は、原則として `site/data/{slug}/` 配下の実ファイルから生成する台帳を読む。
収集・編集の正は `data/`、公開ビルドの入力は `site/data/` と分ける。

このルールは `docs/operations-principles.md` の「継続できる環境・綺麗なデータ・更新スケジュール」をデータ層に落としたもの。
新しいデータ追加や取込方法の変更は、画面実装より先にこの台帳ルールと検証ルールに反映する。

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

## 議会議員任期満了日

`data/municipalities.json` には、市町村議会議員の任期満了日を任意フィールドとして持てる。
対象は議会議員の任期のみで、首長の任期や統一選対象フラグは入れない。
統一地方選の対象判定などは、事実データからレポートスクリプト側で計算する。

- `council_term_end`: 議会議員の任期満了日。`YYYY-MM-DD`
- `council_term_end_source`: 出典URL。道選管・市町村選管などの公式資料を使う
- `council_term_end_verified_at`: 確認日。`YYYY-MM-DD`

3フィールドはセットで扱う。
不明な市町村には null や空文字を入れず、フィールド自体を置かない。
検証は `node scripts/data-health.mjs --strict` と `node scripts/report-election-terms.mjs` で行う。

## 候補データ

`publications/index.json` は、一般質問要旨・会議結果・議決結果・議会だよりなど、正式な本会議会議録本文ではない資料を扱うための候補データとする。
初期段階では capability 判定に含めず、`docs/minutes-expansion-candidates.md` の試験対象で実データを確認してから公開導線を決める。
`publications` を追加しても、`minutes` / `segments` / `themes` には自動昇格させない。
`sync-site-data` は `publications/` を公開用データへ同期するが、`_city-capabilities.json` にはまだ出さない。

## 運用ルール

- 新しい自治体データを足したら、対象ファイルを `data/{slug}/` に置き、`node scripts/sync-site-data.mjs --slug <slug> --build-capabilities --verify` で公開用データへ同期する。
- 予算OCRは `data/{slug}/budgets/` を収集元、`site/data/{slug}/budgets/` を公開用コピーとする。ページ単位OCRは大きいが、公開導線の判定は `budgets/index.json` に一本化する。
- 予算書の公式URL・取込状況は `site/data/budget_sources.json` に置く。`status: "取込済み"` は公開用OCRデータが `site/data/{slug}/budgets/{year}/manifest.json` まで揃っている場合だけ使い、URL確認だけの自治体は `status: "取得候補"` にする。規模や公開範囲が未決で当面進めないものは `status: "保留"` にし、出典は残す。
- `sync-site-data` と `onboard-municipality` は、公開用の `budgets/index.json` があるのに `budget_sources.json` が未更新の場合に警告する。警告が出たら、公式URL・年度・状態を同じ作業単位で更新する。
- `segments` は重いローカル調査用データなので、公開用コピーには通常同期しない。必要な時だけ `--include-segments` を付ける。
- `data/sapporo/` や `site/data/sapporo/` のような `.gitignore` 対象データはローカル確認用として扱う。生成台帳・健診・公開ドキュメントでは、Gitで公開されるファイルだけを基準にする。
- 導線を出すかどうかは `hasCityCapability(slug, key)` を使う。
- 静的生成対象の市町村一覧は `site/src/lib/staticCityParams.ts` を使う。
- capability が無いページは `generateStaticParams` に含めず、`dynamicParams = false` で直接アクセスも 404 にする。
- `municipalities.json` に `features` を戻さない。
- `features.includes(...)` を新規に増やさない。
- MCP や表示文言として「features」という名前を使う場合も、元データは capability 台帳にする。
- 検証は `node scripts/verify-municipality.mjs <slug>` で行い、台帳と実ファイルの不一致を確認する。
- 全体の健診は `node scripts/data-health.mjs` で行う。警告までCI的に止めたい場合は `--strict` を付ける。
