# Cloudflare 本番移行 Runbook

最終更新: 2026-06-01

地方議会ドットコムを無料運用寄りで Cloudflare Workers / Static Assets に移すための実行手順。
外部サービスの設定変更を含むため、各ステップは一つずつ確認して進める。

## 方針

- 本番ドメインはいきなり切り替えない。
- 先に `chihougikai-com-staging` などの別 Worker / workers.dev、または `cf.chihougikai.com` などの検証用サブドメインで公開する。
- Vercel 側はすぐ消さず、DNS を戻せる期間を置く。
- 予算書画像と議員写真は GitHub Raw から表示し、Cloudflare static assets には載せない。
- Remote MCP、like、動的OGPは公開サイト本体から外した状態を前提にする。

2026-06-01時点では、`chihougikai.com` / `www.chihougikai.com` は Cloudflare 応答で本番検証済み。
最新 production Worker Version ID は `6cb22188-6266-4910-b49c-7c3fea062467`。
Vercel は rollback 用として残し、Cloudflare metrics と Search Console を見てから整理する。

## 事前確認

```bash
cd site
npm run cf:verify
```

確認すること:

- `npm run lint` が成功する。
- `npm run cf:build` が成功する。
- build ログの静的生成ページ数が急増していない。
- build 後に `Pruned .open-next/assets/budgets` と `Pruned .open-next/assets/members` が出る。
- `Cloudflare build check passed.` が出る。
- `.open-next/assets` と `.open-next/cache` の推定アップロード量が肥大化していない。
- `Cloudflare smoke test passed.` が出る。
- `Cloudflare local verification passed.` が出る。
- preview ログに `StaticAssetsIncrementalCache: Failed to set to read-only cache` が出ない。
- preview / 検証用サブドメインでは `X-Robots-Tag: noindex, nofollow` が付く。
- preview / 検証用サブドメインの `/robots.txt` は `Disallow: /` を返す。

目安:

- 静的生成ページ数: 約618ページ
- build 後 assets: 約24MB / 約220ファイル
- build 後 cache: 約279MB / 約498ファイル
- 推定アップロード量: 約304MB / 約718ファイル
- preview 後 assets: 約304MB / 約718ファイル
- 動的API: `/api/search` のみ
- `/api/search`: Cloudflare 上では軽い client-search 応答を返し、ブラウザ側で静的検索インデックスを処理する

## ローカル preview

手動で確認したい場合のみ、次を使う。

```bash
cd site
npm run cf:preview
```

別ターミナルで確認:

```bash
npm run cf:smoke -- --base http://localhost:8787
```

`cf:smoke` は base URL のホストを見て、`chihougikai.com` / `www.chihougikai.com` では indexable、それ以外の検証URLでは noindex として確認する。
また、検索APIは同一クエリを複数回確認し、無料枠で問題になりやすい連続検索の503を検出する。

期待値:

- HTMLページは 200
- preview / 検証用サブドメインでは `X-Robots-Tag: noindex, nofollow`
- preview / 検証用サブドメインの `/robots.txt` は `Disallow: /`
- 本番ドメインでは `/robots.txt` が `Allow: /` と sitemap を返す
- `/members/...jpg` は GitHub Raw へ 308
- `/budgets/...webp` は GitHub Raw へ 308
- `/api/search` は 200
- `/api/search?q=予算` の連続実行も 200
- `/api/mcp` と `/api/like` は 404

## Cloudflare へアップロード

本番ドメイン切替前の検証は、まず `cf:upload` で Cloudflare にバージョンを上げ、発行URLまたは検証用サブドメインで行う。

まず認証状態を確認する。

```bash
cd site
npx wrangler whoami
```

`You are not authenticated` と出る場合は、ブラウザを開ける手元のターミナルで次を実行してログインする。
`cf:login` は Wrangler の Cloudflare skills インストール確認を避けるため、ログインコマンドだけを `CI=true` で起動する。

```bash
cd site
npm run cf:login
```

CI や自動実行にする場合は、Cloudflare の管理画面で発行した最小権限の API Token を `CLOUDFLARE_API_TOKEN` として渡す。
トークン権限は Cloudflare 側の最新画面に合わせ、Worker のアップロードと必要なルート操作に絞る。

外部へ出さずに Wrangler の deploy 構成だけ確認する場合:

```bash
cd site
npm run cf:preflight
```

`cf:preflight` は1回の Cloudflare build で、local preview、smoke test、読み取り専用cache書き込みログ確認、cache assets 詰め込み、`wrangler deploy --dry-run` まで続けて実行する。
dry-run 段階では OpenNext の cache assets を `.open-next/assets/cdn-cgi/_next_cache` に詰めてから `wrangler deploy --dry-run` を実行するため、upload/deploy 時の assets 構成に近い状態で確認できる。
成功時は `.open-next/cloudflare-preflight.json` に6時間有効の確認スタンプを書く。このスタンプは `site/` 配下の対象ファイルと `.open-next` 成果物の両方を検証する。
OpenNext の `upload` / `deploy` コマンド自体も remote cache populate を実行する。

現在の成果物が外部反映ゲートを通る状態かだけ見る場合:

```bash
cd site
npm run cf:release-status
```

`cf:release-status` は preflight スタンプと `.open-next` 成果物に加えて、Cloudflare の認証状態も確認する。
ローカル成果物が有効でも未ログインの場合は、`cf:upload` に進む前に認証手順を表示して止まる。
表示上は `cf:upload` 用のローカル成果物ゲートと、`cf:deploy` 用の検証URLゲートを分けて見る。
`deploy URL gate: not ready (only local preview URL has been verified)` は、まだ Cloudflare 上のURLを確認していないという意味で、`cf:upload` 前なら正常な待ち状態。

ログイン後の最短手順:

```bash
cd site
npm run cf:release-status
CLOUDFLARE_RELEASE_CONFIRM=upload-and-verify npm run cf:upload-verify
```

現アカウントでは Worker Preview URL が利用できない場合がある。
その場合は、別名の staging Worker にデプロイして検証する。
既定の staging Worker は `chihougikai-com-staging`。

```bash
cd site
CLOUDFLARE_RELEASE_CONFIRM=staging npm run cf:deploy-staging -- --base https://chihougikai-com-staging.yohei-218.workers.dev
```

ステージングWorkerだけを手動で更新する場合:

```bash
cd site
CLOUDFLARE_RELEASE_CONFIRM=staging node scripts/confirm-cloudflare-release.mjs staging
npx opennextjs-cloudflare deploy --config wrangler.staging.jsonc
npm run cf:verify-url -- --base https://chihougikai-com-staging.yohei-218.workers.dev
```

本番用WorkerのDNS切替前検証URL:

```bash
cd site
npm run cf:verify-url -- --base https://chihougikai-com.yohei-218.workers.dev
npm run cf:dns-status
```

DNS伝播待ちから本番ホスト検証までを自動で進める場合:

```bash
cd site
npm run cf:finalize-production
```

`cf:finalize-production` は、NS がまだ Vercel 側なら現状を表示して終了する。
NS が Cloudflare 側になっていれば、`https://chihougikai.com` を本番ホストとして検証し、`cf:release-status` と `cf:dns-status` まで続けて実行する。
1.1.1.1 / 8.8.8.8 などのpublic resolverだけ先にCloudflareへ変わり、実行環境の通常解決がまだVercelへ向く中間状態もある。
その場合は `cf:finalize-production` が「public resolverはCloudflareだが、この環境はまだVercel」と表示して待つ。
本番切替後の数日監視では、公開ホストとDNSを主対象にする `npm run cf:post-cutover-check` を使う。
このコマンドは `cf:release-status` も参考表示するが、作業中の未コミット差分でpreflight stampが古くなっている場合は、公開状態の監視としては失敗扱いにしない。
公開ホスト検証だけは、瞬間的な503で誤検知しすぎないよう1回だけ自動再試行する。

2026-06-01時点で `chihougikai.com` は Cloudflare Free zone として追加済み。
Cloudflare assigned NS は `adi.ns.cloudflare.com` / `david.ns.cloudflare.com`、Zone ID は `c1b5d931ad20770b345b378fff416a22`。
Worker routes は `chihougikai.com/*` / `www.chihougikai.com/*` を `chihougikai-com` に紐付け済み。
Vercel 側の domain nameservers も Cloudflare NS へ変更済み。
公開DNSの伝播後、`npm run cf:finalize-production` で本番host検証を通過済み。
`cf:dns-status` は、現在のNS、apex A/CNAME、`www` CNAME、公開URLが Vercel / Cloudflare のどちらを返しているか、Worker検証URLが生きているかをまとめて表示する。
現在のWrangler OAuthでは zone作成権限がなく、Cloudflare API で zone を作ろうとすると `com.cloudflare.api.account.zone.create` 不足で止まる。
そのため zone 追加と Worker routes は Dashboard で行った。
`wrangler.jsonc` に routes を入れるとローカルpreflightの非本番noindex検証と衝突するため、現時点では routes を設定ファイルに固定しない。

`cf:release-status` が preflight 期限切れやファイル変更を出した場合は、先に `npm run cf:preflight` を取り直す。
`cf:upload-verify` は、preflight済み成果物をCloudflareへ upload し、`--preview-alias staging` 付きの preview URL を作って、`cf:verify-url` と `cf:release-log-entry` まで続ける。
alias を変える場合は `--preview-alias <alias>` を付ける。
URLを自動検出できない場合や検証用サブドメインを使う場合は、URLを明示する。

```bash
cd site
CLOUDFLARE_RELEASE_CONFIRM=upload-and-verify npm run cf:upload-verify -- --base https://<preview-or-subdomain>
```

検証ログまで自動追記する場合は、重複日付の既存ログがないことを確認して `--append-log` を付ける。

```bash
cd site
CLOUDFLARE_RELEASE_CONFIRM=upload-and-verify npm run cf:upload-verify -- --append-log
```

手順を分けて行う場合:

```bash
cd site
CLOUDFLARE_RELEASE_CONFIRM=upload npm run cf:upload -- --preview-alias staging
npm run cf:verify-url -- --base https://<preview-or-subdomain>
```

`cf:verify-url` は `cf:smoke` と同じ確認を使う。検証用URLでは noindex / robots `Disallow: /`、本番ドメインでは indexable として判定する。
誤って既存本番の Vercel 側を検証証跡にしないため、`chihougikai.com` / `www.chihougikai.com` は通常は受け付けない。
本番DNS切替後に本番ドメインを確認する場合だけ、`--allow-production-host` を付ける。
成功時は `.open-next/cloudflare-url-verification.json` に、検証URL・検証時刻・preview/production判定・直近preflight fingerprintを書き出す。
ローカルpreflight中の `http://localhost:8787` 検証では、preflightスタンプ作成前に一度 `preflight_status: "not_ready"` になるが、`cf:preflight` 成功時に同じ証跡へpreflight fingerprintを追記して `ready` に更新する。
Cloudflareへ upload 後の検証URLでは、直前の `cf:preflight` が有効なら `preflight_status: "ready"` になる。
このファイルはローカル証跡であり、gitには含めない。

実行したURLと結果は `docs/cloudflare-release-log.md` に残す。
現在のpreflight / URL検証stampから記録案を作る場合は、次を使う。

```bash
cd site
npm run cf:release-log-entry
```

そのまま追記する場合:

```bash
cd site
npm run cf:release-log-entry -- --append
```

ローカルpreviewだけの準備記録として追記する場合は、外部検証済みと誤読しないよう明示する。
この場合、見出しは `Cloudflare ローカル準備` になり、Cloudflare 上のURL検証後の `Cloudflare 検証` 記録とは分かれる。

```bash
cd site
npm run cf:release-log-entry -- --append --allow-local
```

追記前に内容だけ確認する場合:

```bash
cd site
npm run cf:release-log-entry -- --append --allow-local --dry-run
```

`cf:deploy` は、このURL検証証跡が現在のpreflight fingerprintと一致し、かつ `localhost` ではない Cloudflare 上のURLでない限り止まる。
Cloudflare 上の検証URLで `cf:verify-url` が通ると、次に実行すべき `cf:release-status` と `cf:deploy` のコマンドを表示する。
ローカル preview の検証では `cf:deploy` は解放されない。

`upload` / `deploy` は外部の Cloudflare に反映する操作なので、明示的な環境変数がないと止まる。
`cf:upload` は検証用の新しい Worker version を上げる操作、`cf:deploy` は本番 traffic / route へ反映する操作として扱う。

```bash
cd site
CLOUDFLARE_RELEASE_CONFIRM=upload-and-verify npm run cf:upload-verify
```

URLを手動指定する場合:

```bash
cd site
CLOUDFLARE_RELEASE_CONFIRM=upload-and-verify npm run cf:upload-verify -- --base https://<preview-or-subdomain>
```

DNS切替後の本番ドメイン確認だけ:

```bash
cd site
npm run cf:verify-url -- --base https://chihougikai.com --allow-production-host
```

本番へ反映する段階でのみ:

```bash
cd site
CLOUDFLARE_RELEASE_CONFIRM=deploy npm run cf:deploy
```

注意:

- `cf:deploy` は外部サービスへ反映する操作。
- `cf:upload` / `cf:deploy` の前に `npm run cf:preflight` を通す。スタンプが無い、古い、対象ファイルが変わった、または `.open-next` 成果物が変わった場合は止まる。
- `cf:upload` / `cf:deploy` は再buildせず、preflightで確認済みの `.open-next` 成果物を使う。
- 実行前に `npm run cf:release-status` で preflight と Cloudflare 認証を確認する。
- 初回は検証用サブドメインだけを紐づける。

## Cloudflare 側の設定

- Worker name: `chihougikai-com`
- Static Assets binding: `ASSETS`
- Compatibility flags: `nodejs_compat`
- Observability: disabled
- Smart Placement: 使用しない

環境変数:

- `GIKAI_REPO_OWNER`: 省略時 `gyawa24`
- `GIKAI_REPO_NAME`: 省略時 `gikai-map-hokkaido`
- `GIKAI_REPO_BRANCH`: 省略時 `main`
- Notion記事連携を使う場合のみ `NOTION_TOKEN` などを設定する

## DNS切替

1. `npm run cf:dns-status` で、現状が Vercel DNS であることと Worker検証URLが200であることを確認する。
2. Cloudflare に `chihougikai.com` を追加する。
3. Vercel DNS の現行レコードを控え、Cloudflare DNS に同等のレコードを作る。
4. Worker route / custom domain を `chihougikai.com` と `www.chihougikai.com` に設定する。
5. レジストラ側で Cloudflare の nameserver に変更する。
6. 伝播後、`npm run cf:finalize-production` を実行する。
7. `cf:finalize-production` が本番ホスト検証まで通したことを確認する。手動で分ける場合は `npm run cf:dns-status` と `npm run cf:verify-url -- --base https://chihougikai.com --allow-production-host` を実行する。
8. Vercel 側は最低数日残す。
9. 問題があれば nameserver / DNS を Vercel 側へ戻す。

## 切替後に見るもの

- `node scripts/operations-check.mjs --cloudflare`
- `npm run cf:post-cutover-check`
- Cloudflare Workers requests
- Worker CPU time
- Static Assets のファイル数とサイズ
- `/api/search` のレスポンス
- GitHub Raw の画像表示
- Search Console のクロールエラー

### Search Console 確認

Search Console は URL-prefix property `https://chihougikai.com/` を使う。
`sc-domain:chihougikai.com` は権限がない場合があるため、まず URL-prefix property で確認する。

切替後数日は、次を `docs/cloudflare-release-log.md` に短く残す。

- 検索パフォーマンス: 最終更新時刻、合計クリック数、合計表示回数、平均CTR、平均掲載順位
- ページ: 最終更新日、登録済みページ数、未登録ページ数、5xx件数
- サイトマップ: `/sitemap.xml` の最終読み込み日時、ステータス、検出ページ数

ページレポートは反映が遅れるため、Cloudflare切替前の日付の5xxや未登録件数だけで即異常扱いにしない。
切替後の日付で5xxが増え続ける、サイトマップが失敗する、またはクリック・表示が急落する場合に調査する。

## 無料枠が厳しくなった時の停止順

1. 予算OCR画像の追加拡大を止める。
2. テーマ詳細の事前生成数を減らす。
3. 議事録詳細の事前生成数を減らす。
4. `/api/search` の返却件数またはレート制限を絞る。
5. Remote MCP は別Workerやローカルstdioだけに限定する。
