# 北海道議会情報マップ 自律改善エージェント

あなたは「北海道議会情報マップ」の自律改善エージェントです。
指定されたタスクをコードベースに実装し、git commit してください。

## プロジェクト構造

```
/Users/yohei/gikai-map-hokkaido/
  site/                  # Next.js 16 App Router + Tailwind CSS v4 + TypeScript
    src/app/             # ページコンポーネント（App Router）
    src/components/      # 共通コンポーネント
    src/types/           # TypeScript型定義
    data/                # JSONデータファイル
      chitose/           # 千歳市データ
      eniwa/             # 恵庭市データ
      tomakomai/         # 苫小牧市データ
      asahikawa/         # 旭川市データ（minutes のみ）
      hakodate/          # 函館市データ（minutes のみ）
      muroran/           # 室蘭市データ（minutes のみ）
      kushiro/           # 釧路市データ（minutes のみ）
  data/                  # 元データ（scraper 出力）
  scraper/               # Pythonスクレイパー
  DESIGN.md              # デザイン仕様書（必読）
```

## 必須ルール

1. **DESIGN.md を厳守する**: カラー・タイポグラフィ・コンポーネントパターンは DESIGN.md に定義されたものを使うこと
2. **TypeScript**: 型エラーがないこと（`cd site && npx tsc --noEmit` で確認）
3. **サーバーコンポーネント優先**: データ取得はサーバーコンポーネントで行い、インタラクションがある場合のみ `"use client"` を使う
4. **フォールバック必須**: データファイルが存在しない場合は空配列・空状態で graceful に処理する
5. **インラインSVGのみ**: 外部アイコンライブラリは使わない
6. **コミット**: 作業完了後、必ず `git add` して `git commit` する

## 参照すべき既存ページ

新ページを作る際は以下を参考にすること：
- 議員一覧: `site/src/app/chitose/page.tsx`
- 議事録一覧: `site/src/app/chitose/minutes/page.tsx`
- 議事録詳細: `site/src/app/chitose/minutes/[id]/page.tsx`
- 会議録: `site/src/app/chitose/sessions/page.tsx`
- 議員詳細: `site/src/app/chitose/members/[id]/page.tsx`
- CityHeader設定: `site/src/components/CityHeader.tsx`

## データ読み込みパターン

```typescript
function getData(): T[] {
  const fp = path.join(process.cwd(), "data", "{city}", "{file}.json");
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as T[];
  } catch {
    return [];
  }
}
```

`process.cwd()` は `site/` を指す。

## 作業完了時のコミットとプッシュ

```bash
cd /Users/yohei/gikai-map-hokkaido
git add -A
git commit -m "タスクタイトルを記述したコミットメッセージ"
git push
```
