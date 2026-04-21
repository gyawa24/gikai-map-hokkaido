import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Serverless Function の 250MB 制限対策。
  // 各 Function が必要とするデータだけ残し、それ以外を除外する。
  //
  // 注意: picomatch でキーが glob 評価されるため `[city]` はキャラクタクラス扱いになる。
  //       動的ルートをターゲットにする時は `/**/themes` のようにワイルドカードを使うこと。
  //       `**` をキーにすると全 Function に適用され、データを必要とする Function まで
  //       巻き添えで壊すので使わない。
  outputFileTracingExcludes: {
    // /api/search は 250MB 制限の都合、minutes 本文（202MB）は除外。
    // sessions + members + decisions + election + minutes/enriched の要約のみで検索。
    // TODO(ogawa): 本当は build 時に軽量 search index を作って full-text 検索を復活させる
    "/api/search": [
      "./data/*/minutes/*.json",
      "./data/*/???.json",
      "./data/*/????.json",
      "./data/*/newsletter.json",
      "./data/*/schedule.json",
      "./data/*/comprehensive_plan.json",
      "./data/*/*_activity.json",
      "./data/*/index.json",
    ],
    // /api/og-segment は sessions + members だけ必要。minutes (202MB) を除外する。
    "/api/og-segment": [
      "./data/*/minutes/**/*",
      "./data/*/???.json",
      "./data/*/????.json",
      "./data/*/newsletter.json",
      "./data/*/schedule.json",
      "./data/*/comprehensive_plan.json",
      "./data/*/decisions.json",
      "./data/*/election.json",
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
        ],
      },
    ];
  },
};

export default nextConfig;
