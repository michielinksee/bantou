import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    reactCompiler: false,
  },
  // Strict mode
  reactStrictMode: true,
  // i18n preparation (Year 1 後半 SG expansion 想定、 Day 1 から ready)
  // Future: next-intl integration for ja-JP / en-SG / en-US
};

export default nextConfig;
