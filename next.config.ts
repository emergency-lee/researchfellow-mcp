import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the tracing root to this project — a parent-dir lockfile would otherwise
  // be inferred as the workspace root and mis-scope Vercel build traces.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
