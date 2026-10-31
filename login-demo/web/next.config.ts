import type { NextConfig } from "next";
const development = process.env.NODE_ENV === "development";
const backend = process.env.TRADE_BACKEND || "http://127.0.0.1:8017";
const config: NextConfig = {
  devIndicators: false,
  images: { unoptimized: true },
  ...(development
    ? {
        rewrites: async () => [
          { source: "/api/:path*", destination: `${backend}/api/:path*` },
          { source: "/original-static/:path*", destination: `${backend}/original-static/:path*` },
        ],
      }
    : { output: "export" }),
};
export default config;
