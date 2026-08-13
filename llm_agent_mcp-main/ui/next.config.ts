import type { NextConfig } from "next";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const NOAT_API_URL = "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/api/noat/health",
        destination: `${NOAT_API_URL}/health`,
      },
      {
        source: "/api/noat/:path*",
        destination: `${NOAT_API_URL}/api/v1/:path*`,
      },
      {
        source: "/api/:path*",
        destination: `${API_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
