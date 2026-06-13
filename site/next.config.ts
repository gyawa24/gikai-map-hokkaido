import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1"],
  staticPageGenerationTimeout: 300,
  // 低コアの無料/標準ビルド環境では、デフォルト cpus = (cores - 1) だと
  // static generation が極端に遅くなる。明示的に2コアを使い、1 worker 内の
  // 並列度も上げる（デフォルト 8 → 16）。
  experimental: {
    cpus: 2,
    staticGenerationMaxConcurrency: 16,
  },
  // Serverless Function の 250MB 制限対策。
  // 各 Function が必要とするデータだけ残し、それ以外を除外する。
  //
  // 注意: picomatch でキーが glob 評価されるため `[city]` はキャラクタクラス扱いになる。
  //       動的ルートをターゲットにする時は `/**/themes` のようにワイルドカードを使うこと。
  //       `**` をキーにすると全 Function に適用され、データを必要とする Function まで
  //       巻き添えで壊すので使わない。
  outputFileTracingExcludes: {
    // 全 Function 共通で除外する「どの dynamic/ISR route でも実行時には不要」なもの。
    // - minutes 本文: `[city]/minutes/[id]` は recent N のみプリレンダし、古い本文は
    //   必要時に GitHub Raw fallback で読む。
    // - segments 本文: AI検索/テーマ生成用の発言単位データ。公開 Function の実行時には
    //   直接読まないため、関数バンドルへ含めない。
    // - budgets 本文・ページ画像: 予算書ページは静的生成し、実行時 Function では読まない。
    // - structured-minutes: 構造化議事録は動的ビューで GitHub Raw fallback から読む。
    // - ocr_drafts: 公開昇格前の評価用下書き。常に関数バンドルから除外する。
    // - ルート直下の数字連番JSON(46MB): scraper 生データの置き場で、どの route も読まない。
    //
    // 注意: sessions/*.json と minutes/enriched/*.json はここで落とすと
    //       /api/search が壊れるので含めない。
    "**": [
      "./data/*/minutes/**/*.json",
      "./data/structured-minutes/**/*.json",
      "./data/*/segments/**/*",
      "./data/*/budgets/*/pages/**/*",
      "./public/budgets/**/*",
      "./data/*/ocr_drafts/**/*",
      "./data/*/???.json",
      "./data/*/????.json",
    ],
    // /api/search は 250MB 制限の都合、minutes 本文は上の `**` で除外済。
    // sessions + members + decisions + election + minutes/enriched の要約で検索する。
    // TODO(ogawa): 本当は build 時に軽量 search index を作って full-text 検索を復活させる
    "/api/search": [
      "./data/*/newsletter.json",
      "./data/*/schedule.json",
      "./data/*/comprehensive_plan.json",
      "./data/*/*_activity.json",
      "./data/*/index.json",
    ],
    // /[city]/themes は members + members_activity だけ必要。
    "/**/themes": [
      "./data/*/minutes/**/*",
      "./data/*/sessions/**/*",
      "./data/*/???.json",
      "./data/*/????.json",
      "./data/*/newsletter.json",
      "./data/*/schedule.json",
      "./data/*/comprehensive_plan.json",
      "./data/*/decisions.json",
      "./data/*/election.json",
      "./data/*/plan_activity.json",
      "./data/*/index.json",
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
