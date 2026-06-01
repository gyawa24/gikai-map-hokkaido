# Vercel連携停止プラン

最終更新: 2026-06-02

## 目的

Cloudflare Workers / Static Assets を本番配信の主経路にし、Vercel は短期のrollback候補としてだけ残す。
GitHub push / PR のたびに Vercel Preview build が走る状態は止め、無料運用の予測可能性を上げる。

## 結論

段階的に止める。

1. すぐ: リポジトリ側で Vercel 自動デプロイを無効化する。
2. 数日安定後: Vercel Project の Git連携を切る。
3. rollback不要と判断後: Vercel Project / GitHub App 権限 / ローカル `.vercel/` を整理する。

## 現在の状態

- 本番ドメイン: Cloudflare Workers / Static Assets で配信中。
- Vercel: rollback 用に残っている。
- GitHub PR: Vercel Preview check がまだ走る。
- リポジトリ: `vercel.json` と `site/vercel.json` が tracked。`.vercel/` は ignore 済み。

## Stage 1: 自動デプロイ停止

リポジトリ側の `vercel.json` / `site/vercel.json` に以下を置く。

```json
{
  "git": {
    "deploymentEnabled": false
  }
}
```

Vercel公式ドキュメントでは、`git.deploymentEnabled` を `false` にすると全branchの自動デプロイを止められる。
Root Directory の解釈差を避けるため、当面は root と `site/` の両方に置く。

完了条件:

- 新しいpushで Vercel の本番/Preview deployment が増えない。
- 既存の pending Preview が残っても、新規buildが継続発生しない。

## Stage 2: Vercel Project の Git連携を切る

Cloudflare本番が数日安定したら、Vercel Dashboard で以下を実施する。

1. Vercel Dashboard で対象Projectを開く。
2. Settings -> Git を開く。
3. Connected Git Repository の Disconnect を実行する。

CLIでやる場合:

```sh
cd site
vercel git disconnect
```

これはVercel Project自体を削除する操作ではない。過去deployやProject設定は残しつつ、GitHub pushによる自動deployだけを切る。

完了条件:

- GitHub PR / push に Vercel deployment check が新規作成されない。
- Cloudflareの本番監視が引き続き通る。
- Vercel rollback が必要なら、Dashboardから手動で過去deployを確認できる。

## Stage 3: rollback候補を片付ける

1〜2週間ほどCloudflareで安定し、Search Console / Cloudflare metrics に大きな異常がなければ、Vercel側をさらに整理する。

候補:

- Vercel Project を削除、または名前を `archived-...` に変更する。
- GitHub の Vercel App 権限からこのrepoを外す。
- ローカルの `.vercel/` と `site/.vercel/` を削除する。
- tracked の `vercel.json` / `site/vercel.json` は、Vercelへ戻す可能性がなくなったら削除候補にする。

削除前に控えるもの:

- Vercel Project名 / Team名
- 直近で正常だったVercel deploy URL
- Vercel側の環境変数一覧
- rollbackする場合のnameserver手順

## やらないこと

- 本番切替直後に Vercel Project を即削除しない。
- Cloudflareの監視が落ち着く前に rollback 経路を消さない。
- `.vercel/` 内のローカル設定をコミットしない。

## rollback

Cloudflareで問題が出てVercelに戻す場合は、Vercel Project を残している間だけ以下が候補になる。

1. Vercel Project の Git連携を戻す、または手動deployする。
2. Vercel側の最新正常deploy URLを確認する。
3. DNS / nameserver をVercel側へ戻す。
4. `docs/cloudflare-release-log.md` に戻した理由と時刻を記録する。

## 判断目安

- 24〜72時間: Vercelは残すが、自動deployは止める。
- 数日安定後: Git連携を切る。
- 1〜2週間安定後: Project削除または権限整理を検討する。

## 参考

- Vercel Git Configuration: `git.deploymentEnabled=false` で全branchの自動deployを無効化できる。
- Vercel Git Settings: Project Settings -> Git -> Connected Git Repository から Disconnect できる。
- Vercel CLI: `vercel git disconnect` で接続済みGit repositoryを外せる。
