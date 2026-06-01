# Cloudflare無料運用 移行調査チェックリスト

調査日: 2026-05-30

この文書は、地方議会ドットコムを Vercel 依存から外し、Cloudflare の無料枠を中心に運用できるか確認するためのチェックリスト。
いきなり本番移行せず、費用・機能・データ配置・公開品質を順番に確認する。

## 結論

無料運用は可能性が高い。
ただし、現在の Vercel 前提の構成をそのまま移すのではなく、次の方針で進める。

1. 公開サイト本体は Cloudflare Workers / Static Assets に寄せる。
2. 重いデータ、予算OCR画像、古い議事録本文、segments は Cloudflare static assets に抱え込みすぎない。
3. 動的APIは無料枠の上限に入るため、検索・MCP・OGP を分けて検証する。
4. 本番ドメイン切替後もしばらく Vercel rollback を残し、Cloudflare metrics と Search Console を確認する。

## 2026-05-30 ローカル検証結果

`codex/cloudflare-free-migration` ブランチで、OpenNext Cloudflare の最小構成を追加して検証した。

追加したもの:

- `@opennextjs/cloudflare`
- `wrangler`
- `site/open-next.config.ts`
- `site/wrangler.jsonc`
- `site/package.json` の `cf:*` scripts

結果:

| 検証 | 結果 | メモ |
|---|---|---|
| `npm run cf:build` | 成功 | Next.js build + OpenNext bundle まで完了 |
| Cloudflare local preview | 起動成功 | `http://localhost:8787` |
| `/` | 200 | 静的アセットキャッシュ設定後に成功 |
| `/chitose` | 200 | 自治体ページは表示可能 |
| `/chitose/minutes` | 200 | 議事録一覧は表示可能 |
| `/chitose/budgets/2026` | 200 | 予算OCRページは表示可能。ただしサイズが大きい |
| `/sources` | 200 | 出典ページは表示可能 |
| `/articles/hokkaido-local-council-minutes-search` | 200 | 記事ページは表示可能 |
| `/chitose/members/1` | 200 | 議員詳細は表示可能 |
| `/search?q=こども` | 200 | サーバー側の searchParams 依存を外して静的化 |
| `/api/search?q=こども` | 200 | `public/generated/search-index.json` を Worker ASSETS から読む方式に変更 |
| `/topics/DX` | 200 | ASCII タグは静的生成で表示可能 |
| `/topics/u-e4ba88e7ae97` | 200 | 日本語タグは ASCII タグIDへ変換して静的生成 |
| `/topics/予算` | 308 | 旧日本語URLは Edge middleware で ASCII タグIDへ転送 |
| トップ/検索のテーマリンク | 直接ASCII URL | 主要導線は `/topics/u-...` へ直接リンクし、旧URL転送を極力使わない |
| `/generated/topics-index.json` | 200 | トピック詳細のクライアント表示用軽量index |
| `/generated/open-data/members/chitose.csv` | 200 | 議員名簿CSVを静的ファイルとして配信 |
| `/api/export/members?city=chitose` | 308 | 旧CSV API URLは静的CSVへ転送 |
| `/og-site.png` | 200 | サイト共通OGPは静的PNGを配信 |
| `/api/og-site` | 308 | 旧OGP API URLは静的PNGへ転送 |
| `/api/like` | 404 | like機能は無料運用優先で停止し、UI/APIを削除 |
| `/api/og-member`, `/api/og-segment` | 削除 | 個別OGP画像生成は停止し、共通の静的OGP画像へ代替 |
| `/api/mcp` | 404 | 公開サイト本体から切り離し。MCPは `mcp-server/` または将来の別Workerで扱う |
| `/chitose/minutes/567` | 200 | 未事前生成の議事録詳細も request-time render で表示可能 |
| `/chitose/minutes/561` | 200 | 同上。自治体メタデータをfsではなく同梱JSONから読むよう修正 |
| `/ebetsu/minutes/20241004/turns` | 200 | 構造化議事録ビューもCloudflare previewで表示可能 |

最初のpreviewでは静的ページも500になった。
原因は、OpenNextのデフォルトがプリレンダー済みページのcache assetを読まず、Worker runtimeで `data/municipalities.json` を直接 fs 読み込みしようとしていたため。
`static-assets-incremental-cache` を使う設定に変えることで、プリレンダー済みの主要ページは200になった。

検索APIとトピック詳細は、Worker上の fs 依存を外した。
現時点の方針は次の通り。

1. `/api/search` は事前生成した `public/generated/search-index.json` を ASSETS 経由で読む。
2. `/topics/[tag]` は request-time render にし、一覧部分は `public/generated/topics-index.json` をブラウザ側で読む。
3. 日本語タグURLは Cloudflare の静的パス解決で404になったため、URL上は ASCII タグIDに変換する。
4. 旧URL互換のため、`/topics/予算` のような日本語URLは middleware で `/topics/u-...` へ 308 転送する。サイト内導線と sitemap は最初から `/topics/u-...` へ直接リンクする。
5. 議員名簿CSVは `public/generated/open-data/members/{slug}.csv` としてビルド時生成し、旧APIは静的CSVへ転送する。
6. サイト共通OGPは既存の `public/og-site.png` を使い、旧 `/api/og-site` は静的PNGへ転送する。
7. like機能は本体公開に必須ではないため停止し、`/api/like*` と `@vercel/kv` 依存を削除する。
8. `municipalities.json` は全ページの基礎データなので、Worker runtimeのfs依存を避けてアプリに同梱する。
9. 議員別・発言別OGP画像生成APIは無料運用優先で停止し、個別ページのOGPは共通静的画像へ寄せる。
10. Vercel Analytics / Upstash Redis は未使用・外部依存削減のため削除し、検索の簡易rate limitはメモリ方式にする。
11. Remote MCP は公開サイト本体から削除し、個人用 `mcp-server/` または将来の別Workerへ分離する。

OpenNext preview上では、未生成の動的SSRページも 200 で返せるようにする。
無料運用を優先する範囲では、書き込み可能なISRキャッシュを前提にせず、主要データは静的アセットまたは GitHub Raw fallback で読む。

確認済みの生成物:

| 生成物 | サイズ | 用途 |
|---|---:|---|
| `site/data/_search-index.json` | 約19.2MB | 既存Next.js runtime向けの軽量議題index |
| `site/public/generated/search-index.json` | 約22.6MB | Cloudflare検索API用 |
| `site/public/generated/topics-index.json` | 約0.8MB | トピック詳細のクライアント表示用 |
| `site/public/generated/open-data/members/*.csv` | 約1.5MB | 議員名簿CSVの静的配信用 |
| `site/data/municipalities.json` | 約52KB | アプリ同梱の自治体メタデータ |

初期の `npm run cf:build` では 2,333 ページを生成していた。
追加削減後は 618 ページまで減り、静的生成部分は直近のローカル検証で約45-75秒で完了している。
Cloudflare 側のGit連携buildを使う場合の20分目安にも十分収まる見込み。
Next.js のルート一覧上、公開サイト本体の動的APIは `/api/search` のみ。
ただし Next.js 16 では `middleware` ファイル名が将来非推奨の警告を出す。
`proxy.ts` は現時点の OpenNext Cloudflare では Node runtime 扱いになり build 失敗したため、Cloudflare互換を優先して `middleware.ts` を継続する。

## 2026-05-31 公式制限の確認

無料運用の判断に使う前提は変わり得るため、設定変更や本番移行前に Cloudflare 公式ドキュメントを再確認する。
2026-05-31 時点では次を前提にした。

| 項目 | 公式上の前提 | このリポジトリでの対応 |
|---|---|---|
| Workers Free requests | 100,000 requests/day | 動的にWorkerへ当てる入口を絞り、公開サイト本体の動的APIは `/api/search` 中心にする |
| Workers Free CPU | 10ms CPU time / invocation | 議事録詳細・議員詳細などは大きな処理を避け、静的データまたは GitHub Raw fallback を読む |
| Static Assets requests | static assets requests は無料・無制限 | 検索index、CSV、OGP画像などは静的アセット化する |
| Static Assets files | Free は 20,000 files / Worker version、単体25MiB | `cf:check` で推定ファイル数・単体25MiB超・重い画像フォルダ混入を止める |
| Pages build | Free は月500 build、20分timeout | 初回移行では Git連携Preview乱発を避け、手元の `cf:preflight` 済み成果物を upload する |

参照:

- Cloudflare Workers Pricing: https://developers.cloudflare.com/workers/platform/pricing/
- Cloudflare Workers Limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare Workers Static Assets Billing and Limitations: https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- Cloudflare Pages Limits: https://developers.cloudflare.com/pages/platform/limits/

## 2026-05-31 追加削減

無料運用で詰まりやすい「ファイル数」と「アップロード対象サイズ」をさらに削るため、次の変更を入れた。

1. 予算書ページ画像は Cloudflare static assets に載せず、GitHub Raw URL で表示する。
2. 旧 `/budgets/{city}/{year}/pages/*.webp` URL は GitHub Raw へ 308 転送する。
3. 議員写真も Cloudflare static assets に載せず、GitHub Raw URL で表示する。
4. 旧 `/members/{city}/seat_*.jpg` URL は GitHub Raw へ 308 転送する。
5. OpenNext build 後に `.open-next/assets/budgets` と `.open-next/assets/members` を削除する `scripts/prune-cloudflare-assets.mjs` を追加する。
6. 議事録詳細・議員詳細・テーマ詳細は request-time render にし、Cloudflare の読み取り専用 incremental cache へ書き込まない。
7. 議事録詳細・議員詳細・構造化議事録の remote fallback は GitHub Raw を `no-store` で読む。
8. `cf:verify` で読み取り専用 cache への書き込みログを検出したら失敗させる。
9. 非本番ホストには `X-Robots-Tag: noindex, nofollow` を付け、`/robots.txt` も `Disallow: /` にして、検証URLの検索露出を抑える。

追加検証:

| 検証 | 結果 | メモ |
|---|---|---|
| `npm run lint` | 成功 | 追加変更後 |
| `npm run cf:build` | 成功 | 静的生成は 618 ページ、約45-75秒。Cloudflare build check も成功 |
| `/hakodate` | 200 | 議員写真URLは GitHub Raw に差し替え済み |
| `/hakodate/members/1` | 200 | 議員詳細も GitHub Raw 画像で表示 |
| `/members/hakodate/seat_1.jpg` | 308 | GitHub Raw へ転送 |
| `/chitose/budgets/2026` | 200 | 画像URLは GitHub Raw に差し替え済み |
| `/budgets/chitose/2026/pages/page-001.webp` | 308 | GitHub Raw へ転送 |
| `/hakodate/members/1` | 200 | 議員写真URLは GitHub Raw に差し替え済み |
| `/asahikawa/members/1` | 200 | 事前生成対象外の議員詳細も GitHub Raw fallback で表示可能 |
| `/topics/u-e5ae9ae4be8be4bc9a` | 200 | 事前生成対象外テーマも動的表示可能 |
| `/asahikawa/minutes/312` | 200 | 事前生成対象外の議事録詳細も動的表示可能 |
| `/api/search?q=予算` | 200 | 検索APIは継続動作 |
| `/api/search?q=予算` 連続実行 | 200 | Cloudflare 上では `x-gikai-search-mode: client` を返し、ブラウザ側で静的検索インデックスを処理 |
| privacy policy | 更新 | Vercel固定表記をやめ、Cloudflare / GitHub Raw 配信を反映 |
| `docs/cloudflare-deploy-runbook.md` | 作成 | 検証用サブドメインから本番切替までの手順 |
| `cf:upload` / `cf:deploy` | 追加 | preflight済み成果物を使ってアップロード/デプロイする導線 |
| `cf:check` | 追加 | OpenNext runtime entry のgzipサイズ、assets/cache のファイル数・サイズ・25MiB超・画像フォルダ混入を自動検査 |
| `cf:check` の漏れ防止 | 追加 | `.open-next` / `.wrangler` / `public/generated` / `.env` / key系ファイル / 戻してはいけないAPIや依存が追跡対象に混ざったら停止 |
| `cf:smoke` | 追加 | preview URL / 検証用サブドメインで主要ページ・検索・転送・404を自動確認 |
| `cf:verify` | 追加 | lint、Cloudflare build、local preview、smoke を一括実行 |
| `cf:dry-run` | 追加 | OpenNext cache assets を詰めたうえで、Cloudflareへアップロードせず Wrangler deploy構成だけ確認 |
| `cf:preflight` | 追加 | 1回のbuildで preview smoke と `wrangler deploy --dry-run` まで確認し、外部反映前の確認を1コマンド化 |
| `cf:release-status` | 追加 | 現在の preflight スタンプと `.open-next` 成果物、Cloudflare認証、deploy前のURL検証ゲートを分けて確認 |
| `cf:dns-status` | 追加 | 現在のNS、apex A/CNAME、`www` CNAME、Vercel/Cloudflare応答、Worker検証URL、次のDNS切替手順を表示 |
| `cf:upload` / `cf:deploy` 安全ゲート | 追加 | `CLOUDFLARE_RELEASE_CONFIRM` と直近preflightスタンプがない外部反映を停止。再buildせず、preflightで確認済みの `.open-next` 成果物を使う |
| `cf:upload-verify` | 追加 | ログイン後に `--preview-alias staging` 付きで upload、検証URL smoke、release log 生成まで進める一括導線。`CLOUDFLARE_RELEASE_CONFIRM=upload-and-verify` がない限り停止 |
| `cf:verify-url` | 追加 | upload後の Workers URL / 検証用サブドメインを smoke し、`.open-next/cloudflare-url-verification.json` にローカル証跡を残す |
| `cf:release-log-entry` | 追加 | preflight / URL検証stampから `docs/cloudflare-release-log.md` 用の記録案を生成。ローカル準備記録の追記は `--allow-local` を明示 |
| Worker Preview URL | 有効化 | `wrangler.jsonc` の `preview_urls: true` を維持し、`cf:upload-verify` が本番deploy前に preview alias を smoke-test できるようにする |
| Staging Worker | 追加 | 現アカウントでは Worker Preview URL が利用できないため、`chihougikai-com-staging` の workers.dev URLで本番前検証する |
| `cf:verify-url` の本番ホスト保護 | 追加 | 既存本番の Vercel 側を検証証跡にしないよう、`chihougikai.com` / `www.chihougikai.com` は `--allow-production-host` がない限り拒否する |
| `cf:deploy` のURL検証ゲート | 追加 | 現在のpreflight fingerprintと一致する `cf:verify-url` 証跡がない限り、本番反映を停止 |
| 外部反映の負方向テスト | 成功 | confirmなしの `cf:upload-verify`、本番hostへの通常 `cf:verify-url`、ローカルURL検証だけでの `cf:deploy` がすべて停止 |
| `npm run cf:dry-run` | 成功 | `wrangler deploy --dry-run` で外部反映なしに構成確認 |
| `npm run cf:release-status` | 認証待ちを検出 | preflight スタンプと `.open-next` 成果物に加え、Cloudflare 認証も確認する。deploy前のURL検証はローカルURLだけでは通さない。`wrangler whoami` が未ログインの場合は、外部 upload 前に `npm run cf:login` または `CLOUDFLARE_API_TOKEN` を促して終了 |
| preview noindex | 追加 | 非本番ホストに `X-Robots-Tag: noindex, nofollow` を付与し、`/robots.txt` は `Disallow: /` |
| `npm run cf:smoke -- --base http://localhost:8787` | 成功 | ローカル preview で主要ページ・検索・sitemap・robots・OGP・転送・404を確認 |
| `cf:smoke` のrobots判定 | 成功 | 本番ホストでは indexable、検証ホストでは noindex を期待するように変更 |
| `cf:smoke` のsecurity headers判定 | 成功 | CSP、HSTS、Referrer-Policy、Permissions-Policy、nosniff、X-Frame-Options を確認 |
| Smart Placement | 無効 | 無料運用では必須でないため `wrangler.jsonc` から削除 |

## 2026-05-31 Cloudflare ステージング検証

Cloudflare へログイン後、既存本番ドメインには触らず、別 Worker の `chihougikai-com-staging` へデプロイして確認した。

検証URL:

- `https://chihougikai-com-staging.yohei-218.workers.dev`

分かったこと:

1. この Cloudflare アカウントでは `wrangler preview` が Worker Previews の権限不足で使えない。
2. 既存 `chihougikai-com` Worker は workers.dev / preview が無効だったため、本番前検証には別名の staging Worker を使う。
3. `/api/search` は検索インデックスが大きいため、Cloudflare 上では Worker で全文検索せず、軽い `clientSearchRequired` 応答を返してブラウザ側で静的検索インデックスを処理する。
4. 検索APIの連続アクセスは `x-gikai-search-mode: client` で 3回連続 200 を確認した。
5. `cf:smoke` は通常ページに加えて `/api/search?q=予算` の連続実行も確認する。

ステージングで通した主な確認:

| 検証 | 結果 | メモ |
|---|---|---|
| `npm run cf:preflight` | 成功 | lint、Cloudflare build、local preview、smoke、dry-run が通過 |
| `npx opennextjs-cloudflare deploy --config wrangler.staging.jsonc` | 成功 | `chihougikai-com-staging` に反映 |
| `npm run cf:verify-url -- --base https://chihougikai-com-staging.yohei-218.workers.dev` | 成功 | ページ、動的詳細、検索、sitemap、robots、OGP、旧URL転送、非公開API 404 を確認 |
| 検索API連続実行 | 成功 | `x-gikai-search-mode: client` で 200 を返す |
| 検索画面 | 成功 | ローカルCloudflare相当環境で `/search?q=予算` が 4,804 件を表示。React error 0件 |

注意:

- ステージングWorkerへのアップロードは、build ID が変わると cache asset も新規扱いになり、数百ファイルのアップロードになる。これは後続の運用改善候補。
- 本番 `chihougikai.com` へのDNS切替は、ステージング確認とは別ステップとして扱う。2026-06-01にCloudflare Free zone作成とVercel側nameserver変更まで実施し、公開DNSは伝播待ち。
- 現在のWrangler OAuthでは Cloudflare zone作成権限がなく、APIで `chihougikai.com` を作ると `com.cloudflare.api.account.zone.create` 不足で403になる。そのためzone追加とWorker routesはDashboardで実施した。

削減後の OpenNext 成果物:

| 項目 | 削減前 | 削減後 |
|---|---:|---:|
| 静的生成ページ数 | 2,333 | 618 |
| `.open-next/cache` | 約1.3GB | 約279MB |
| `.open-next/assets` build後 | 約197MB | 約25MB |
| `.open-next/assets` build後ファイル数 | 約1,485 | 約220 |
| 推定アップロード量 | 約1.5GB / 約3,822件 | 約304MB / 約718件 |
| `.open-next/assets` preview後 | 約1.5GB | 約305MB |
| `.open-next/assets` preview後ファイル数 | 約3,822 | 約718 |
| 議事録詳細cache | 約745MB / 626件 | 0MB / 0件 |
| テーマ詳細cache | 約236MB / 991件 | 0MB / 0件 |
| 予算書cache | 約68MB / 13件 | 約68MB / 13件 |

予算書画像と議員写真は `site/public/budgets` / `site/public/members` には残す。
これは、GitHub Raw から参照できる原本確認用データとして必要なため。
ただし Cloudflare static assets には載せない。
OpenNext preview / deploy 時に作られる `cdn-cgi/_next_cache` は、プリレンダー済みページを Workers static assets から読むために必要なので削除しない。

## 2026-06-01 本番DNS切替と検証

Cloudflare Dashboard と Vercel Dashboard で、本番ドメインを無料運用へ寄せるためのDNS切替を開始した。

完了済み:

1. Cloudflare Free zone として `chihougikai.com` を追加。
2. Zone ID `c1b5d931ad20770b345b378fff416a22` を確認。
3. Cloudflare assigned NS `adi.ns.cloudflare.com` / `david.ns.cloudflare.com` を確認。
4. DNS scanで既存のapex / `www` / wildcard / CAA / `_domainconnect` recordsを取り込み。
5. Worker routes `chihougikai.com/*` / `www.chihougikai.com/*` を `chihougikai-com` に紐付け。
6. Vercel domain settingsでnameserversをCloudflare assigned NSへ変更。
7. Cloudflare側で `I updated my nameservers` を実行し、`Waiting for your registrar to propagate your new nameservers` 状態になったことを確認。

検証済み:

- 通常解決、1.1.1.1、8.8.8.8 のいずれも Cloudflare nameservers を返す。
- `https://chihougikai.com` と `https://www.chihougikai.com` は Cloudflare 応答で 200。
- `npm run cf:finalize-production` が通過し、robots / sitemap / search / GitHub Raw画像 / 旧URL転送 / 非公開API 404 を確認。
- 本番 Worker Version ID は `6cb22188-6266-4910-b49c-7c3fea062467`。
- `/asahikawa/minutes/312` のような大きい議事録詳細は、Workerで本文JSONを展開せずブラウザ側でGitHub Rawを読み込む方式に変更し、200を確認。
- `/news` に 2026-06-01 の配信基盤更新を反映済み。

次にやること:

1. Cloudflare metrics と Search Console を数日確認する。
2. 問題があればVercel側 nameservers `ns1.vercel-dns.com` / `ns2.vercel-dns.com` へ戻す。
3. 安定後にVercel側の本番運用を整理する。

メモ:

- `wrangler.jsonc` へ `routes` を固定するとローカルpreflightの非本番noindex検証と衝突したため、現時点ではDashboard上のWorker routesとして管理する。
- DNS伝播完了後、`chihougikai.com` をCloudflare本番として検証済み扱いにした。

## 現状メモ

2026-05-30から2026-05-31時点のローカル実測。

| 項目 | 現状 |
|---|---:|
| `site/data` | 約1.1GB |
| `site/public` | 約358MB |
| `data` | 約2.1GB |
| `site/data` + `site/public` ファイル数 | 15,622 |
| 24MB超の公開候補ファイル | なし |
| OpenNext assets build後 | 約24MB / 約220ファイル |
| OpenNext runtime entries | server handler gzip 約1.1MiB、middleware handler gzip 約94KiB |
| OpenNext 推定アップロード量 | 約304MB / 約718ファイル |
| Wrangler asset entries（cache詰込後） | 約893 entries |
| Next.js | 16.2.6 |
| React | 19.2.4 |
| 主要API | `/api/search` |
| Vercel依存パッケージ | なし |
| 外部データfallback | GitHub Raw URL |

ローカルの `site/data` + `site/public` はファイル数が多いが、OpenNext のアップロード対象は大幅に絞れている。
Cloudflare に載る static assets のファイル数は、preview後でも20,000件上限から十分余裕がある。
単体ファイル25MiB制限にも、現時点では引っかかっていない。

## 推奨コミット分割

差分が大きいため、レビュー時は次の単位に分ける。

1. Cloudflare 実行基盤
   - OpenNext / Wrangler 設定、package scripts、Cloudflare検証スクリプト、preflight安全ゲート、robots/middleware、GitHub Raw配信、静的検索index、静的CSV、削除した公開API。
   - 主な対象:
     - `site/package.json`, `site/package-lock.json`, `site/open-next.config.ts`, `site/wrangler.jsonc`
     - `site/scripts/build-search-index.mjs`, `site/scripts/build-public-open-data.mjs`, `site/scripts/check-cloudflare-build.mjs`, `site/scripts/cloudflare-*.mjs`, `site/scripts/confirm-cloudflare-release.mjs`, `site/scripts/prune-cloudflare-assets.mjs`, `site/scripts/smoke-cloudflare.mjs`, `site/scripts/verify-cloudflare-local.mjs`, `site/scripts/verify-cloudflare-url.mjs`
     - `site/src/middleware.ts`, `site/src/app/robots.txt/`, `site/src/lib/indexing.ts`, `site/src/lib/publicRawUrl.ts`, `site/src/lib/staticAssetFetch.ts`, `site/src/lib/memberPhotos.ts`, `site/src/lib/topicAliases.ts`, `site/src/components/TopicRecordsClient.tsx`
     - `site/src/app/api/search/route.ts`, 削除済みの `/api/like*`, `/api/mcp`, `/api/og-*`, `/api/export/members`
     - GitHub Raw / request-time render / static CSV / OGP代替に関係する `site/src/app/`, `site/src/components/`, `site/src/lib/` の変更
2. 公開サイト本文・運用ツール
   - README、privacy、runbook、release checklist、Cloudflare migration checklist、MCP旧案整理、Notion/オープンデータ文書のホスティング中立化、公開データ同期後の運用リマインド、月次確認・未公開議事録再確認の小さな運用スクリプト。
   - 主な対象:
     - `README.md`, `docs/add-municipality-workflow.md`, `docs/cloudflare-deploy-runbook.md`, `docs/cloudflare-migration-checklist.md`, `docs/release-checklist.md`
     - `docs/open-data-policy.md`, `docs/editorial/notion-articles-cms.md`
     - `docs/operations-principles.md`
     - `docs/mcp-*`, `mcp-server/REMOTE.md`, `mcp-server/index.mjs`
     - `scripts/sync-site-data.mjs`, `scripts/onboard-municipality.mjs`, `scripts/operations-check.mjs`, `scripts/list-stale-minutes-verifications.mjs`, `scripts/generate-information-inventory.mjs`
     - `scripts/lib/budget-source-reminders.mjs`, `scripts/lib/minutes-verification-categories.mjs`, `scripts/lib/public-data-reminders.mjs`
     - `site/src/app/privacy/page.tsx`, `site/.env.example`
3. 別feature候補データ
   - 新篠津村 `publications`、`docs/minutes-expansion-candidates.md`。Cloudflare移行本体とは別コミットで扱う。
   - 主な対象:
     - `data/shinshinotsu/publications/`
     - `site/data/shinshinotsu/publications/`
     - `docs/minutes-expansion-candidates.md`
4. 雨竜町 segments データ
   - `uryu` の議事録本文から生成した `segments` と、検索index生成時のsegments fallback対象設定。Cloudflare移行本体とは別コミットで扱う。
   - 主な対象:
     - `data/uryu/segments/`
     - `site/data/uryu/segments/`
     - `site/data/search_segment_fallbacks.json`
5. 運営ボード
   - Cloudflare、月次レビュー、新篠津村、雨竜町のDone/Nowが同居しているため、保存時は必要なら部分stageする。
   - 主な対象:
     - `docs/operations-board.md`

注意:

- `docs/operations-board.md` は Cloudflare のNow更新、月次レビュー、新篠津村、雨竜町のDone整理が同居しているため、コミット時は必要なら該当行だけ分けてステージする。
- `site/data/news.json` は、検証用サブドメイン公開時または本番切替時に別途追記する。ローカル検証だけでは利用者向けニュースにしない。
- 外部反映前の最終確認は `npm run cf:preflight` と `npm run cf:release-status`。後者が Cloudflare 未認証で止まる場合は `npm run cf:login` が先。
- ログイン後の標準手順は `CLOUDFLARE_RELEASE_CONFIRM=upload-and-verify npm run cf:upload-verify`。URLを自動検出できない場合だけ `--base <URL>` を付ける。
- `cf:verify-url` は本番DNS切替前の `https://chihougikai.com` を証跡にしない。DNS切替後の本番確認だけ `--allow-production-host` を付ける。
- 本番切替後の短期監視は `node scripts/operations-check.mjs --cloudflare` で概要を見て、`npm run cf:post-cutover-check` で公開ホスト smoke まで通す。必要に応じて `npm run cf:dns-status` / `npm run cf:release-status` で切り分ける。
- 検証URL・本番DNS切替・rollback可否は `docs/cloudflare-release-log.md` に残す。

現在の未コミット差分に対する推奨保存順は、`node scripts/review-cloudflare-migration.mjs --commit-plan` で再生成できる。
2026-06-01時点の分類は Cloudflare本体70ファイル、公開本文・運用ツール30ファイル、新篠津村publications3ファイル、雨竜町segments23ファイル、部分stage対象1ファイル。
保存前の直近確認は、`git diff --check`、`node scripts/review-cloudflare-migration.mjs --markdown`、`node scripts/operations-check.mjs --cloudflare`、`cd site && npm run cf:post-cutover-check` を通す。
次に外部へ再反映する場合だけ、改めて `cd site && npm run cf:preflight` と `cd site && npm run cf:release-status` を取り直す。

## レビュー用ファイルマップ

差分確認時は、次の観点で読むと抜け漏れを見つけやすい。

| 観点 | 見る場所 | 確認すること |
|---|---|---|
| Cloudflare 実行設定 | `site/open-next.config.ts`, `site/wrangler.jsonc`, `site/next.config.ts`, `site/package.json` | OpenNext / Wrangler の入口、低コスト設定、build script が `prune` と `cf:check` を通ること |
| 外部反映ゲート | `site/scripts/confirm-cloudflare-release.mjs`, `site/scripts/cloudflare-upload-and-verify.mjs`, `site/scripts/cloudflare-preflight-stamp.mjs` | preflight stamp、artifact fingerprint、Cloudflare auth、URL検証なしでは upload/deploy が進まないこと |
| build サイズ監視 | `site/scripts/check-cloudflare-build.mjs`, `site/scripts/prune-cloudflare-assets.mjs` | heavy画像混入、25MiB超、runtime gzipサイズ、推定upload量、追跡禁止ファイルを検知すること |
| preview smoke | `site/scripts/smoke-cloudflare.mjs`, `site/scripts/verify-cloudflare-local.mjs`, `site/scripts/verify-cloudflare-url.mjs` | 主要ページ、検索、robots、sitemap、画像転送、旧URL redirect、削除API 404 を確認すること |
| 静的データ化 | `site/scripts/build-search-index.mjs`, `site/scripts/build-public-open-data.mjs`, `site/src/app/api/search/route.ts` | 検索indexとCSVが静的生成され、Workerで毎回大きな加工をしないこと |
| GitHub Raw fallback | `site/src/lib/publicRawUrl.ts`, `site/src/lib/staticAssetFetch.ts`, `site/src/lib/memberPhotos.ts`, `site/src/lib/budgetPages.ts` | 議員写真・予算画像・古い大きなJSONを Cloudflare assets に載せないこと |
| noindex / robots | `site/src/lib/indexing.ts`, `site/src/middleware.ts`, `site/src/app/robots.txt/route.ts` | 検証URLは noindex、本番 `chihougikai.com` / `www.chihougikai.com` だけ indexable になること |
| 公開API削除 | 削除済み `/api/like*`, `/api/mcp`, `/api/og-*`, `/api/export/members` | 無料運用に不要な書き込み系・重い動的APIが公開site本体から外れていること |
| 運用手順 | `docs/cloudflare-deploy-runbook.md`, `docs/cloudflare-release-log.md`, `docs/release-checklist.md` | ログイン後の `cf:upload-verify`、検証URL記録、本番DNS切替後の確認とrollbackが追えること |

レビュー前後に実行する最低限の確認:

```bash
node scripts/review-cloudflare-migration.mjs
node scripts/review-cloudflare-migration.mjs --markdown
cd site
npm run cf:preflight
npm run cf:release-status
```

`review-cloudflare-migration.mjs` は、未コミット差分を Cloudflare runtime / 公開本文・運用ツール / 別feature候補 / 部分stage対象に分類する。
未分類が出た場合は、コミット前にこの表かスクリプト側へ分類を追加する。
`--markdown` はPR説明やコミット前メモに使う短い要約を出す。
分類ごとのパスだけを取り出す場合:

```bash
node scripts/review-cloudflare-migration.mjs --paths cloudflare-runtime
node scripts/review-cloudflare-migration.mjs --paths docs-operations
node scripts/review-cloudflare-migration.mjs --paths separate-publications
node scripts/review-cloudflare-migration.mjs --paths separate-uryu-segments
```

ステージング用のコマンド案を出す場合:

```bash
node scripts/review-cloudflare-migration.mjs --git-add cloudflare-runtime
node scripts/review-cloudflare-migration.mjs --git-add docs-operations
node scripts/review-cloudflare-migration.mjs --git-add separate-publications
node scripts/review-cloudflare-migration.mjs --git-add separate-uryu-segments
node scripts/review-cloudflare-migration.mjs --git-add mixed
```

`docs/operations-board.md` は Cloudflare、月次レビュー、新篠津村、雨竜町のメモが同居しているため、分けて保存する場合は部分stageガイドを先に見る。

```bash
node scripts/review-cloudflare-migration.mjs --mixed-guide
```

保存順とコミットメッセージ案をまとめて確認する場合:

```bash
node scripts/review-cloudflare-migration.mjs --commit-plan
```

コミットメッセージ案を出す場合:

```bash
node scripts/review-cloudflare-migration.mjs --commit-message cloudflare-runtime
node scripts/review-cloudflare-migration.mjs --commit-message docs-operations
node scripts/review-cloudflare-migration.mjs --commit-message separate-publications
```

レビュー順、stage候補、コミットメッセージ案をまとめて見る場合:

```bash
node scripts/review-cloudflare-migration.mjs --commit-plan
```

`cf:release-status` が未認証で止まる状態は、外部 upload 前なら正常。認証後は `CLOUDFLARE_RELEASE_CONFIRM=upload-and-verify npm run cf:upload-verify` へ進む。

## 参照した公式情報

- Cloudflare Pages Limits: https://developers.cloudflare.com/pages/platform/limits/
- Cloudflare Workers Pricing: https://developers.cloudflare.com/workers/platform/pricing/
- Cloudflare R2 Pricing: https://developers.cloudflare.com/r2/pricing/
- Cloudflare Next.js guide: https://developers.cloudflare.com/pages/framework-guides/nextjs/
- OpenNext Cloudflare adapter: https://opennext.js.org/cloudflare

確認した要点:

- Pages Free は 1サイト20,000ファイル、単体ファイル25MiB、月500ビルド、ビルド20分制限。
- Pages Functions は Workers の課金・無料枠に入る。
- Workers Free は1日100,000リクエスト、1リクエスト10ms CPU目安。
- Workers pricing 上、静的アセットへのリクエストは無料・無制限扱い。
- R2 Free は Standard storage で 10GB-month、Class A 100万/月、Class B 1,000万/月、エグレス無料。
- OpenNext Cloudflare adapter は Next.js 16、App Router、Route Handlers、SSG、SSR、ISR をサポート対象としている。

## 移行判定

### そのまま移せそうなもの

- トップページ
- 自治体一覧
- 自治体詳細
- 議員一覧
- 議事録一覧
- 記事ページ
- ニュース
- 出典ページ
- privacy / terms
- 静的な予算書ページ
- sitemap / robots / metadata

### 検証が必要なもの

| 対象 | 懸念 | 初回判定 |
|---|---|---|
| `/api/search` | 1リクエストで読むデータ量とCPU時間 | 軽量index化が必要 |
| Remote MCP | Node.js runtime、データ同梱量、APIキー | 公開サイト本体から削除。必要なら別Workerで再設計 |
| 個別OGP画像 | 個別画像生成をAPIにすると無料枠・互換性リスクがある | 共通静的OGP画像へ代替済み |
| 動的詳細ページ | GitHub Raw fallback と読み取り専用 cache の相性 | 議事録詳細・議員詳細・テーマ詳細は request-time render で確認済み |
| Notion記事連携 | fetch + revalidate の挙動 | 静的同期または無効化も候補 |
| CSP/headers | `next.config.ts` の headers が期待通り出るか | Previewで確認 |

### 無料運用のために避けたいもの

- Cloudflare Worker 経由で毎回大きなJSONを読む検索。
- R2を画像CDNのように大量readさせる構成。
- Static Assets のファイル数20,000件上限に近いまま予算ページ画像を増やし続けること。
- 本文・OCR・segmentsをすべて Function bundle に含めること。
- Vercel用の `outputFileTracing*` を前提にしたまま、Cloudflareで同じ問題が起きないと決め打ちすること。

## Phase 0: 移行前の棚卸し

- [x] `site/data` と `site/public` の容量を再測定する。
- [x] ファイル数を再測定する。
- [x] 25MiB超のファイルがないか確認する。
- [x] API route 一覧を確認する。
- [x] `runtime = "nodejs"` / `runtime = "edge"` の利用箇所を確認する。
- [x] `@vercel/analytics` を残すか外すか決める。
- [x] `@vercel/kv` を残すか、Cloudflare KV/D1/削除にするか決める。
- [x] privacy policy の「ホスティング: Vercel」表記を移行時に変える対象として控える。
- [x] `site/data/news.json` に移行告知を出すか判断する。

完了条件:

- 移行で壊れうる箇所が一覧化されている。
- 無料枠を超えそうな要因が、ファイル数・API・R2 read の3系統で分かれている。

## Phase 1: Cloudflare preview を作る

- [x] 移行調査用ブランチを作る。
- [x] `@opennextjs/cloudflare` と `wrangler` の導入要否を確認する。
- [x] `site/package.json` に Cloudflare用 build / preview コマンドを追加する。
- [x] `wrangler.jsonc` または同等の設定ファイルを作る。
- [x] ローカルで通常の `npm run build` が通ることを確認する。
- [x] OpenNext build が通ることを確認する。
- [x] Cloudflare preview が起動することを確認する。
- [x] preview でトップ、検索、市町村、議事録、予算、記事を開く。

完了条件:

- `localhost` または Cloudflare preview URL で主要画面が開ける。
- Build 時間が20分以内に収まる見込みがある。
- Static Assets のファイル数制限に引っかかっていない。

## Phase 2: 静的ページとAPIを分けて判定する

### 静的ページ

- [x] `/`
- [x] `/search`
- [x] `/sources`
- [x] `/news`
- [x] `/articles`
- [x] `/articles/[slug]`
- [x] `/[city]`
- [x] `/[city]/members`（現行は `/{city}` が議員一覧のため、新規ルートは作らない）
- [x] `/[city]/minutes`
- [x] `/[city]/budgets`
- [x] `/topics`
- [x] `/topics/[tag]`

### API

- [x] `/api/search` は無料枠で動かすか、静的検索index方式へ寄せる。
- [x] `/api/mcp` は公開サイトとは別Workerに分けるか判断する。
  公開サイト本体から削除し、MCPは `mcp-server/` または将来の別Workerで扱う。
- [x] `/api/like` は一旦無効化できるか確認する。
- [x] `/api/og-member`, `/api/og-segment` は動かない場合、静的OGPまたは無効化で代替できるか確認する。
- [x] `/api/export/members` は静的CSV生成へ移せるか確認する。

完了条件:

- サイト本体に必須なAPIと、なくても公開継続できるAPIが分かれている。
- 無料枠を超えた場合に止める機能が決まっている。

## Phase 3: データ配置を決める

### Cloudflare static assets に置く候補

- `municipalities.json`
- `_city-capabilities.json`
- `members.json`
- `minutes/index.json`
- `sessions/index.json`
- `decisions.json`
- `publications/index.json`
- `budget_sources.json`
- `news.json`
- 軽量検索index

### R2 または GitHub Raw に逃がす候補

- 古い `minutes/*.json`
- `segments/*`
- `structured-minutes/*`
- 予算書OCRページ画像（GitHub Raw 表示 + 旧URL転送に変更済み）
- 予算書ページ単位JSON
- OCR下書き

完了条件:

- Static Assets 上限20,000ファイルを長期的に超えにくい構成になっている。
- R2 read が増えすぎるページを、必要な時だけ読む設計にできている。
- GitHub Raw fallback を残す場合、レート制限と障害時表示を確認している。

## Phase 4: 無料枠ガード

- [x] Cloudflare の Git連携 build 回数を月500回以内に抑える運用にする。
- [x] GitHub push ごとの自動Previewを必要最小限にする。
- [x] Workers Free の1日100,000 requestを超えそうなAPIを分ける。
- [x] R2 read が増えそうな予算画像、OCRページ、全文JSONにキャッシュ方針を持たせる。
- [x] Cloudflare の利用状況ダッシュボードを見る日を決める。
- [x] 無料枠超過時に Pro/Vercel に戻すのではなく、重い機能を止める順番を決める。

運用メモ:

- 外部反映前は `npm run cf:preflight` を使い、1回の build で preview smoke と dry-run まで確認する。手元確認で不要な Preview deploy を増やさない。
- Cloudflare の Git連携Previewは初回移行では使わず、手元の preflight 済み成果物を検証URLで確認する。現アカウントでは Worker Preview URL が使えなかったため、初回移行では `chihougikai-com-staging` Worker を検証URLとして使った。
- Cloudflare ダッシュボードは、検証用サブドメイン公開後1週間は毎回作業終了時に確認し、本番切替後は月次レビュー日に Workers requests / CPU time / Static Assets を見る。
- 公開サイト本体の動的APIは `/api/search` のみ。Remote MCP、like、動的OGPは本体から外し、再開する場合は別Worker等で再設計する。
- 予算画像・議員写真は Cloudflare static assets に載せず GitHub Raw 表示にする。予算書ページ単位JSONや古い議事録本文も、必要時読み込み・GitHub Raw fallback を前提にする。

停止順の候補:

1. 予算OCR画像の追加拡大を止める。
2. テーマ詳細の事前生成数を減らす。
3. 議事録詳細の事前生成数を減らす。
4. `/api/search` の返却件数またはレート制限を絞る。
5. Remote MCP は公開サイト本体に戻さず、別Workerやローカルstdioだけに限定する。

## Phase 5: 本番切替チェック

- [x] `npm run cf:release-status` で preflight と Cloudflare 認証を確認する。
- [x] 本番切替前に `npm run cf:dns-status` で、公開ドメインがまだVercel DNSであることとWorker検証URLが生きていることを確認する。
- [x] `chihougikai-com-staging` Worker で本番前の検証URL smoke を行う。
- [x] 検証用URLは noindex / robots `Disallow: /` で公開し、本番URLとは分けて扱う。
- [x] Search Console に検証用URLを登録するか判断する。
- [x] canonical が本番URLに固定されすぎていないか確認する。
- [x] robots.txt が preview を index させない設定になっているか確認する。
- [x] sitemap が期待通り生成されるか確認する。
- [x] OGP画像が出るか確認する。
- [x] CSP、HSTS、Referrer-Policy、Permissions-Policy を確認する。
- [x] privacy policy のホスティング表記を更新する。
- [x] Cloudflare 本番移行 runbook を作る。
- [x] `site/data/news.json` に移行情報を載せるか決める。
- [x] DNS切替後、Vercel側を即削除せずロールバック期間を置く。

`site/data/news.json` は、本番切替時に 2026-06-01 の配信基盤更新として追記済み。ローカル検証段階では、利用者向けの更新情報としては出さない。
検証用URLは noindex 前提のため Search Console には登録せず、本番ドメイン切替後に Search Console のクロールエラーを見る。
canonical は `buildPageMetadata` でページごとのパスに設定し、preview は noindex と robots `Disallow: /` で検索露出を抑える。
sitemap は本番URLのまま生成し、旧日本語トピックURLではなく ASCII トピックURLを載せる。

完了条件:

- 主要ページがCloudflare上で表示できる。
- 検索とMCPの扱いが決まっている。
- 無料枠を超えそうな箇所を止める手順がある。
- 本番ドメインを切り替えても戻せる状態になっている。

## 判断

2026-06-01時点で、公開サイト本体は Cloudflare Workers / Static Assets へ切替済み。
無料運用を優先するため、成功条件は「全機能をVercel時代のまま残すこと」ではなく、「公開サイトとして必要な情報が見られ、重い機能を止めても破綻しないこと」とする。

切替後の短期判断:

1. `node scripts/operations-check.mjs --cloudflare`、Cloudflare metrics、Search Console URL-prefix property `https://chihougikai.com/` を数日確認する。
2. 問題がなければ Vercel 側の本番運用を整理する。
3. 問題があれば Vercel nameservers へ戻せる状態を維持する。
