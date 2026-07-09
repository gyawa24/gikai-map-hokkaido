# 横断検索 UX 改善 — Codex 依頼チケット集

最終更新: 2026-07-07

/search(横断検索)の実機レビュー(デスクトップ + 375px モバイル、`npm run dev` 実測)で確認した問題を、
**1チケット = 1依頼**として Codex にそのまま貼れる形にまとめたもの。
各チケットは自己完結しており、この会話やレビューの文脈なしで実行できる。

## 使い方

2通りある。どちらでも各チケット本文が仕様の正となる。

- **A. 1件ずつ**: `---` 区切りの「T1」〜「T9」の本文を、1つずつ Codex に貼る。並行して走らせる場合、SearchClient.tsx を触る T2〜T7 は衝突するので直列にする。
- **B. 一括実行**: 下の「一括実行用マスタープロンプト」をそのまま Codex に貼る。Codex がこのファイルを読んで T1→T9 を順に実施する。**Codex クラウド(GitHub 連携)で使う場合は、このファイルを先にコミット&プッシュしておくこと**(クラウドはリポジトリを clone するため、未プッシュのファイルは見えない)。ローカルの Codex CLI / IDE ならそのままでよい。
- 行番号は 2026-07-07 時点の目安。ずれている場合はコード片・関数名で探す。
- 1件ずつ方式のとき、**T7 は必ず単独で、他の検索チケットがマージされた後に**実施する(一括実行では順序どおりなら同一ブランチ内でよい)。

## 一括実行用マスタープロンプト(これを Codex に貼る)

```text
# 依頼: 横断検索UX改善チケット T1〜T9 の一括実施

このリポジトリの docs/search-ux-codex-tickets.md に、自己完結の改善チケット T1〜T9 が定義されている。
まず同ファイルの全文と、AGENTS.md(=CLAUDE.md)・DESIGN.md・site/AGENTS.md を読むこと。
(同ファイルがリポジトリに存在しない場合は、この依頼文の後ろに貼られたチケット本文を正として使う)
その上で、以下の実行規則に従い T1→T2→T3→T4→T5→T6→T7→T8→T9 の順に実施する。
各チケット本文(背景・変更対象・受け入れ条件)が仕様の正であり、この依頼文はその実行手順である。

## 実行規則

1. 順番厳守・直列実行。次のチケットに進む前に、現在のチケットの受け入れ条件を満たすこと。
2. 1チケット = 1コミット。メッセージは「T1: 議員検索結果を議員詳細ページへリンク」の形式。
   チケット外の変更(整形・ついでのリファクタ)を混ぜない。news.json への追記(チケット内に
   コマンドあり)は同じコミットに含める。
3. 各チケット完了時の共通ゲート:
   - cd site && node scripts/check-search-quality.mjs が全ケース PASS
   - cd site && npm run dev が起動し、該当画面が機能する(狭幅375px相当も確認)
   - 型エラーが出ていない
4. 本番の横断検索はクライアント検索経路で動く。クライアント経路の検証は
   GIKAI_SEARCH_MODE=client npm run dev で行える(/api/search がクライアント検索を指示する)。
   T1・T8 の検証で cf:preview が環境的に使えない場合はこれで代替し、その旨を最終報告に書く。
5. ブラウザでの実画面確認が環境的に不可能な場合は、curl や生成物の検証で代替し、
   代替した項目を最終報告に明記する(「確認した」と偽らない)。
6. あるチケットが環境要因等で完了できない場合: そのチケットの変更は取り消して未実施とし、
   理由を記録して次のチケットへ進む。前のチケットが未実施でも後続は実施してよい
   (T7 だけは T2〜T6 のうち実施済みのものがコミットされた後に行う)。
7. T7 はリファクタ単体のコミットにする。見た目・検索仕様の変更を一切含めないこと。
8. T9 は調査のみ: docs/search-architecture-options.md の新規作成だけを行い、
   本体コード・package.json に変更を入れない。ネットワークが使えず調査不能なら未実施として報告。
9. 最終報告(PR説明 or 完了報告)には、チケットごとの表を載せる:
   | チケット | 実施/スキップ(理由) | 検証結果(数値目標があるものは実測値) |
   T8 は recent インデックスの gzip 後サイズの実測値を必ず記載する。
```

## 推奨順と依存関係

| 順 | チケット | 規模 | 依存 |
|---|---|---|---|
| 1 | T1 議員結果を議員詳細ページへリンク | 小 | なし |
| 2 | T2 サジェストチップ整理 | 小 | なし |
| 3 | T3 モバイルでタブ常時表示 | 小 | なし |
| 4 | T4 結果のページング | 中 | なし |
| 5 | T5 結果カード再設計(日付・スニペット・文字サイズ) | 中 | なし |
| 6 | T6 初期画面の簡素化 | 中 | T2 の後推奨 |
| 7 | T7 URL 単一真実源化リファクタ | 大 | **T2〜T6 マージ後に単独で** |
| 8 | T8 配信インデックスの軽量化(暫定) | 大 | T5 の後推奨 |
| 9 | T9 検索アーキテクチャ調査(実装なし) | 調査 | いつでも |

---

## T1: 横断検索の議員結果から議員詳細ページへ直接リンクする

### 背景

/search で議員名(例: 「小川陽平」)を検索すると議員カードが出るが、リンク先が `/{city}`(市トップページ)になっており、クリックした市民は市トップからもう一度議員を探し直すことになる。

議員詳細ページは `/{city}/members/{seat_number}` で存在し、`site/data/*/members.json` の全議員(180自治体・2,280名、2026-07-07時点)に `seat_number` が入っていることは確認済み。リンクできない原因は、検索インデックス生成時に `seat_number` を落としていること。

### 変更対象と内容

1. `site/scripts/build-search-index.mjs` の `buildMembers()`(133行付近)
   - members.json 由来のレコードに `seat_number` を追加する。
   - election.json フォールバック由来のレコード(members.json が無い自治体用の当選者リスト)は `seat_number: null` とする。
2. `site/src/app/api/search/route.ts` の members 走査部(`memberResults.push` している879行付近、現在 `href: \`/${city}\``)
   - `seat_number` が有限数なら `href: \`/${city}/members/${seat_number}\``、無ければ従来通り `/${city}`。
   - この route 内の RuntimeSearchIndex の member 型定義にも `seat_number?: number | null` を追加。
3. `site/src/components/SearchClient.tsx` の `IndexedMember` 型(145行付近)と `runClientSearch()` の members ループ(550行付近、現在 `href: \`/${city}\``)
   - 2 と同じ href 組み立てに変更。

**重要**: 本番(Cloudflare)ではクライアント検索(`runClientSearch`)が実行経路、開発ではサーバー検索(route.ts)が実行経路。**両方を必ず同じ挙動に変更する**こと。`MemberHit` 型は href を持つだけなので変更不要。

### 受け入れ条件

- `cd site && node scripts/build-search-index.mjs` 後、`site/public/generated/search-index.json` の members 各要素に `seat_number` が入っている(市別インデックス `search-indexes/*.json` も同様)。
- `cd site && npm run dev` で /search を開き「小川陽平」で検索 → 議員タブのカードのリンク先が `/chitose/members/{番号}` になり、クリックで議員詳細ページが開く。
- 「小川」(複数市でヒット)でも全議員カードが各自の詳細ページへリンクする。
- `cd site && node scripts/check-search-quality.mjs` が全ケース PASS のまま。
- 完了時: `node scripts/add-news-item.mjs --category 改善 --title "検索結果から議員ページへ直接移動できるようにしました" --body "横断検索の議員結果をタップすると、市町村トップではなく議員の詳細ページが開くようになりました。"`

### 共通ルール(必ず守る)

- このタスクに関係ないリファクタ・整形・「ついでの改善」をしない。
- 作業前に CLAUDE.md / DESIGN.md / site/AGENTS.md を読む。Next.js 16 の API は `node_modules/next/dist/docs/` で確認する。
- UI 変更は `cd site && npm run dev` で実画面確認(デスクトップと375px幅の両方)。
- コミット/PR の作成単位はこのチケットの変更のみとし、他の変更を混ぜない。

---

## T2: 検索サジェストチップの整理(押すと0件になる説明チップの廃止)

### 背景

/search の検索窓下のサジェストチップ(`site/src/components/SearchClient.tsx` の `SEARCH_SUGGESTIONS`、80行付近)に「議員名で検索」「議決結果」という**説明文/機能名**が混ざっている。チップはタップするとその文字列で全文検索が走る実装のため、「議員名で検索」をタップすると文字通り『「議員名で検索」の検索結果はありませんでした』と 0 件表示になる(実機確認済み)。初見の市民が最初に踏む罠になっている。

### 変更対象と内容

- `SEARCH_SUGGESTIONS` から「議員名で検索」「議決結果」を削除し、実在の政策テーマ語 2 個に置き換える。
  - 候補は `site/src/lib/searchSynonyms.ts` に辞書がある語から選ぶ: 例「空き家」「部活動」「ヒグマ」「バス」。
  - チップ総数は 6 個以内。
- 検索窓の placeholder(「…議員名で検索」)は説明文なのでそのまま残してよい。
- チップ以外(SEARCH_SHORTCUTS、AND/OR 等)はこのチケットでは触らない(別チケット T6 の範囲)。

### 受け入れ条件

- `cd site && npm run dev` で /search の**全チップを1つずつタップし、いずれも 1 件以上ヒットする**ことを確認する(0件チップを残さない)。
- `cd site && node scripts/check-search-quality.mjs` が全ケース PASS のまま。
- 完了時: `node scripts/add-news-item.mjs --category 修正 --title "検索のおすすめキーワードを整理しました" --body "タップしても結果が出ないキーワード例があったため、実際に議論のあるテーマに入れ替えました。"`

### 共通ルール(必ず守る)

- このタスクに関係ないリファクタ・整形・「ついでの改善」をしない。
- 作業前に CLAUDE.md / DESIGN.md / site/AGENTS.md を読む。
- UI 変更は `cd site && npm run dev` で実画面確認(デスクトップと375px幅の両方)。
- コミット/PR の作成単位はこのチケットの変更のみとし、他の変更を混ぜない。

---

## T3: モバイルで「議事録・議決結果/議員」タブを常時表示にする

### 背景

/search でキーワード検索すると、結果の上に「議事録・議決結果」「議員」の 2 タブが出る。しかし 375px 幅(スマホ)では、このタブが市町村・種別・年度・会派の絞り込みフィルタと同じ折りたたみラッパーに入っているため、**「絞り込みを開く」を押すまでタブ自体が見えない**(実機確認済み: 「除雪」検索でタブ行の高さ 0)。タブは絞り込みではなく結果カテゴリの主要な切り替えなので、常時表示すべき。

### 変更対象と内容

- `site/src/components/SearchClient.tsx` 1293行付近の折りたたみラッパー:
  ```tsx
  <div className={`${hasFilterBlocks && !filtersOpen ? "hidden sm:block" : "block"} space-y-4`}>
  ```
  この中に `{/* 市フィルタ */}` `{/* タブ */}` `{/* 種別フィルタ */}` `{/* 年度フィルタ */}` `{/* 会派フィルタ */}` が入っている。
- `{/* タブ */}` ブロック(`<div className="flex border-b ...">`)をラッパーの**外・上**に移動し、DOM順を「タブ → 折りたたみフィルタ群(市町村/種別/年度/会派) → 結果」にする。
- 各フィルタは引き続き折りたたみ対象のまま。レイアウト崩れ(space-y の隙間)に注意。

### 受け入れ条件

- 375px 幅で「除雪」を検索 → 「絞り込みを開く」を押さなくてもタブ(件数バッジ付き)が見える。タブ切り替えが機能する。
- 「絞り込みを開く/閉じる」でフィルタ群の開閉が従来通り動く。
- デスクトップ幅(1280px)では見た目・動作が実質変わらない(タブ位置が市町村フィルタの上になる変化は許容)。
- 完了時: `node scripts/add-news-item.mjs --category 修正 --title "スマホの検索結果でタブが隠れる問題を直しました" --body "スマホで検索したとき、議事録と議員の切り替えタブが絞り込みを開くまで表示されない問題を修正しました。"`

### 共通ルール(必ず守る)

- このタスクに関係ないリファクタ・整形・「ついでの改善」をしない。
- 作業前に CLAUDE.md / DESIGN.md / site/AGENTS.md を読む。
- UI 変更は `cd site && npm run dev` で実画面確認(デスクトップと375px幅の両方)。
- コミット/PR の作成単位はこのチケットの変更のみとし、他の変更を混ぜない。

---

## T4: 検索結果のページング(「もっと見る」)を入れる

### 背景

/search は各カテゴリ最大 200 件(`maxResults = 200`)を**1ページに全件レンダリング**する(「除雪」で 200 カードの DOM 描画を実機確認)。スマホで重く、絞り込み UI は一覧の上にしかないため、下までスクロールした後に条件を変える手段がない。

### 変更対象と内容

`site/src/components/SearchClient.tsx` のみ。

1. sessions / members 各タブに表示件数 state を持たせ、**初期 30 件、「もっと見る(残りN件)」ボタンで +30 件ずつ**表示する。
   - query・タブ・各フィルタ・並び順の変更で表示件数を 30 にリセットする。
   - 市町村グルーピング表示(`groupByCity`)は**スライス後の配列**に対して行う(グループ数もスライスに追従してよい)。
2. 結果一覧の末尾(「もっと見る」の隣)に「検索条件に戻る」リンクを置き、クリックで結果ヘッダ(「◯◯」の検索結果)へスクロールする。
3. 200 件上限時の truncated 警告バナーは現状のまま残す。

### 受け入れ条件

- 「除雪」検索 → 初期表示が 30 件で、「もっと見る」を押すたびに増え、最後まで到達できる。
- フィルタや並び順を変えると 30 件に戻る。
- 「検索条件に戻る」で先頭へ戻れる(スマホ 375px で確認)。
- DOM 上のカード数が初期 30 前後であることを DevTools で確認。
- `cd site && node scripts/check-search-quality.mjs` が全ケース PASS のまま(表示件数の変更はマッチングに影響しないこと)。
- 完了時: `node scripts/add-news-item.mjs --category 改善 --title "検索結果の表示を軽くしました" --body "検索結果を30件ずつ表示する方式にし、スマホでも重くならないようにしました。"`

### 共通ルール(必ず守る)

- このタスクに関係ないリファクタ・整形・「ついでの改善」をしない。
- 作業前に CLAUDE.md / DESIGN.md / site/AGENTS.md を読む。
- UI 変更は `cd site && npm run dev` で実画面確認(デスクトップと375px幅の両方)。
- コミット/PR の作成単位はこのチケットの変更のみとし、他の変更を混ぜない。

---

## T5: 検索結果カードの再設計(日付表示・スニペット可読性・文字サイズ)

### 背景(すべて実機確認済み)

1. **スニペットが日本語として壊れて見える**: 質問テーマ(topics)を空白連結したテキストから機械的に切り出しているため、「これあくまでもコンサルというのは、経営統合に向けてシミュレ ーシ、町内の除雪対策について…」のような語の羅列になる。公共情報サイトでは「壊れて見える」ことが信頼を直接損なう。
2. **話者プレフィックスの重複**: 「高橋邦雄議員: （髙橋邦雄君） …」のように議員名が二重に出る。
3. **日付が出ない**: カードには会議名(令和7年◯回…)しかなく、何月何日の審議か分からない。議事録は日付が命。
4. **本文が12px**: スニペットが `text-[12px]`(1597行付近)。DESIGN.md の「text-xs(12px)以下はバッジ・タグ・ふりがなのみ。本文への使用禁止」に違反しており、高齢の市民に読みにくい。
5. **内部情報が目立つ**: カード右上の「ヒット: 質問テーマ」「ヒット: AI要約」等はデバッグ情報に近く、市民には不要。

### 変更対象と内容

1. `site/scripts/build-search-index.mjs`:
   - agenda エントリに `date`(`YYYY-MM-DD`)を追加する。schedule 名(例: `03月02日－01号`)から `/(\d{1,2})月(\d{1,2})日/` で月日を取り、council の `year` と合成する。取れない場合は `date` 無しでよい。
     - **注意**: 1〜3月開催の会議で年度表記と暦年がずれるケースを必ず確認する(例: 令和8年第1回定例会=2026年2〜3月 → year "2026" + "02月24日" = 2026-02-24 で正しいことを既存データで検証)。
   - memberActivities / enriched / decisions は今回は year のまま(変更しない)。
   - スニペット用テキストの build 時クリーニング: 「◯◯議員: （◯◯君）」のような**話者名の重複プレフィックス**を1つに正規化する。※発言内容の改変は禁止だが、CLAUDE.md により「冗長な定型句(重複話者プレフィックス等)の正規化は改変に含まれない」。
2. `site/src/app/api/search/route.ts` と `site/src/components/SearchClient.tsx`:
   - `SessionHit` に `date?: string` を追加し、agendas は上記 date、sessions は既存の `s.date` を流す。
   - カードに日付を「2026年2月24日」形式で表示(date が無ければ year のみ、それも無ければ非表示)。`tabular-nums` を付ける。
   - スニペット切り出し(`excerptSearchText`、`site/src/lib/searchQuery.ts`)を**文境界(。)優先**にする: ヒット位置を含む文の先頭から表示し、途中で切れる場合のみ「…」を付ける。
   - memberActivities 由来の context(質問テーマの列挙)は文章に見せず、「質問テーマ: 除雪、通学路、…」のように**読点区切りのテーマ列挙**として表示する。
   - スニペットの文字サイズを 15px 以上(`text-[15px]` または `text-sm`+行間調整)にする。カード見出し・ピルは現状維持。
   - 「ヒット: {field}」ピルを削除する(field 情報自体は内部的に残してよい)。種別ピル(公式議事録/会議録/議決結果)と市町村ピルは残す。
3. 議員名・発言テキストそのものの書き換えは**絶対にしない**(上記の重複プレフィックス正規化のみ可)。

### 受け入れ条件

- 「除雪」「小川」で検索し、カードに日付が表示され、スニペットが文として読める(語の羅列・二重話者名がない)ことをスクリーンショットで確認。
- 12px 以下の本文テキストが検索結果カードに残っていない。
- 1〜3月開催の会議のカードで日付の年がずれていない(実データで最低1件確認)。
- `cd site && node scripts/check-search-quality.mjs` が全ケース PASS。加えて `site/data/search_quality_cases.json` に「除雪」等で textIncludes を検証するケースを1件以上追加する。
- 完了時: `node scripts/add-news-item.mjs --category 改善 --title "検索結果を読みやすくしました" --body "検索結果に会議の日付を表示し、抜粋文を文の区切りで表示するようにしました。文字サイズも読みやすく調整しました。"`

### 共通ルール(必ず守る)

- このタスクに関係ないリファクタ・整形・「ついでの改善」をしない。差分が大きくなる場合は 1(ビルド側)と 2(表示側)を分割してよい。
- 作業前に CLAUDE.md / DESIGN.md / site/AGENTS.md を読む。DESIGN.md のカラー・タイポ規則に従う。
- UI 変更は `cd site && npm run dev` で実画面確認(デスクトップと375px幅の両方)。
- コミット/PR の作成単位はこのチケットの変更のみとし、他の変更を混ぜない。

---

## T6: 検索初期画面の簡素化(上級者向け条件を「詳しい条件」に畳む)

### 背景

/search の初期画面(検索前)に「検索窓+チップ7個+AND/OR トグル+ショートカット4個(議員を探す/議事録を探す/議決を探す/速報を探す)+説明文」が並び、スマホでは 2 画面分近くある。AND/OR は一般市民には意味が通らず、ショートカット 4 個はクエリ未入力時に押しても見た目上何も起きない(結果はクエリ入力後にしか表示されないため)。市民がやることは「言葉を入れて検索」だけにし、上級者向け条件は畳む。

### 変更対象と内容

`site/src/components/SearchClient.tsx` のみ。

1. **AND/OR トグル**(「複数語の条件」の行)と **SEARCH_SHORTCUTS**(4ボタン)を「詳しい条件」折りたたみに移す。
   - 既存の `site/src/components/Accordion.tsx`(title/defaultOpen/children の API)を再利用するか、同等の見た目で `aria-expanded` 付きトグルを実装する(DESIGN.md「展開ボタン(アコーディオン)」パターン準拠)。
   - 既定は閉。**URL に `op=or` が指定されているときは開いた状態**で初期化する(共有リンクで開いた人が状態を視認できるように)。
   - AND 既定・OR の動作仕様は一切変えない。
2. 検索窓下の説明文(「議題名、政策テーマ、施設名…AND/OR を切り替えて使えます。」)を 1 文に短縮し、AND/OR への言及は「詳しい条件」内に移す。
3. サジェストチップと「最近の検索」は現状の位置のまま。noscript フォーム(`site/src/app/search/page.tsx`)、label、focus-visible などのアクセシビリティを壊さない。

### 受け入れ条件

- 初期画面(クエリ未入力)の操作要素が「検索窓+検索ボタン+チップ+『詳しい条件』トグル(+最近の検索)」だけになっている。
- 「詳しい条件」を開くと AND/OR とショートカット 4 個が従来通り機能する。
- `/search?op=or` を直接開くと「詳しい条件」が開いた状態で OR が選択されている。
- 375px 幅で初期画面が概ね 1.5 画面以内に収まる。
- `cd site && node scripts/check-search-quality.mjs` が全ケース PASS のまま。
- 完了時: `node scripts/add-news-item.mjs --category 改善 --title "検索ページの入口をシンプルにしました" --body "検索ページの上級者向け設定を「詳しい条件」にまとめ、キーワードを入れて検索するだけで使える画面にしました。"`

### 共通ルール(必ず守る)

- このタスクに関係ないリファクタ・整形・「ついでの改善」をしない。
- 作業前に CLAUDE.md / DESIGN.md / site/AGENTS.md を読む。DESIGN.md のカラー・タイポ規則に従う。
- UI 変更は `cd site && npm run dev` で実画面確認(デスクトップと375px幅の両方)。
- コミット/PR の作成単位はこのチケットの変更のみとし、他の変更を混ぜない。

---

## T7: SearchClient の状態管理を「URL 単一真実源」にリファクタする(競合バグ修正)

**⚠ このチケットはリファクタ単体で実施し、他の変更を混ぜない。1件ずつ方式では T1〜T6 がマージされてから着手する。一括実行では T1〜T6(実施済み分)のコミット後に、独立したコミットとして行う。**

### 背景(実機で再現済みのバグ)

`site/src/components/SearchClient.tsx` は query/tab/city/source/year/faction/op/sessionSort/memberSort の 9 状態を useState で持ち、
(a) searchParams → state の同期 effect(734行付近)と
(b) state → `router.replace` の同期 effect(982行付近)
の**双方向同期**で URL と一致させている。この2つの effect が相互発火するため競合があり、実機で「クリア → 即再入力 → 検索」を行うと URL が `?tab=members` になり **q が消えて検索結果が空になる**現象を確認した。直近のコミット履歴でも同種の修正(prefetch overload / scoped index / normalization)が繰り返されており、構造自体が壊れやすい。

### 変更方針(設計指示)

1. **URL クエリパラメータを唯一の真実源にする。**
   - tab・city・cityName・source・year・faction・op・sessionSort・memberSort と確定済み q は、`useSearchParams()` から**導出**する(useState で複製しない)。
   - 変更操作(タブ切替・フィルタ選択・並び順・検索実行)は「新しい URLSearchParams を組み立てて `router.replace(…, { scroll: false })`」に一本化する。
   - ローカル state に残すのは**入力中テキスト(draftQuery)と UI 一時状態(filtersOpen、recentQueries、検索結果・loading・error)だけ**。
2. 検索実行 effect の依存は searchParams 由来の値に揃え、220ms デバウンスと AbortController・requestId ガードは維持する。
3. 「親フィルタが変わると子フィルタの選択肢から外れる」ケースの整合(現在の availableSources/Years/Factions リセット effect 群)は、**URL を書き換える側で正規化**する(無効になった子パラメータを replace 時に落とす)方式に置き換える。
4. 既存 URL パラメータの互換を維持する: `q, tab, city, cityName, source, year, faction, op, sessionSort, memberSort`。**過去に共有されたリンクが同じ画面を再現できること。**
5. `site/src/app/[city]/page.tsx` などから `/search?city=…&cityName=…` で遷移してくる市内検索導線、および `initialQuery/initialTab/initialSource` props の挙動を壊さない。

### 受け入れ条件

- 再現手順「キーワード検索 → クリア → 即座に別語を入力 → 検索」を10回繰り返しても q が消えない。
- フィルタ・タブ・並び順を操作 → ブラウザの戻る/進む → リロード、のすべてで URL と画面状態が一致する。
- `/search?q=除雪&city=chitose&cityName=千歳市&year=2025` 等の直リンクが従来と同じ絞り込み状態で開く。
- `cd site && node scripts/check-search-quality.mjs` が全ケース PASS(マッチングロジックは無変更のはず)。
- 375px・デスクトップ両方で一通りの操作を実機確認。
- 完了時: `node scripts/add-news-item.mjs --category 修正 --title "検索条件の操作を安定させました" --body "検索語を入れ直した直後に条件が消えることがあった問題を修正しました。"`

### 共通ルール(必ず守る)

- このリファクタの目的は挙動の安定化であり、**見た目・検索仕様の変更は一切含めない**。
- 作業前に CLAUDE.md / site/AGENTS.md を読む。Next.js 16 の router/useSearchParams の仕様は `node_modules/next/dist/docs/` で確認する。
- コミット/PR の作成単位はこのチケットの変更のみとし、他の変更を混ぜない。

---

## T8: 配信用検索インデックスの軽量化(暫定策)

### 背景

本番(Cloudflare)の横断検索は、`/api/search` が `clientSearchRequired` を返し、ブラウザが `/generated/search-index.json` を取得してクライアント側で全件走査する方式。このファイルが **24MB(gzip後約4.8MB)** あり(26自治体時点)、初回検索のダウンロードと毎回の `JSON.parse`+全件走査がスマホで重い。179自治体に広げると現方式は破綻する。恒久策は別チケット(T9)で調査中のため、本チケットは**運用を変えずに効く暫定策**のみ行う。

### 変更対象と内容(3点)

1. **検索時 CPU の削減**(`site/src/lib/searchQuery.ts`):
   - 現在、`groupMatchScore` が呼ばれるたびに対象テキストへ `normalizeForSearch`(NFKC+カナ変換+複数 regex)をかけ、さらに `matchesSearchText` と `scoreSearchText` が同じ評価を二重実行している。
   - `evaluateSearchText` の結果を使い回す形に呼び出し側(`route.ts` / `SearchClient.tsx` の collectResults)を整理し、テキスト正規化は検索 1 回の中でメモ化(`Map<string,string>`)する。**インデックスのスキーマは変えない**(正規化済み文字列を持たせるとサイズが増えるため)。
2. **既定の検索対象を直近に絞る**(`site/scripts/build-search-index.mjs` + 検索クライアント):
   - フル版 `search-index.json` に加えて、**直近2年分だけの `search-index-recent.json`** を生成する(agendas/sessions/memberActivities/enriched を year で絞る。members/municipalities/decisions は全量のまま)。
   - 既定の横断検索は recent を取得する。**年度フィルタで古い年を選んだとき・0件だったとき・「全期間を検索」を押したとき**にフル版を取得して再検索する(取得は既存の `clientSearchIndexPromises` と同様に URL 単位でメモ化)。
   - 結果ヘッダに検索対象範囲を明示する: 「検索対象: 直近2年(全期間を検索)」のような 1 行。
   - `/api/search` が返す `indexUrl` の分岐(`clientSearchIndexUrl`)にも recent を組み込む。市指定時の市別インデックス(`/generated/search-indexes/{city}.json`)は現状のまま。
3. **agendas の text の無駄削り**(`site/scripts/build-search-index.mjs`):
   - 連続空白・記号列・重複話者プレフィックスを build 時に除去し、400字抜粋の中身の密度を上げる(EXCERPT_MAX 自体は変えない)。

### 数値目標

- 既定(recent)検索の初回転送量: **gzip 後 1.5MB 以下**(現状 4.8MB)。`gzip -c site/public/generated/search-index-recent.json | wc -c` で計測して PR に記載する。

### 受け入れ条件

- `cd site && npm run build-search-index` で両インデックスが生成され、recent のサイズが目標内。
- dev(サーバー検索)と `npm run cf:preview`(本番相当・クライアント検索)の両方で: 「除雪」即ヒット、古い年度(例: 2021)を選ぶとフル版へ切り替わって結果が出る、0件語もフル版で再検索される。
- `cd site && node scripts/check-search-quality.mjs` が全ケース PASS(checker がフル版を読む場合はそのまま、recent を読む場合は対象期間に注意)。
- 検索対象範囲の表示が結果ヘッダに出る(375px でも崩れない)。
- 完了時: `node scripts/add-news-item.mjs --category 改善 --title "検索を速くしました" --body "横断検索が最初に読み込むデータを直近2年分に絞り、スマホでの初回検索を大幅に軽くしました。過去の議事録もワンタップで全期間検索できます。"`

### 共通ルール(必ず守る)

- このタスクに関係ないリファクタをしない。`next.config.ts` / `vercel.json` / `wrangler` 設定には触らない。
- 動的 `path.join(process.cwd(), …)` を書く場合は `/*turbopackIgnore: true*/` を必ず付ける(CLAUDE.md)。
- 作業前に CLAUDE.md / site/AGENTS.md を読む。
- コミット/PR の作成単位はこのチケットの変更のみとし、他の変更を混ぜない。

---

## T9(調査のみ・実装なし): 179自治体対応の検索アーキテクチャ選定

### 背景

横断検索のインデックスは 26 自治体で 24MB(クライアント全量ダウンロード方式)。北海道179市町村へ拡張すると単純比例で 150MB 級になり現方式は破綻する。恒久アーキテクチャを決めるための調査を行う。**このチケットでは本体コードを変更しない。**成果物は `docs/search-architecture-options.md`(新規)のみ。

### 調査する選択肢

- **(a) 静的シャード型インデックス**: Pagefind(NodeJS indexing API で JSON レコードを直接投入できるか、日本語/CJK の分かち書き精度)、または自作の bigram 転置インデックス分割(クエリに必要な断片だけ数十〜数百KB取得)。Cloudflare Static Assets だけで完結し、運用コンポーネントが増えないのが利点。
- **(b) Cloudflare D1(SQLite FTS5)によるサーバー検索**: D1 で FTS5 の trigram トークナイザが使えるかを**実際に小さな Worker で実証**する(日本語の部分一致に必須)。ビルドごとの同期方法、無料枠/想定コスト、レイテンシ。
- **(c) 現方式+T8軽量化の限界値**: recent 絞り+市別シャードで 179 自治体時に既定検索が何MBになるかの試算。

### 各案について必ず埋める評価表

| 観点 | 内容 |
|---|---|
| 初回検索の転送量(179自治体想定) | 実測または根拠ある試算 |
| 検索レイテンシ(スマホ) | 実測または試算 |
| ビルド時間・デプロイへの影響 | |
| 運用コンポーネントの追加 | 増えるなら何を誰が面倒みるか |
| 月額コスト概算 | 無料枠内か |
| 日本語対応の確度 | 実証コードの結果を貼る |
| 既存機能(ファセット/同義語/ハイライト)の移植性 | |

### 受け入れ条件

- `docs/search-architecture-options.md` に上記評価表+推奨案 1 つ+移行ステップ案(段階的に出せる粒度)が書かれている。
- 実証コード(D1 FTS5 の日本語検索、Pagefind の JSON 投入)は使い捨てで、リポジトリに残す場合は `docs/` 配下 or 別ブランチに隔離し、本体・依存関係(package.json)に変更を入れない。
- 結論は「継続できる環境・綺麗なデータ・更新スケジュール優先」(docs/operations-principles.md)の基準で書く。

---

## 参考: 今回のレビューで確認済みの現状値(2026-07-07)

- `site/public/generated/search-index.json`: 24MB(gzip 4.8MB)。内訳: agendas 22,785件(約8.8M文字)、memberActivities 7,842件、members 2,280件、市別インデックス181ファイル(最大 chitose 2.7MB)。
- 検索対象は議題本文の**先頭400字のみ**(`EXCERPT_MAX = 400`)。
- 全180自治体の members.json 全2,280名に `seat_number` あり。
- 品質チェック: `site/data/search_quality_cases.json` + `site/scripts/check-search-quality.mjs`(検索ロジック変更時は必ず PASS 維持+ケース追加)。
