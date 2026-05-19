# AI駆動運営ガイド

このプロジェクトは、毎週決まった時間に回すよりも、気づいた時に AI と一緒に前へ進める方が相性がよい。
その前提で、`何をやるか迷わないための判断基準` と `作業を終わりまで持っていくための最小ルール` をまとめる。

## この運営方式の前提

- 週次スプリントより `気づいた時にすぐ進められる構造` を優先する
- 大きな計画より `今やる / 次にやる / そのうちやる` の3段で回す
- 179市町村展開を前提に、1回限りの手作業はできるだけ増やさない
- AI には「調査」ではなく「実装・整備・確認」までやらせる

## 真実源の役割

使い分けは固定する。

- `data/municipalities.json`
  - 市町村メタデータの単一の真実源
- `docs/municipality-coverage.md`
  - 全自治体の機能充足状況と欠けの一覧
- `docs/minutes-expansion-candidates.md`
  - 次に `minutes` 化しやすい自治体候補
- `docs/operations-board.md`
  - 直近で着手する作業の単一の真実源
- `site/data/news.json`
  - 利用者に見せる更新情報の単一の真実源
- `scripts/refresh-minutes.mjs`
  - 既知スクレイパごとの `minutes` 再取得をまとめて回す入口

## 優先レーン

気づいた時に最初に選ぶのは、作業内容ではなく `レーン`。

### A. Coverage

公開価値を増やす仕事。

- 新しい自治体に `members` を追加
- 新しい自治体に `minutes` を追加
- `segments` / `themes` まで伸ばす
- フル機能自治体を増やす

### B. Freshness

更新が止まって見えないようにする仕事。

- 既存自治体の議事録を追加入力
- 既存の `minutes` 対応自治体を `refresh-minutes.mjs` で再取得
- `minutes_status` / `minutes_verified_at` の再確認
- 更新導線や最終更新表示の整備

### C. Discoverability

既にあるデータを見つけやすくする仕事。

- 検索導線
- テーマ別導線
- 議員 → 発言 → 議事録 → 議決 の横移動
- SEO、構造化データ、内部リンク

### D. Automation

同じ作業を繰り返さないための仕事。

- scraper 共通化
- `segments` 生成の自動化
- metadata / capability 台帳 / data の整合性チェック
- 自治体追加の一気通しコマンド化
- `minutes` 再取得の一括実行

## どのレーンを先にやるか

迷った時は次の順に判定する。

1. 利用者に見える壊れがあるなら、それを先に直す
2. 1自治体まるごと公開価値を増やせるなら `Coverage`
3. 既存自治体が古くなっているなら `Freshness`
4. 同じ不便を2回感じたら `Automation`
5. データはあるのに見つけづらいなら `Discoverability`

### 具体的な優先度

原則はこの順。

1. 既存の壊れや不整合修正
2. `members` / `minutes` 未整備自治体の追加
3. 既存自治体の更新追随
4. テーマ別・検索・SEOの導線改善
5. 繰り返し作業の自動化
6. 実験的なAI機能

## タスクの切り方

AI に投げる単位は `1自治体` または `1導線` または `1自動化ポイント` に絞る。

良い切り方:

- `numata の minutes を追加して segments まで生成する`
- `suttsu の members.json を整備して metadata と同期する`
- `自治体追加後の verify を1コマンドにまとめる`
- `検索ページの生活テーマ導線を1段追加する`

悪い切り方:

- `北海道全体をいい感じにする`
- `使いやすくして`
- `179市町村展開を進める`

## 着手前チェック

毎回この順で見ればよい。

1. `docs/operations-board.md` を見る
2. 対象自治体なら `docs/municipality-coverage.md` を見る
3. `data/{slug}/` と `site/data/{slug}/` の現状を確認する
4. 既存パターンがある自治体を1つ探して真似る
5. 作業後に `verify` と画面確認まで行ける見込みを持つ

## 完了条件

### Coverage/Freshness の完了条件

- `data/` を正として必要ファイルが揃っている
- `node scripts/sync-site-data.mjs --slug <slug> --build-capabilities --verify` で `site/data/` に同期されている
- `data/municipalities.json` と `site/data/municipalities.json` が一致している
- `node scripts/verify-municipality.mjs <slug>` が通る
- UI変更や導線変更を含むなら `site` を開いて確認している

### Discoverability の完了条件

- metadata / title / description / internal link のどこを改善したか明確
- 1ページだけでなく入口導線として機能している
- dev サーバーで見た目や文言を確認している
- 利用者に知らせる価値があるなら `site/data/news.json` も更新する

### Automation の完了条件

- 手順書だけでなく、実際にコマンドやスクリプトとして再利用できる
- 少なくとも1回は自分でそのコマンドを通している
- 対象範囲が明記されている

## AIへの依頼テンプレート

### 自治体追加

```text
{slug} に minutes を追加して。既存パターンを流用し、data/ を正にして、
segments 生成、site/data 同期、verify、画面確認まで進めて。
```

### 導線改善

```text
{ページ} の導線を改善して。検索意図を1つに絞って、実装、metadata 更新、
画面確認までやって。頼んでいないリファクタはしないで。
```

### 自動化

```text
{手作業} を2回以上やっているので自動化したい。
既存スクリプトを読んで、一気通しコマンドか検証スクリプトにまとめて。
```

### 既存議事録の更新

```text
新しい議事録が増えていそうなので、refresh-minutes で対象自治体を再取得して。
必要なら segments と verify まで進めて、公開状態が変わる自治体だけ metadata 更新候補を残して。
```

## セッション終了時の最小チェック

- `docs/operations-board.md` の状態を更新したか
- `coverage` に反映が必要なら更新したか
- 利用者向け更新なら `site/data/news.json` を更新したか
- 途中で止めたなら `次に何をすれば再開できるか` を1行残したか

## 避けること

- 気分で大規模リファクタを始める
- 1自治体分の作業に見えて、全体設計を勝手にいじる
- UI確認なしで「たぶん大丈夫」で終える
- `coverage` と `operations-board` を両方放置して記憶で回す

## 実務上のコツ

- `Coverage` と `Automation` を交互に回すと詰まりにくい
- 迷ったら、まず1自治体だけ増やす
- 迷ったら、`議事録があるのに見つけにくい` ページを直す
- 同じ説明を3回したら、それは README か docs に移す
