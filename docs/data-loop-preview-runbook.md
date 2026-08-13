# 予算Data Loop限定プレビュー運用メモ

最終更新: 2026-08-13

## 目的

`/data-loop-preview`は、5市のR7・R8予算Data Loopを関係者だけで確認するためのパスワード付き画面。

これは一般公開の承認ではない。canonical数値、前年比較、構造変更、出典、Coverageを同じ画面で確認し、欠損・未評価・利用条件未確認を見える状態にする。

## 対象

- 千歳市
- 恵庭市
- 江別市
- 旭川市
- 札幌市

現在の派生データは426 facts、224 comparisons、6 structural events、53 Coverage records。

## データの流れ

```text
ローカル原本・検証レポート（gitignore対象）
  ↓ site/scripts/build-data-loop-preview.mjs
site/data/data-loop-preview/budget-preview.v1.json
  ↓ server-only import
/data-loop-preview
```

生成JSONは、公開static assetではなく認証後のServer Componentだけが読み込む。原本PDF、原本画像、canonical全量、private chunksはこの画面から配布しない。

## ローカル検証

```bash
cd site
npm run build-data-loop-preview
npm run check:data-loop-preview
npm run lint
```

`check:data-loop-preview`は次を満たさない場合に失敗する。

- 5市すべての技術検証が合格
- private data以外のrelease surfaceがすべてblocked
- 人手承認済み件数が0のまま
- 224比較にR7・R8双方の公式landing pageがある
- Coverageの存在状態と対象区分が固定enum内
- 集計件数と実データ件数が一致

本番形式の認証確認は、ローカルサーバーまたはCloudflareローカルWorkerを起動してから実行する。

```bash
POLICY_RESEARCH_ACCESS_PASSWORD='<12文字以上>' \
npm run verify:data-loop-preview-local
```

この検証スクリプトはlocalhost以外を拒否し、アクセスパスワードを外部URLへ送らない。

## 認証

`/research`と共通の署名付き12時間セッションを使う。

- `POLICY_RESEARCH_ACCESS_PASSWORD`: 12文字以上
- `POLICY_RESEARCH_SESSION_SECRET`: 別途生成する32文字以上のランダム値
- cookie: HttpOnly / Secure / SameSite=Strict
- response: private / no-store / noindex / nofollow

値はCloudflare secretとして管理し、ファイル・Git・`NEXT_PUBLIC_*`には置かない。

## stagingへ進む条件

1. AWS側のBedrock再テストが完了している。
2. `/research`と`/data-loop-preview`を同じ差分で検証できる。
3. Cloudflare stagingへAPI URL、API key、password、session secretを登録する。
4. 未ログインでデータが見えないことを内蔵ブラウザで確認する。
5. `/research`固定3ケースと予算5市の表示・出典・Coverageを確認する。
6. 本番ドメインへは自動で進めない。

## 開けてはいけないgate

限定公開中も次はblockedのままにする。

- public facts
- public Markdown
- public RAG
- public UI
- raw document mirror
- cross-municipality comparison
- full coverage claim

人手全数レビュー、利用条件、リンク条件、freshness、共通concept registryが揃うまで一般公開へ移行しない。
