import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output (a self-contained .next/standalone/server.js that needs
  // no node_modules) is ONLY for the container build — the Dockerfile sets
  // BUILD_STANDALONE=1. It must not be on by default: Next refuses to support
  // `next start` alongside it ("next start does not work with output:
  // standalone"), and the Windows service on the always-on host runs exactly
  // that command.
  ...(process.env.BUILD_STANDALONE === "1" ? { output: "standalone" as const } : {}),
};

export default nextConfig;
