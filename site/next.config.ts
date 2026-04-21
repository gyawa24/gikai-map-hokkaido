import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Serverless Function の 250MB 制限対策。
  // [city]/minutes/[id] 等の重量 [id] ページは force-static で静的化済なので
  // そもそも function 化されない。残る dynamic 系 function から minutes/sessions
  // の重いファイルを除外する。
  outputFileTracingExcludes: {
    "/api/search": [
      "./data/*/???.json",
      "./data/*/????.json",
      "./data/*/newsletter.json",
      "./data/*/schedule.json",
      "./data/*/comprehensive_plan.json",
      "./data/*/*_activity.json",
      "./data/*/index.json",
    ],
    // 以下は「本文JSONを必要としない」ルート一般に適用
    "**": [
      "./data/*/minutes/*.json",
      "./data/*/minutes/enriched/*.json",
      "./data/*/sessions/*.json",
    ],
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
    "/api/og-segment": ["./data/**/*.json"],
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
