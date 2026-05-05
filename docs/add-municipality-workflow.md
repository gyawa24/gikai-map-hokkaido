# 市町村追加ワークフロー

`data/municipalities.json` を単一の真実源として扱い、`site/data/` は同期先とする。
新しい市町村を足すときも、既存市町村に `members` / `minutes` を追加するときも、この順で進める。

## 1. 市町村メタデータを登録する

新規登録:

```bash
node scripts/onboard-municipality.mjs \
  --slug sample \
  --name 例市 \
  --council-name 例市議会 \
  --region 石狩 \
  --furigana れいし \
  --features members,minutes \
  --tenant-id 999 \
  --system dnp
```

既存登録の更新:

```bash
node scripts/onboard-municipality.mjs \
  --slug suttsu \
  --minutes-status unavailable \
  --minutes-status-note "公式サイトには議会の日程と議会だよりのみで、本会議会議録は未公開です。" \
  --minutes-verified-at 2026-04-22
```

このコマンドで行うこと:

- `data/municipalities.json` を更新
- `site/data/municipalities.json` を同内容で同期
- `data/{slug}/` と `site/data/{slug}/` を作成
- `data/{slug}/` に既にあるファイルを `site/data/{slug}/` へ同期

## 2. 収集データを `data/{slug}/` に置く

最低限の配置:

- 議員一覧のみ: `data/{slug}/members.json`
- 議事録あり: `data/{slug}/minutes/index.json` と `data/{slug}/minutes/{id}.json`

原則:

- スクレイパの出力先は `data/{slug}/` を正とする
- `site/data/{slug}/` は手で編集しない

## 3. `segments` を生成して同期する

議事録がある市町村では、次で `segments` まで一気に揃える。

```bash
node scripts/onboard-municipality.mjs --slug sample --build-segments --verify
```

このコマンドは:

- `data/{slug}/minutes/` の有無を確認
- `scripts/build-segments.mjs <slug>` を実行
- 生成された `data/{slug}/segments/` を `site/data/{slug}/segments/` に同期
- 最後に `scripts/verify-municipality.mjs <slug>` を実行

議事録が無い場合は `segments` を自動でスキップする。

既存自治体の `minutes` 更新をまとめて回したい時は、スクレイパの種類を意識せず次を使う。

```bash
node scripts/refresh-minutes.mjs --all-published --years 2025,2026 --verify --coverage
```

このコマンドは:

- 自治体ごとの既知スクレイパを自動判定して `minutes` を再取得
- `build-segments.mjs` まで続けて実行
- 必要なら `verify-municipality.mjs` と `generate-municipality-coverage.mjs` も実行
- `members only` で新規に公開できそうな自治体は、別途 `municipalities.json` の feature 反映判断を残す

## 4. 導線の整合性を確認する

画面確認の前に、metadata と data の食い違いがないかを機械的に確認する。

`onboard-municipality.mjs --verify` を使わない場合だけ、単独で次を実行する。

```bash
node scripts/verify-municipality.mjs sample
```

このコマンドは:

- `data/municipalities.json` と `site/data/municipalities.json` の entry 同期を確認
- `features` と `members.json` / `minutes/index.json` の整合性を確認
- `data/{slug}/` と `site/data/{slug}/` の主要ファイル同期を確認
- 議事録がある市で `segments/_index.json` が揃っているか確認

## 5. 議事録未公開確認の鮮度を保つ

`minutes_status: unavailable` は一度確認したら終わりにせず、`minutes_verified_at` を基準に再確認する。
候補抽出は次を使う。

```bash
node scripts/list-stale-minutes-verifications.mjs
```

期限前も含めて全件を見たい場合:

```bash
node scripts/list-stale-minutes-verifications.mjs --all
```

再確認間隔:

- `minutes_verified_at` が無い: すぐ再確認
- 公式サイトに会議録PDF等があるが未取込: 30日ごと
- 通常の未公開確認済み: 90日ごと
- 「インターネット公開は未実施」「情報開示請求」「議会図書室で閲覧」等の明記あり: 180日ごと

再確認後は `onboard-municipality.mjs` で `minutes_status_note` と `minutes_verified_at` を更新する。
会議録本文の公開を確認した場合は、`minutes_status` を `available` にする前に `minutes` / `segments` まで生成する。

## 6. 画面確認

```bash
cd site
npm run dev
```

確認ポイント:

- `http://localhost:3000/{slug}` でページが開く
- `members.json` があれば議員一覧が表示される
- `minutes/index.json` があればナビに `議事録` が出る
- `minutes_status: unavailable` を入れた市は未公開注意が出る
- 404 ではなく空状態フォールバックで表示される

## 補足

- `features` は公開できる機能だけを入れる
- `minutes` を付ける前に `data/{slug}/minutes/index.json` が揃っているか確認する
- `members` を付けても `members.json` が無ければ画面は「準備中」表示になる
- browser 制約で画面確認がすぐできない時も、最低限 `verify-municipality.mjs` までは通してから次に進む
