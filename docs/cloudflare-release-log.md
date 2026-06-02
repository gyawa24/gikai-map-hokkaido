# Cloudflare Release Log

Cloudflare Workers / Static Assets へ移行するときの確認記録。
外部公開やDNS切替は一度きりの判断になりやすいため、実行したURL・時刻・結果をここに残す。

## 使い方

1. `npm run cf:preflight` が通ったら、ローカル確認欄を埋める。
2. `CLOUDFLARE_RELEASE_CONFIRM=upload-and-verify npm run cf:upload-verify` で upload と検証URL確認を行う。
3. 自動検出できない場合は `--base <URL>` で検証用URLを明示する。
4. DNS切替を行った場合だけ、本番確認欄を埋める。
5. 問題があった場合は、Vercelへ戻せる状態を保ったままメモする。

`npm run cf:release-log-entry -- --append` は Cloudflare 上のURL検証が済んだ記録だけ追記する。
ローカルpreviewだけの準備記録を残す場合は、外部検証済みと誤読しないよう `--allow-local` を付ける。
追記前に内容だけ確認したい場合は `--dry-run` を併用する。
ローカルpreviewだけの場合は `Cloudflare ローカル準備`、Cloudflare 上のURL検証まで済んだ場合は `Cloudflare 検証` として記録する。
同じ見出しが既にある場合、追記は止まり、必要なら既存記録を手で更新する。

## 記録テンプレート

### YYYY-MM-DD Cloudflare 検証

実施者:

#### ローカル確認

- `npm run cf:preflight`:
- 静的生成ページ数:
- estimated upload:
- dry-run:
- 備考:

#### Cloudflare upload

- 実行コマンド:
- Workers URL:
- 検証用サブドメイン:
- upload結果:
- 備考:

#### 検証URL確認

- 実行コマンド:
- verified URL:
- expected robots:
- `npm run cf:release-status`:
- deploy URL gate:
- 備考:

#### 本番DNS切替後の確認

- DNS切替時刻:
- 実行コマンド:
- production URL:
- robots:
- sitemap:
- search:
- GitHub Raw画像:
- rollback可否:
- 備考:

## 2026-05-31 Cloudflare ローカル準備

実施者: Codex

#### ローカル確認

- `npm run cf:preflight`: 通過
- 静的生成ページ数: 618
- estimated upload: 約303.6 MiB / 718 files
- dry-run: `wrangler deploy --dry-run` 通過
- 備考: Cloudflare未認証のため、外部uploadは未実施。`npm run cf:release-status` はローカル成果物OK・Cloudflare未認証で停止する。

## 2026-05-31 Cloudflare ステージング検証

実施者: Codex

#### ローカル確認

- `npm run cf:preflight`: 通過
- 静的生成ページ数: 618
- estimated upload: 約303.6 MiB / 718 files
- dry-run: `wrangler deploy --dry-run` 通過
- 備考: 検証スクリプトは `/api/search?q=予算` の連続実行も確認する。

#### Cloudflare upload

- 実行コマンド: `npx opennextjs-cloudflare deploy --config wrangler.staging.jsonc`
- Workers URL: `https://chihougikai-com-staging.yohei-218.workers.dev`
- Current Version ID: `c83c7a64-fba9-48b7-8270-df2e1ad19d06`
- 検証用サブドメイン: workers.dev staging Worker
- upload結果: 実施済み
- 備考: 本番 `chihougikai.com` のDNS・trafficは未変更。

#### 検証URL確認

- 実行コマンド: `npm run cf:verify-url -- --base https://chihougikai-com-staging.yohei-218.workers.dev`
- verified URL: `https://chihougikai-com-staging.yohei-218.workers.dev`
- expected robots: noindex
- `npm run cf:release-status`: ローカル成果物OK・Cloudflare認証OK
- `/api/search?q=予算`: `x-gikai-search-mode: client` で200。Worker上では全文検索せず、ブラウザ側で `public/generated/search-index.json` を処理する。
- 検索画面: ローカルCloudflare相当環境で `/search?q=予算` が 4,804 件を表示。React error 0件。

#### 本番用Workerへの反映

- 実行コマンド: `CLOUDFLARE_RELEASE_CONFIRM=deploy npm run cf:deploy`
- Workers URL: `https://chihougikai-com.yohei-218.workers.dev`
- Current Version ID: `cd6a35d5-3a86-4b71-a4c3-57a463c3449d`
- 実行コマンド: `npm run cf:verify-url -- --base https://chihougikai-com.yohei-218.workers.dev`
- 検証結果: ページ、動的詳細、検索、sitemap、robots、OGP、旧URL転送、非公開API 404 が通過。
- 備考: 本番 `chihougikai.com` のDNS・trafficは未変更。`workers.dev` はDNS切替前の検証URLとして明示的に有効化する。
- 2026-06-01 追加実行: `CLOUDFLARE_RELEASE_CONFIRM=deploy npm run cf:deploy`
- 2026-06-01 Current Version ID: `4e3514a5-e8c2-4533-883f-c9dfc50667ef`
- 追加修正: `/asahikawa/minutes/312` のような大きいGitHub Raw fallback議事録は Worker で本文JSONを展開せず、ブラウザ側で読み込む方式へ変更。CSPは middleware に一本化し、`connect-src 'self' https://raw.githubusercontent.com` を許可。
- 2026-06-01 検証結果: Worker URLでページ、動的詳細、検索、sitemap、robots、OGP、旧URL転送、非公開API 404 が通過。大きい議事録ページは 200、CSPは重複なし、GitHub Rawは CORS 許可あり。
- 2026-06-01 更新情報追記後の最終実行: `npm run cf:preflight`、`CLOUDFLARE_RELEASE_CONFIRM=staging npm run cf:deploy-staging -- --base https://chihougikai-com-staging.yohei-218.workers.dev`、`CLOUDFLARE_RELEASE_CONFIRM=deploy npm run cf:deploy`
- 2026-06-01 最終 staging Version ID: `85a797df-0ed5-4d83-b289-979f92bfbb7a`
- 2026-06-01 最終 production Version ID: `85babf7c-5446-4531-a8d8-7873d43197ee`
- 2026-06-01 最終検証結果: `npm run cf:finalize-production` 通過。`/news` に「サイトの配信基盤を更新しました」が反映済み。
- 2026-06-01 検索インデックス読み込み安定化後の最終実行: `npm run cf:preflight`、`CLOUDFLARE_RELEASE_CONFIRM=staging npm run cf:deploy-staging -- --base https://chihougikai-com-staging.yohei-218.workers.dev`、`CLOUDFLARE_RELEASE_CONFIRM=deploy npm run cf:deploy`
- 2026-06-01 検索安定化後 staging Version ID: `23842684-6138-472a-b421-4d749f1b5efd`
- 2026-06-01 検索安定化後 production Version ID: `b9c91e53-2adc-44b6-9db9-266d38115206`
- 2026-06-01 検証結果: `npm run cf:finalize-production` 通過。`/api/search?q=予算` は `x-gikai-search-mode: client` で200。
- 2026-06-01 smoke強化後のproduction反映: `CLOUDFLARE_RELEASE_CONFIRM=deploy npm run cf:deploy`
- 2026-06-01 smoke強化後 production Version ID: `d9b83282-eead-4314-a0ee-32354758434d`
- 2026-06-01 検証結果: `npm run cf:verify-url -- --base https://chihougikai.com --allow-production-host` 通過。大きい議事録詳細、検索API連続実行、robots、sitemap、旧URL転送、非公開API 404 を確認。
- 2026-06-01 `uryu` segments公開反映: `npm run cf:preflight`、`CLOUDFLARE_RELEASE_CONFIRM=staging npm run cf:deploy-staging -- --base https://chihougikai-com-staging.yohei-218.workers.dev`、`CLOUDFLARE_RELEASE_CONFIRM=deploy npm run cf:deploy`
- 2026-06-01 `uryu` segments反映後 staging Version ID: `1e01150b-a136-45ae-8c50-c5d08e1a5666`
- 2026-06-01 `uryu` segments反映後 production Version ID: `fdbd40fe-d819-4b51-bd8b-45edb58610b6`
- 2026-06-01 検証結果: `npm run cf:finalize-production` 通過。`uryu` segments追加後の検索indexを含む本番ホストで、検索API連続実行、robots、sitemap、GitHub Raw画像、大きい議事録詳細、旧URL転送、非公開API 404 を確認。
- 2026-06-01 `uryu` segments fallback絞り込み後の最終実行: `npm run cf:preflight`、`CLOUDFLARE_RELEASE_CONFIRM=staging npm run cf:deploy-staging -- --base https://chihougikai-com-staging.yohei-218.workers.dev`、`CLOUDFLARE_RELEASE_CONFIRM=deploy npm run cf:deploy`
- 2026-06-01 `uryu` segments fallback絞り込み後 staging Version ID: `bd69403f-a8d5-4fc6-a837-519de6cfa899`
- 2026-06-01 `uryu` segments fallback絞り込み後 production Version ID: `dde475bd-8a43-4fc2-aeac-a8eb86634329`
- 2026-06-01 検証結果: `npm run cf:finalize-production` 通過。`https://chihougikai.com/generated/search-index.json` に `uryu` の検索対象330件が含まれることを確認。
- 2026-06-01 production確認後のstatus表示修正後の最終実行: `npm run cf:preflight`、`CLOUDFLARE_RELEASE_CONFIRM=staging npm run cf:deploy-staging -- --base https://chihougikai-com-staging.yohei-218.workers.dev`、`CLOUDFLARE_RELEASE_CONFIRM=deploy npm run cf:deploy`
- 2026-06-01 status表示修正後 staging Version ID: `aac9532c-283d-4267-987e-25d67e646650`
- 2026-06-01 status表示修正後 production Version ID: `6cb22188-6266-4910-b49c-7c3fea062467`
- 2026-06-01 検証結果: `npm run cf:finalize-production` 通過。`cf:release-status` は本番確認後に再deployではなく `cf:dns-status` / `cf:finalize-production` を次コマンドとして表示する。

#### DNS / 公開ドメイン状況

- Cloudflare zone: Dashboardから `chihougikai.com` を Free plan で追加済み。
- Zone ID: `c1b5d931ad20770b345b378fff416a22`
- Cloudflare assigned NS: `adi.ns.cloudflare.com`, `david.ns.cloudflare.com`
- Worker routes: `chihougikai.com/*` と `www.chihougikai.com/*` を `chihougikai-com` に紐付け済み。
- Vercel domain nameservers: `adi.ns.cloudflare.com`, `david.ns.cloudflare.com` へ変更済み。
- 2026-06-01時点の公開DNS: 通常解決、1.1.1.1、8.8.8.8 のいずれも `adi.ns.cloudflare.com`, `david.ns.cloudflare.com` を返す。
- 2026-06-01時点の公開URL: `https://chihougikai.com` と `https://www.chihougikai.com` は Cloudflare 応答で 200。
- `npm run cf:finalize-production` 通過。本番ホストの robots / sitemap / search / GitHub Raw画像 / 動的議事録詳細を確認済み。
- 最新 production Worker Version ID: `6cb22188-6266-4910-b49c-7c3fea062467`
- 2026-06-01 22:53 JST 監視確認: `npm run cf:dns-status` 通過。通常解決、1.1.1.1、8.8.8.8 のNSはいずれもCloudflare。`chihougikai.com` / `www.chihougikai.com` / Workers URL はすべて 200 Cloudflare 応答。
- 2026-06-01 23:22 JST 監視確認: `npm run cf:release-status` 通過。production host verified、Cloudflare auth ok、deploy URL gate ready。Codex heartbeat `cloudflare-dns` で1時間ごとの短期監視を継続。
- 2026-06-01 23:36 JST 監視確認: `npm run cf:post-cutover-check` 通過。公開ホスト smoke、DNS status、Cloudflare 200 応答を確認。作業中差分により local release gate は preflight stamp stale だが、公開状態の監視としては非ブロッキング扱い。
- 2026-06-01 23:40 JST Search Console確認: URL-prefix property `https://chihougikai.com/` にアクセス可能。検索パフォーマンスは最終更新4.5時間前、28日表示でクリック1,319、表示3.65万、CTR 3.6%、平均掲載順位6.4。ページレポートは最終更新2026/05/29で登録済み1.21万、未登録1.04万、5xx 463件はCloudflare切替前データのため継続監視。`/sitemap.xml` は2026/06/01最終読み込み、成功、検出ページ1,417。
- 2026-06-01 23:49 JST 監視確認: 1回目の `npm run cf:post-cutover-check` で動的トピックページ503とsitemap本文確認失敗が出たが、直後の個別確認ではトピックページ200、sitemap内の `https://chihougikai.com/hakodate` あり。再実行した `npm run cf:post-cutover-check` は公開ホスト smoke、DNS status ともに通過。瞬間的な失敗として継続監視する。
- 2026-06-01 23:52 JST 監視確認: `cf:post-cutover-check` に公開ホスト検証の1回再試行を追加したうえで再実行し、公開ホスト smoke、DNS status ともに通過。
- 2026-06-01 23:56 JST 監視確認: `node scripts/operations-check.mjs --cloudflare` を追加して実行。本番DNS、public resolver、`chihougikai.com`、`www.chihougikai.com`、workers.dev、Worker deployment はCloudflare応答で、判定は `public host is on Cloudflare`。
- 2026-06-01 23:58 JST 監視確認: `npm run cf:post-cutover-check` 再実行で公開ホスト smoke、DNS status ともに通過。
- 2026-06-02 00:00 JST 監視確認: `node scripts/operations-check.mjs --cloudflare` の単発URL取得で一度だけ apex 503 を拾ったため、`cloudflare-dns-status` のURL確認にも503系の短い再試行を追加。再実行では本番DNS、public resolver、`chihougikai.com`、`www.chihougikai.com`、workers.dev、Worker deployment はCloudflare応答で、判定は `public host is on Cloudflare`。
- 2026-06-02 00:02 JST 監視確認: `node scripts/operations-check.mjs --cloudflare` と `npm run cf:post-cutover-check` を再実行し、どちらも通過。
- 2026-06-02 00:05 JST 監視確認: Codex heartbeat `cloudflare-dns` の監視入口に `node scripts/operations-check.mjs --cloudflare` を追加。preflight stamp stale と verified deploy URL not ready は、作業中の公開監視では非ブロッキング扱いにする。
- 2026-06-02 00:10 JST 監視確認: `cloudflare-dns-status` のURL確認でAbort系の一時失敗も再試行するよう調整。`node scripts/operations-check.mjs --cloudflare`、直接curl、`npm run cf:post-cutover-check` はいずれも公開ホスト200 Cloudflareで通過。
- 2026-06-02 00:12 JST 保存前チェック整理: `review-cloudflare-migration.mjs --markdown` / `--commit-plan` の保存前確認を、切替後監視に合わせて `operations-check --cloudflare` と `cf:post-cutover-check` 中心に更新。外部再反映時だけ `cf:preflight` / `cf:release-status` を取り直す形に整理。
- 2026-06-02 00:14 JST 監視確認: `npm run cf:post-cutover-check` 再実行で公開ホスト smoke、DNS status ともに通過。
- rollback可否: Vercel側のネームサーバーを `ns1.vercel-dns.com`, `ns2.vercel-dns.com` に戻せばVercel運用へ戻せる。
- Cloudflare zones API で `chihougikai.com` の作成を試行したが、現在のWrangler OAuth権限では `com.cloudflare.api.account.zone.create` が不足して403。zone追加とWorker routesはDashboardで実施済み。
- deploy URL gate: ready
- 備考: 検索APIは同一クエリで `miss` → `hit`、5回連続200を確認。

#### 本番DNS切替後の確認

- DNS切替時刻: 2026-06-01 伝播開始、同日通常解決でもCloudflare到達を確認。
- 実行コマンド: `npm run cf:finalize-production`
- production URL: `https://chihougikai.com` 200 Cloudflare、`https://www.chihougikai.com` 200 Cloudflare。
- robots: 本番は indexable。検証URLは noindex。
- sitemap: 200。
- search: `/api/search?q=予算` と連続実行が 200。
- GitHub Raw画像: 議員写真・予算画像の旧URL転送とRaw配信を確認。
- 大きい議事録詳細: `/asahikawa/minutes/312` が本番Workers URL・本番ドメインともに 200。本文JSONはGitHub Rawからブラウザ側で読み込む。
- 更新情報: `/news` に 2026-06-01 の配信基盤更新を表示。
- rollback可否: Vercel nameservers へ戻せる状態。
- 備考: Cloudflare DashboardのWorker routesは設定済み。`wrangler.jsonc` への routes 追記はローカルpreflightの非本番noindex検証と衝突したため、現時点ではDashboard設定として管理する。Vercelは rollback 用にしばらく残す。

## 2026-06-02 Cloudflare 検証

実施者: Codex

#### ローカル確認

- `npm run cf:preflight`: 通過
- preflight recorded_at: 2026-06-02 08:47:48 JST
- source files: 14,961
- artifact files: 2,966
- dry-run: 通過
- 備考: Cloudflare上のURL検証まで実施。

#### Cloudflare upload

- 実行コマンド: `CLOUDFLARE_RELEASE_CONFIRM=staging npm run cf:deploy-staging -- --base https://chihougikai-com-staging.yohei-218.workers.dev`、`CLOUDFLARE_RELEASE_CONFIRM=deploy npm run cf:deploy`
- Workers URL: https://chihougikai-com.yohei-218.workers.dev
- 検証用サブドメイン: https://chihougikai-com-staging.yohei-218.workers.dev
- upload結果: 実施済み
- 備考:

#### 検証URL確認

- 実行コマンド: npm run cf:verify-url -- --base https://chihougikai.com
- verified URL: https://chihougikai.com
- verified_at: 2026-06-02 08:50:12 JST
- expected robots: indexable
- `npm run cf:release-status`: ローカル成果物OK・Cloudflare URL検証済み
- deploy URL gate: ready (https://chihougikai.com)
- 備考:

#### 本番DNS切替後の確認

- DNS切替時刻: 2026-06-01に切替済み
- 実行コマンド: `npm run cf:post-cutover-check`、`node scripts/operations-check.mjs --cloudflare`
- production URL: https://chihougikai.com 200 Cloudflare、https://www.chihougikai.com 200 Cloudflare
- robots: indexable
- sitemap: 200
- search: `/api/search?q=函館市議会予算特別委員会` が 200、`x-gikai-search-mode: client`
- GitHub Raw画像: member / budget / large minutes fallback smoke 通過
- rollback可否: Vercel側を残して確認予定
- 備考: 函館市と留萌市の2026年議事録追加を本番反映。`/news`、`/hakodate/minutes/1367`、`/hakodate/minutes/1374`、`/rumoi/minutes/421` を公開ホストで確認済み。
- 2026-06-02 09:06 JST 追加確認: `/hakodate/minutes/1367` で一時的な Cloudflare 1102/503 を確認したため、巨大議事録詳細は本文をGitHub Rawからクライアント側で読み込む形に変更。production Worker Version ID `a1a52366-c2f7-4722-895f-82f07f671055` へ再デプロイし、`cf:post-cutover-check`、`cf:dns-status`、`operations-check --cloudflare`、`/hakodate/minutes/1367` 12回連続、`/hakodate/minutes/1374`、`/rumoi/minutes/421`、`/api/search?q=予算` を確認済み。
