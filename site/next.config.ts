import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  staticPageGenerationTimeout: 300,
  // Vercel build machine は 2 cores だが、デフォルト cpus = (cores - 1) = 1 worker で
  // 7164 ページの static generation に 23分かかる。明示的に2コア使わせて短縮を狙う。
  // 加えて 1 worker 内の並列度も上げる（デフォルト 8 → 16）。
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
  // /api/mcp は議員配布用のリモートMCP。
  // グローバル excludes で落とされるデータを、明示的に戻す。
  //
  // minutes/*.json 全量は 834MB あり Vercel Function の 250MB 制限に収まらないため、
  // 当面は運用3市（chitose/eniwa/tomakomai、計115MB）のみ get_minutes_excerpt を
  // サポート。search_minutes は全市横断で _search-index.json を使うので
  // 全道で動く（返る excerpt は 80 文字前後の抜粋）。
  // TODO(ogawa): 全道対応が必要になったら minutes を Vercel Blob / R2 に退避する
  outputFileTracingIncludes: {
    "/api/mcp": [
      "./data/_search-index.json",
      "./data/municipalities.json",
      "./data/*/members.json",
      "./data/*/sessions/*.json",
      "./data/chitose/minutes/*.json",
      "./data/eniwa/minutes/*.json",
      "./data/tomakomai/minutes/*.json",
    ],
  },
  outputFileTracingExcludes: {
    // 全 Function 共通で除外する「どの dynamic/ISR route でも実行時には不要」なもの。
    // - minutes 本文: `[city]/minutes/[id]` は recent N のみプリレンダし、古い本文は
    //   必要時に GitHub Raw fallback で読む。
    // - segments 本文: AI検索/テーマ生成用の発言単位データ。公開 Function の実行時には
    //   直接読まないため、関数バンドルへ含めない。
    // - ocr_drafts: 公開昇格前の評価用下書き。常に関数バンドルから除外する。
    // - ルート直下の数字連番JSON(46MB): scraper 生データの置き場で、どの route も読まない。
    //
    // 注意: sessions/*.json と minutes/enriched/*.json はここで落とすと
    //       /api/search と /api/og-segment が壊れるので含めない。
    "**": [
      "./data/*/minutes/**/*.json",
      "./data/*/segments/**/*",
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
    // /api/export/members は members.json だけ必要。
    "/api/export/members": [
      "./data/*/minutes/**/*",
      "./data/*/sessions/**/*",
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
    // Content Security Policy
    // - Next.js は hydration 用 inline script を出すため 'unsafe-inline' を許容
    //   （nonce 化は複雑なので将来課題）
    // - Tailwind で生成される inline style 用に style-src にも 'unsafe-inline'
    // - 議員写真は各市公式サイトから配信されるため img-src は https: 全体を許可
    // - 会議録ページで YouTube 埋込を行うため frame-src に youtube.com
    // - Vercel Web Analytics のビーコン送信のため vitals.vercel-insights.com
    const scriptSrc = [
      "'self'",
      "'unsafe-inline'",
      "https://va.vercel-scripts.com",
    ];
    if (process.env.NODE_ENV !== "production") {
      scriptSrc.push("'unsafe-eval'");
    }
    const csp = [
      "default-src 'self'",
      `script-src ${scriptSrc.join(" ")}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://vitals.vercel-insights.com https://va.vercel-scripts.com",
      "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Content-Security-Policy", value: csp },
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
