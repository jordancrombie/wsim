import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployment
  output: "standalone",
  // Set turbopack root to prevent workspace inference warning
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
