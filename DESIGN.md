# 地方議会ドットコム — DESIGN.md

AIエージェントがこのリポジトリを編集する際に参照するデザイン仕様書。
新しいページ・コンポーネントを追加するときは、必ずここに定義されたトークンとパターンを使うこと。

---

## プロジェクト概要

- **サービス名**: 地方議会ドットコム
- **目的**: 北海道内市町村議会の情報（議員・議事録・議決・日程）を横断的に公開する市民向け情報サイト
- **対象都市**: 千歳市 / 恵庭市 / 苫小牧市（順次追加予定）
- **技術スタック**: Next.js 16 App Router + Tailwind CSS v4 + TypeScript
- **デプロイ**: Vercel（rootDirectory: `site/`、データは `site/data/{city}/` に配置）
- **コンセプト**: **公共性・信頼感・見やすさ** — 行政情報サイトとして全年齢に信頼されるデザイン。「AIっぽい汎用デザイン」を避け、北海道の公共情報サイトとしての固有性を持たせる。

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
| `#F7C948` | ヘッダー上部アクセントライン（北海道ゴールド） |
| `#A0AEC0` | 空欄・無効のダッシュ（―） |

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
font-family: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic UI", sans-serif;
line-height: 1.7;   /* body（globals.css） */
line-height: 1.3;   /* h1–h4（globals.css） */
```

| 要素 | Tailwindクラス | サイズ |
|---|---|---|
| サイト名 H1 | `text-2xl font-bold` | 24px |
| セクション見出し H2 | `text-xl font-bold text-[#1B3A6B]` | 20px |
| カード見出し（議員名・会議名） | `text-lg font-bold text-[#1A202C] leading-snug` | 18px |
| 本文 | `text-base text-[#4A5568] leading-relaxed` | 16px |
| ラベル・補助テキスト | `text-sm text-[#718096]` | 14px |
| バッジ・タグ・ふりがな | `text-xs` | 12px |

**ルール**: `text-xs`（12px）以下はバッジ・タグ・ふりがなのみ。説明文・本文への使用禁止。

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
