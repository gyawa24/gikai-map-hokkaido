import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    outputFileTracingIncludes: {
      "/**": ["./data/**/*"],
    },
  },
};

export default nextConfig;
