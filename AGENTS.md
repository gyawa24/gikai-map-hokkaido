# 地方議会ドットコム — AGENTS.md

AIエージェント（Claude Code / Codex / Cursor 等）がこのリポジトリで作業するときの行動指針。
agents.md 標準に準拠。`CLAUDE.md` はこのファイルへのシンボリックリンク。
ここに書かれていない詳細は各サブドキュメントを参照する。

---

## プロジェクト一行要約

北海道内の全市町村議会情報（議員・議事録・議決・行事・議会だより）を横断閲覧できる**市民向け非公式情報サイト**。
作者は千歳市議会議員。議事録は **26 市町村 + 北海道議会**で運用中（うちフル機能は千歳・恵庭・苫小牧の 3 市）、**最終的には北海道179市町村すべてに拡張する**。

公開URL: https://chihougikai.com / リポジトリ: https://github.com/gyawa24/gikai-map-hokkaido

---

## 必読ドキュメント（作業前に確認）

| ファイル | 何が書いてある |
|---|---|
| `DESIGN.md` | カラー・タイポグラフィ・コンポーネントパターン。**UI を触るなら必読** |
| `site/AGENTS.md` | Next.js 16 固有の注意（学習データより新しい） |
| `node_modules/next/dist/docs/` | Next.js の正確なAPI仕様。**コード書く前に確認** |
| `README.md` | プロジェクト概要 |
| `docs/` | MCP API キー運用、リリースチェックリスト等 |

---

## 四つの基本原則（Karpathy準拠・日本語版）

### 1. 書く前に考える（Think Before Coding）

- 「このタスクは本当に今必要か」を最初に問う。
- 既存パターンを先に読む（`site/src/components/` と `DESIGN.md`）。車輪の再発明をしない。
- フル機能3市（千歳・恵庭・苫小牧）の既存実装をスキャンしてから新規実装に入る。

### 2. シンプル第一（Simplicity First）

- 新しい依存関係は慎重に。`package.json` を増やす前に既存の手段を検討する。
- 外部アイコンライブラリを入れない。インラインSVGで十分。
- 「抽象化は3回目に登場したとき」。2回目ではまだ早い。
- 1画面で済む機能に状態管理ライブラリを入れない。

### 3. 外科的な変更（Surgical Changes）

- **頼まれていないリファクタをしない**。バグ修正で周辺コードを掃除しない。
- ファイル全体を書き換える前に、その変更がタスクに本当に必要か問う。
- 既存の命名・スタイル規約に合わせる。自分の好みで書き直さない。
- `next.config.ts`・`tsconfig.json`・`vercel.json` を触るときは特に慎重に。デプロイを壊す。

### 4. ゴール駆動（Goal-Driven Execution）

- 成功基準を最初に言語化する（「千歳の議員一覧ページで議席番号順に表示される」など）。
- 実装後、成功基準を満たしたか自分で検証する。「動くはず」ではなく実際にブラウザで確認する。
- UIの変更は `npm run dev` で実際に画面を見てから完了報告する。型チェックが通ることと、機能が正しいことは別物。

---

## 全道179市町村展開を見据えた設計原則

このプロジェクトの特殊事情として、**すべての設計判断は「179市町村に拡張しても壊れないか」を基準に評価する**。

### データ層
- `data/{slug}/` 単位で分離する。市町村ごとのフォルダ構造は統一する。
- 市町村リストは `data/municipalities.json` を単一の真実源（single source of truth）とする。新しい市町村を足すときは必ずここを更新。
- `features: ["members", "minutes", ...]` の有無で機能出し分けをする設計を維持する。すべての市町村が全機能を持つとは限らない。
- **`data/{slug}/segments/`**: AI検索用にフラット化した発言単位データ。`scripts/build-segments.mjs <slug>` で minutes から生成。`_index.json`（軽量メタ）+ `{council_id}.json`（実体）の構成。
- **`site/data/news.json`**: トップ/`/news` の更新情報の単一の真実源。機能追加・改善・修正・自治体追加・重要なお知らせを行ったら、関連実装と同じ変更で必ず追記する。エージェントは更新作業の完了時に `site/data/news.json` への反映要否を確認し、該当するなら自動で追記する。

### UI層
- ハードコードで市町村名を書かない。`municipalities.json` または `[city]` 動的ルートから引く。
- 千歳・恵庭・苫小牧専用の機能分岐を書かない。3市に必要な機能は全市に必要、3市に不要な機能は全市に不要と考える。
- `CityHeader.tsx` の `CITY_CONFIG` を単一の真実源とする。
- ※build 最適化目的の優先度配列（`PRIORITY_CITIES_FOR_PRERENDER` 等、機能分岐でないもの）は例外として可。

### スクレイピング層
- 市町村ごとの議会サイトは HTML 構造がバラバラ。しかし**出力JSONのスキーマは統一**する（`DESIGN.md` のデータ構造参照）。
- 議会システム種別（`system: "dnp"` など）ごとに共通化できる部分は共通化する。179回同じコードを書かない。

### スケールの閾値
- 「3市で動けばOK」のコードは書かない。「179市で動くか？」を常に自問。
- ただし早すぎる抽象化も避ける（原則2）。**5市町村目を追加するときに1市目と同じ変更をN箇所に入れる羽目になったら、そこが抽象化すべきサイン**。

---

## ディレクトリ構成

```
<repo>/
├── site/                  Next.js フロントエンド（メイン作業場所）
│   ├── src/app/           ページ（[city]動的ルート + トップレベル機能）
│   ├── src/components/    共通コンポーネント
│   ├── src/lib/mcp/       MCP ツール定義（共通）
│   ├── data/              ビルド時に読む市町村データ（process.cwd()/data）
│   └── AGENTS.md          Next.js 16 固有の注意書き
├── mcp-server/            stdio 版 MCP サーバー（個人 Claude Code/Desktop 連携）
├── scraper/               市町村別スクレイピングスクリプト
├── data/                  収集生データ（site/data/ に同期される）
│   └── {slug}/
│       ├── minutes/       議事録 raw（{council_id}.json + index.json）
│       ├── segments/      AI 検索用フラット化データ
│       ├── members.json
│       └── ...
├── agents/                自動化パイプライン（orchestrator等）
├── scripts/               バッチスクリプト（build-segments.mjs 等）
├── docs/                  運用ドキュメント
└── DESIGN.md              UI 仕様書（必読）
```

ビルド時は `site/` がルートになる（Vercel `rootDirectory: site/`）。`process.cwd()` は `site/` を返す。

---

## ビルド・デプロイの掟

2026年5月時点で確立した前提。崩すと build 時間が 10min → 31min に逆戻りする。

### 静的生成
- `next.config.ts` の `experimental.cpus = 2`、`staticGenerationMaxConcurrency = 16` を維持（Vercel build 並列化）。
- 大量パスのルートは **ISR** にする: `dynamicParams = true` + `revalidate = 86400`。
- `generateStaticParams` は recent N（`/[city]/minutes/[id]`）/ priority cities（`/[city]/members/[id]`）/ top tags（`/topics/[tag]`）のみ。残りは ISR で動的レンダ。

### Vercel Pro 移行時の費用優先ルール
- 速度より安定した低コスト運用を優先する。Pro 移行直後は **Standard Build Machine を基本**とし、Turbo Build Machine は原則使わない。
- Vercel の Spend Management で月額上限を低めに設定してから本格運用する。上限設定なしで重いデプロイを連発しない。
- build 時間短縮は、まず「不要な Preview デプロイを減らす」「docs だけの変更はデプロイをスキップする」「静的生成対象を絞る」で対応する。高価なビルドマシンへの切り替えは最後の手段。
- 作業中はローカルで確認し、push はまとまった区切りで行う。ブランチを細かく push すると Preview デプロイが増え、Build Minutes を消費する。
- Pro/Enhanced/Turbo 等の料金・無料枠は変わり得るため、設定変更前に Vercel 公式 Pricing / Builds ドキュメントで現行条件を確認する。

### Function バンドル
- Vercel Function は 250MB 制限あり。`next.config.ts` の `outputFileTracingExcludes` で minutes 等のサイズの大きいデータを除外している。
- 古い minutes は ISR で **GitHub Raw URL**（`raw.githubusercontent.com/{owner}/{repo}/{branch}/site/data/{slug}/minutes/{id}.json`）から fetch して取得する。
- 動的 `path.join(process.cwd(), ...)` / `fs.readFileSync(fp, ...)` には **`/*turbopackIgnore: true*/`** を必ず付ける。Turbopack のファイルトレースが暴走して Function バンドルが肥大化する。

### MCP ツール配置
- 新規 MCP ツール: `site/src/lib/mcp/tools.mjs`（stdio + HTTP 共通）。
- stdio 専用ツール（個人利用のみ、HTTP 配布しないもの）: `if (segmentsDir)` のような optional オプションで隔離する。
- HTTP 配布版で出したくないツール（restricted データ依存）はパラメータ未渡しで無効化。

---

## やってはいけないこと

| NG | 理由 |
|---|---|
| 頼まれていない「ついでの改善」 | 差分が大きくなりレビュー不能になる |
| `DESIGN.md` のカラー・フォントルールを破る | 公共サイトとしての信頼感を損なう |
| 千歳専用・恵庭専用の機能ハードコード | 全道展開のときに全書き換えになる（※build最適化用の priority 配列は除く） |
| Next.js の古いAPI（Pages Router・`getServerSideProps` 等）を使う | Next.js 16 では挙動が違う。`node_modules/next/dist/docs/` で確認 |
| データ読み込みでエラーページに飛ばす | 空配列フォールバックが基本（議会未対応市でも画面が出るように） |
| コメントで「何をしているか」を説明する | コードを読めばわかる。**なぜ**そうしたかだけコメントに書く |
| 議員の氏名・発言の改変 | 公共情報の正確性が命。AI要約を付ける場合も原文リンクを必ず併記。※冗長な定型句（segment 内の重複話者プレフィックス等）の正規化は改変に含まない |
| `dynamicParams = false` に逆戻し | build 時間が 10min → 31min に逆戻り。ISR + GitHub Raw fallback の構成は維持する |
| 動的 `path.join` を `turbopackIgnore` 無しで書く | Function バンドル肥大化、ビルド警告 |
| 勝手にコミット・プッシュ | 明示的に頼まれたときだけ |

---

## 作業スタイル

- **日本語で応答する**。作者は日本語話者。
- 説明は簡潔に。冗長な前置き・末尾のまとめは不要。
- 不確実なときは憶測で実装せず、作者に確認する。
- UI に関わる変更は「どう見えるか」を言葉で説明するのではなく、実際に `npm run dev` で確認してから報告する。
- Vercel デプロイや外部API・GitHub 操作など不可逆な動作は事前確認する。
- 更新情報に値する変更を入れたら、`site/data/news.json` に同じコミット単位で追記する。追記時は既存形式に合わせ、必要なら `node scripts/add-news-item.mjs ...` を使う。

---

## 作者

小川陽平 / 千歳市議会議員（国民民主党） / GitHub: [@gyawa24](https://github.com/gyawa24)
