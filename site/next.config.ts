import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/search": ["./data/**/*"],
    "/api/ai-search": ["./data/**/*"],
    "/api/debug": ["./data/**/*"],
  },
};

export default nextConfig;
