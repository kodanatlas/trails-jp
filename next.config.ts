import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // /a/[name] の OG 画像生成で使う日本語フォントをサーバーレス関数のトレースに含める
  // （キーは glob として解釈されるため [name] のブラケットをエスケープ）
  outputFileTracingIncludes: {
    "/a/\\[name\\]/opengraph-image": ["./assets/fonts/**"],
  },
  headers: async () => [
    {
      source: "/sw.js",
      headers: [
        {
          key: "Cache-Control",
          value: "no-cache, no-store, must-revalidate",
        },
        {
          key: "Service-Worker-Allowed",
          value: "/",
        },
      ],
    },
  ],
};

export default nextConfig;
