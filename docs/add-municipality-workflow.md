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
node scripts/onboard-municipality.mjs --slug sample --build-segments
```

このコマンドは:

- `data/{slug}/minutes/` の有無を確認
- `scripts/build-segments.mjs <slug>` を実行
- 生成された `data/{slug}/segments/` を `site/data/{slug}/segments/` に同期

議事録が無い場合は `segments` を自動でスキップする。

## 4. 導線の整合性を確認する

画面確認の前に、metadata と data の食い違いがないかを機械的に確認する。

```bash
node scripts/verify-municipality.mjs sample
```

このコマンドは:

- `data/municipalities.json` と `site/data/municipalities.json` の entry 同期を確認
- `features` と `members.json` / `minutes/index.json` の整合性を確認
- `data/{slug}/` と `site/data/{slug}/` の主要ファイル同期を確認
- 議事録がある市で `segments/_index.json` が揃っているか確認

## 5. 画面確認

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
