---
name: 地方議会ドットコムγ
version: gamma
description: 北海道の市町村議会情報を横断閲覧する非公式サイトのデザイン仕様書
colors:
  primary: "#1B3A6B"        # ヘッダー・フッター背景、濃紺アクセント
  primary-mid: "#2A5298"     # リンク・バッジ文字・ボタンhover
  primary-light: "#E8EEF7"   # バッジ背景・ホバー面
  accent-gold: "#F7C948"     # 北海道ゴールド、γバッジ、ヘッダー上部ライン
  warn-bg: "#FFF7E6"         # AI注意喚起・γバナー背景
  warn-fg: "#78451F"         # AI注意・警告の文字
  success-bg: "#065F46"      # Toast 成功
  background: "#F4F6F9"
  foreground: "#1A202C"
  foreground-muted: "#4A5568"
  foreground-subtle: "#718096"
  border: "#CBD5E0"
  border-light: "#E2E8F0"
  muted: "#A0AEC0"
typography:
  fontFamily: "var(--font-noto-sans-jp), Hiragino Sans, sans-serif"
  fontFeature: "palt 1, kern 1"
  display:  { fontSize: 24px, fontWeight: 700, lineHeight: 1.3 }
  headline: { fontSize: 20px, fontWeight: 700, lineHeight: 1.3 }
  title:    { fontSize: 18px, fontWeight: 700, lineHeight: 1.4 }
  body:     { fontSize: 16px, fontWeight: 400, lineHeight: 1.75 }
  label:    { fontSize: 14px, fontWeight: 400, lineHeight: 1.5 }
  caption:  { fontSize: 12px, fontWeight: 500, lineHeight: 1.4 }
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
rounded:
  sm: 0.25rem
  md: 0.5rem
  lg: 0.75rem
  full: 9999px
---

# 地方議会ドットコム — DESIGN.md

AIエージェントがこのリポジトリを編集する際に参照するデザイン仕様書。
新しいページ・コンポーネントを追加するときは、必ずここに定義されたトークンとパターンを使うこと。
上部 YAML はトークンの機械可読サマリ（google-labs-code/design.md の spec 準拠）。本文は **なぜ** そうしたかを説明する。

---

## プロジェクト概要

- **サービス名**: 地方議会ドットコムγ
- **本番ドメイン**: `chihougikai.com`
- **目的**: 北海道内市町村議会の情報（議員・議事録・議決・日程）を横断的に公開する市民向け情報サイト
- **収録範囲**: 北海道179市町村 + 北海道議会 = 180自治体。うち機能を完全に提供しているのは千歳・恵庭・苫小牧の3市（議員・議事録・議決・議会だより・行事予定）。残り自治体は議事録中心に順次拡充中
- **運営**: 株式会社オガワヤ（代表: 小川陽平 / 千歳市議会議員）
- **技術スタック**: Next.js 16 App Router (Turbopack) + Tailwind CSS v4 + TypeScript
- **フォント**: `next/font/google` で Noto Sans JP をビルド時配信（CSP `font-src 'self'` のまま動く）
- **デプロイ**: Vercel（rootDirectory: `site/`、データは `site/data/{city}/` に配置）
- **コンセプト**: **公共性・信頼感・親しみやすさ** — 行政情報サイトとして全年齢に信頼されるデザイン。「AIっぽい汎用デザイン」を避け、北海道の公共情報サイトとしての固有性を持たせる。ただしガチガチの堅さではなく、市民が読みやすい柔らかめのコピーライティングを採用。

---

## カラーパレット

CSS変数は `site/src/app/globals.css` で定義。Tailwindクラスでは直接16進数を指定する。

| 変数 | 値 | 用途 |
|---|---|---|
| `--color-primary` | `#1B3A6B` | ヘッダー・フッター背景、濃紺アクセント |
| `--color-primary-mid` | `#2A5298` | リンク・ナビアクティブ・バッジ文字 |
| `--color-primary-light` | `#E8EEF7` | バッジ背景・ホバー背景 |
| `--background` | `#F4F6F9` | ページ背景 |
| `--foreground` | `#1A202C` | 本文テキスト（コントラスト比 ≥ 7:1） |
| `--foreground-muted` | `#4A5568` | 補助テキスト・ラベル |
| `--foreground-subtle` | `#718096` | 注釈・メタ情報（16px未満では使わない） |
| `--border` | `#CBD5E0` | カード外枠・セクション区切り |

### 追加カラー（変数なし、直接指定）

| 値 | 用途 |
|---|---|
| `#E2E8F0` | カード内の薄い区切り線・内側ボーダー |
| `#F7C948` | ヘッダー上部アクセントライン・γ バッジ背景・注意喚起の縁（北海道ゴールド） |
| `#A0AEC0` | 空欄・無効のダッシュ（―） |
| `#FFF7E6` | **AI要約注意・γ版バナーの背景**（warn-bg） |
| `#78451F` | 同上の本文（warn-fg） |
| `#065F46` | Toast 成功の背景（コピー完了通知など） |

### 会派カラー（OG画像・バッジ）

`og-segment` / `og-member` の `factionColors()` で会派名を正規表現マッチして使用。

| 会派グループ | bar/chipFg/chipBg |
|---|---|
| 自民・自由民主 | `#B45309` / `#92400E` / `#FEF3C7` |
| 公明 | `#0369A1` / `#075985` / `#E0F2FE` |
| 共産 | `#B91C1C` / `#991B1B` / `#FEE2E2` |
| 立憲・民主系（春風含む） | `#0E7490` / `#155E75` / `#CFFAFE` |
| 維新 | `#6D28D9` / `#5B21B6` / `#EDE9FE` |
| ちとせ未来・市民と歩・会派市民・改革フォーラム | `#047857` / `#065F46` / `#D1FAE5` |
| 参政 | `#7E22CE` / `#6B21A8` / `#F3E8FF` |
| 国民民主 | `#CA8A04` / `#A16207` / `#FEF9C3` |
| 新緑 | `#65A30D` / `#4D7C0F` / `#ECFCCB` |
| 諸派・無所属 | `#52525B` / `#3F3F46` / `#F4F4F5` |

**重要**: 会派カラーの新設・変更は `og-segment/route.tsx` と `og-member/route.tsx` の両方で同期すること。

### 会派バッジカラー（`MemberList.tsx` の `factionBadgeClass` 参照）

```
自民・保守系 → bg-blue-50   text-blue-800
公明         → bg-yellow-50 text-yellow-800
立憲・民主系 → bg-green-50  text-green-800
共産         → bg-red-50    text-red-800
維新         → bg-orange-50 text-orange-800
無所属・その他 → bg-gray-100 text-gray-700
```

---

## タイポグラフィ

```css
/* globals.css で一括指定 */
font-family: var(--font-noto-sans-jp), "Hiragino Sans", "Hiragino Kaku Gothic ProN",
             "Yu Gothic UI", sans-serif;
font-feature-settings: "palt" 1, "kern" 1;  /* 和文の詰め */
letter-spacing: 0.01em;
line-height: 1.75;   /* body */
line-height: 1.3;    /* h1–h4 */
```

Noto Sans JP は `next/font/google` で build 時ダウンロード→同一オリジンから配信。CSP の `font-src 'self'` のまま動く。失敗時は Hiragino にフォールバック。

| 要素 | Tailwindクラス | サイズ |
|---|---|---|
| サイト名 H1 | `text-2xl font-bold` | 24px |
| セクション見出し H2 | `text-xl font-bold text-[#1B3A6B]` | 20px |
| カード見出し（議員名・会議名） | `text-lg font-bold text-[#1A202C] leading-snug` | 18px |
| 本文 | `text-base text-[#4A5568] leading-relaxed` | 16px |
| ラベル・補助テキスト | `text-sm text-[#718096]` | 14px |
| バッジ・タグ・ふりがな | `text-xs` | 12px |

**ルール**: `text-xs`（12px）以下はバッジ・タグ・ふりがなのみ。説明文・本文への使用禁止。
数値（件数・議席番号・年度・日付）は `tabular-nums` を付けて桁揃え。

---

## スペーシング・レイアウト

| 項目 | 値 |
|---|---|
| コンテンツ最大幅（一覧・トップ） | `max-w-5xl mx-auto` |
| コンテンツ最大幅（詳細ページ） | `max-w-2xl mx-auto` |
| ページ余白 | `px-4 py-8` |
| カード内余白 | `p-5` または `p-6` |
| セクション間隔 | `mb-6` / `gap-4` 〜 `gap-6` |
| 議員グリッド | `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4` |

---

## コンポーネントパターン（コピペ可）

### カード（議員・議事録・議決）

```html
<div class="bg-white rounded-lg border border-[#CBD5E0] hover:border-[#1B3A6B]
            shadow-sm hover:shadow-md transition-all duration-150 overflow-hidden">
  <div class="p-5">
    <!-- コンテンツ -->
  </div>
</div>
```

### バッジ（議席番号・分類ラベル）

```html
<!-- 議席番号 -->
<span class="text-xs font-medium text-[#2A5298] bg-[#E8EEF7] rounded px-2 py-0.5">
  3番
</span>

<!-- カテゴリ（定例会・委員会など） -->
<span class="text-xs font-semibold px-2 py-0.5 bg-[#E8EEF7] text-[#2A5298] rounded">
  定例会
</span>
```

### タグ（委員会・トピック）

```html
<!-- 四角タグ（委員会） -->
<span class="text-xs text-[#4A5568] bg-[#F4F6F9] border border-[#E2E8F0] rounded px-2 py-0.5">
  総務常任委員会
</span>

<!-- 丸タグ（トピック・関心テーマ） -->
<span class="text-xs px-2 py-0.5 bg-[#F4F6F9] text-[#4A5568] border border-[#E2E8F0] rounded-full">
  子育て
</span>
```

### 定義リスト行（議員詳細・プロフィール）

```html
<div class="flex gap-3">
  <dt class="text-xs font-medium text-[#718096] w-12 shrink-0 pt-0.5">会派</dt>
  <dd class="text-sm text-[#1A202C]">○○会</dd>
</div>
```

ラベル幅: `w-10`（政党）/ `w-12`（会派・委員会・得票数）

### パンくずナビ

```html
<nav class="text-sm text-[#718096] mb-5 flex items-center gap-1.5">
  <a href="/{city}" class="hover:text-[#1B3A6B] transition-colors">議員一覧</a>
  <span aria-hidden="true">›</span>
  <span class="text-[#1A202C]">議員名</span>
</nav>
```

### 空状態（データなし）

```html
<div class="bg-white rounded-lg border border-[#CBD5E0] p-8 text-center text-[#718096]">
  現在、掲載されている議事録はありません。
</div>
```

### 展開ボタン（アコーディオン）

```html
<button class="w-full flex items-center justify-between px-5 py-2.5
               bg-[#F4F6F9] border-t border-[#E2E8F0] text-sm text-[#4A5568]
               hover:bg-[#E8EEF7] hover:text-[#1B3A6B] transition-colors">
  <span class="text-xs font-medium">詳細を見る</span>
  <svg class="w-4 h-4 transition-transform"><!-- chevron --></svg>
</button>
```

### ナビゲーションタブ（CityHeader形式）

アクティブ状態は背景色変更ではなく**下線**で表現する。

```html
<!-- アクティブ -->
<a class="text-sm px-3 py-2 border-b-2 border-[#F7C948] text-white font-semibold">議事録</a>
<!-- 非アクティブ -->
<a class="text-sm px-3 py-2 border-b-2 border-transparent text-blue-100
          hover:text-white hover:border-blue-300 transition-colors">行事予定</a>
```

---

## 状態とインタラクション

### ホバー・フォーカス・アクティブの原則

- **ホバー**: `transition-colors`（150ms）で色を濃い方へ。浮き上がり（`translate`）は使わない
- **フォーカス**: `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2A5298]` を必ず付ける
- **アクティブ（選択中）**: 背景反転（例: `bg-[#1B3A6B] text-white`）または下線
- **無効**: `disabled:opacity-40 disabled:cursor-not-allowed`

### リンク・ボタンの状態マトリクス

| 種別 | 通常 | ホバー | フォーカス | 押下/選択 |
|---|---|---|---|---|
| プライマリボタン | `bg-[#1B3A6B] text-white` | `hover:bg-[#2A5298]` | ring-[#2A5298] | - |
| 枠線ボタン | `bg-white text-[#1B3A6B] border-[#CBD5E0]` | `hover:border-[#1B3A6B] hover:bg-[#E8EEF7]` | ring-[#2A5298] | - |
| 小型リンクボタン | `text-xs text-[#718096]` | `hover:text-[#1B3A6B] hover:bg-[#E8EEF7]` | ring-[#2A5298] | - |
| pillフィルタ | `bg-white text-[#4A5568] border-[#CBD5E0]` | `hover:border-[#1B3A6B]` | ring-[#2A5298] | `bg-[#1B3A6B] text-white`（主要）または `bg-[#2A5298] text-white`（副次） |

### アニメーション

過剰演出しない。許可する範囲：

- `transition-colors duration-150`（色変化）
- `transition-all duration-150`（軽微な shadow/border の同時変化のみ）
- `animate-pulse`（スケルトンローディング）
- `animate-bounce`（入力待ちの3点）
- Toast のスライドイン: `translate-y-2 → 0` + `opacity-0 → 100`（200ms）

禁止: `translate-y-2` 以上の浮き上がり、派手な bounce/spin、`@keyframes` 自作。

---

## 近代UI規約（2026-04 以降の運用）

### γ版公開バナー

ヘッダー直下に常設。全ページで表示する。

```html
<div class="bg-[#FFF7E6] border-b border-[#F7C948]">
  <div class="max-w-5xl mx-auto px-4 py-2 text-xs text-[#78451F] flex flex-wrap items-center justify-center gap-x-3">
    <span class="font-bold bg-[#F7C948] text-[#1B3A6B] rounded px-1.5 py-0.5">γ</span>
    <span>γ版公開中 — 機能追加・仕様変更があります</span>
    <a href="/news" class="underline hover:text-[#1B3A6B]">更新情報</a>
    <a href="mailto:ogawayohei.hkd@gmail.com" class="underline">ご意見はこちら</a>
  </div>
</div>
```

### AI要約の注意書き（`AIDisclaimer`）

AIが自動生成したコンテンツ（要約・タグ・Q&A抽出）を表示するページの**上部に常設**する。

- 対象: `/[city]/sessions/[id]`, `/topics/[tag]`
- 背景 `#FFF7E6`、縁 `#F7C948`、本文 `#78451F`
- 「原文で確認を」と訂正依頼窓口（利用規約第4条）を明示
- 発言者本人からの訂正依頼は**1営業日以内の初動・3営業日以内の対応**を約束（terms 第4条）

### Toast 通知

`ToastProvider` + `useToast().show("message")` で呼び出す。

- 位置: `fixed bottom-4 left-1/2 -translate-x-1/2 z-50`
- 成功: `bg-[#065F46] text-white`
- 情報: `bg-[#1B3A6B] text-white`
- 自動消去 2.5秒

**原則**: コピー・保存など確定操作のフィードバックは Toast に統一する。インラインで「コピー済」を1.8秒表示する旧UIは廃止。

### シェア導線

- 議員ページ・発言カード・議事録発言行にリンクコピー・引用コピー・Xシェア・QRコードの4アクション
- URL は **発言単位** で `/s/{city}/{session}/{seg}` 短縮ルート経由。SNSで発言ごとのOGカードが出る
- QRコードは `QRCodeModal` で表示、SVGダウンロード可能

### OG画像

- `/api/og-segment?city=&session=&seg=` — 発言カード（会派カラー縦バー + 議員写真 + トピック）
- `/api/og-member?city=&seat=` — 議員名刺（写真・会派chip・質問活動回数・テーマ上位4）
- サイズは 1200×630、`next/og` の ImageResponse（sharp 依存）

### ダッシュボード数字

トップページの規模ダッシュボード（対象自治体・議員・会議録・議題）は `lib/siteStats.ts` がビルド時に集計する。数字は `tabular-nums` で揃え、ラベルは `text-[11px] text-[#718096]` の小さめに。

---

## ページ構成

### 都市別ルート

各都市（`chitose` / `eniwa` / `tomakomai`）は以下のルートを持つ。

```
/{city}                議員一覧（MemberList コンポーネント）
/{city}/minutes        議事録一覧（MinutesIndexClient）
/{city}/minutes/[id]   議事録詳細（MinutesDetailClient）
/{city}/members/[id]   議員詳細
/{city}/decisions      議決結果
/{city}/schedule       行事予定
/{city}/newsletter     議会だより
```

新都市を追加するときは `site/src/components/CityHeader.tsx` の `CITY_CONFIG` に追加する。

### 詳細ページの標準構造

```
<div class="max-w-2xl mx-auto">
  パンくずナビ
  <section class="mb-6">  ← 見出し・メタ情報（バッジ・統計）
  <section>               ← メインコンテンツ（カード）
```

---

## データ構造

### Member

```typescript
{
  seat_number: number;
  name: string;
  furigana: string;
  party?: string;
  faction?: string;
  committees: string[];
  votes?: number;
  photo_url?: string;  // "/members/{city}/seat_N.jpg"（public/ 相対パス）
}
```

### MinutesIndexItem

```typescript
{
  council_id: number;
  name: string;        // "令和 ７年  第４回 定例会"
  year: string;
  japanese_year: string;
  type_label: string;  // "全会議 > 本会議 > 定例会"
  file: string;        // "{council_id}.json"
}
```

### MinutesEnriched（AI生成、`enriched/{council_id}.json`）

```typescript
{
  council_id: number;
  summary: string;       // 200字程度の市民向け要約
  highlights: string[];  // 主要審議事項 3〜5点
  tags: string[];        // テーマタグ 10〜15個
  speakers: { name: string; role: string; speech_count: number }[];
  questioners: { name: string; topics: string[]; ai_topics?: string[] }[];
}
```

enrichedデータが存在しない場合は `null` にフォールバックし、要約・タグなしで表示する。

---

## サーバーコンポーネントでのデータ読み込み

```typescript
function getData(): T[] {
  const fp = path.join(process.cwd(), "data", "{city}", "{file}.json");
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as T[];
  } catch {
    return [];  // ファイルなしは空配列でフォールバック（エラーページにしない）
  }
}
```

`process.cwd()` はビルド時・ランタイム両方で `site/` を指す。

---

## アイコン

外部ライブラリを使わず**インラインSVGのみ**使用（バンドルサイズ削減のため）。

```html
<!-- カレンダー -->
<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-[#2A5298]"
     viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
  <line x1="16" y1="2" x2="16" y2="6"/>
  <line x1="8" y1="2" x2="8" y2="6"/>
  <line x1="3" y1="10" x2="21" y2="10"/>
</svg>

<!-- 吹き出し（発言数） -->
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
</svg>

<!-- シェブロン右（リスト矢印） -->
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <polyline points="9 18 15 12 9 6"/>
</svg>
```

サイズ: `w-4 h-4`（本文中）/ `w-5 h-5`（カードアクション）
色: `text-[#2A5298]`（強調）/ `text-[#CBD5E0]`（控えめ、ホバーで `text-[#1B3A6B]`）
装飾目的のアイコンには必ず `aria-hidden="true"` を付ける。

---

## アクセシビリティ

- コントラスト比: 本文 ≥ 7:1、UIテキスト ≥ 4.5:1
- フォーカスリング: `focus-visible:ring-2 focus-visible:ring-[#2A5298]`
- タッチターゲット: 最小 44×44px
- ナビのアクティブ状態: `aria-current="page"`
- フォーム要素にはラベルを必ず隣接させる

---

## 避けるべきこと

| NG | 理由 |
|---|---|
| 赤・緑・青・黄を並べたカラフルなバッジ | 公共サイトとしての信頼感を損なう |
| `text-xs` 以下を本文・説明に使う | 可読性・アクセシビリティ違反 |
| 白背景に `#718096` を本文テキストに使う | コントラスト不足 |
| `hover:-translate-y-2` 以上の浮き上がり | 過剰演出 |
| グラデーション背景・派手なシャドウ | 行政サイトらしさを損なう |
| 外部アイコンライブラリのimport | バンドルサイズ増加。インラインSVGを使うこと |
| `outputFileTracingIncludes` に `"/**"` を使う | Next.js 16ではAPIルートを個別に指定すること |
| `outputFileTracingExcludes` のキーに `[city]` などブラケット名を直書き | picomatch がキャラクタクラスとして解釈するため。動的ルートをターゲットにする時は `/**/themes` のようにワイルドカードを使う |
| 「市議会」単独表記（全自治体に言及する文脈で） | 町村議会も含むため「市町村議会」と表記する |
| 「千歳・恵庭・苫小牧」の3市ハードコード | 180自治体対応のデータは `municipalities.json` から引く |
| インラインで「コピー済」を1.8秒だけ表示するコピーフィードバック | Toast に統一する |
| AI要約を載せるページに `AIDisclaimer` を置かない | 法的リスク低減と訂正依頼動線のため必須 |
