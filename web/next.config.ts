import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: { root: process.cwd() },
  // Forwarded browser logs are written to .next/dev/logs; on Windows that write retriggers the
  // dev watcher, so every page load caused a rebuild and a full reload in a loop.
  logging: { browserToTerminal: false },
};

export default nextConfig;
