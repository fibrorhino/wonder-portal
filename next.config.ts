import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output (a self-contained .next/standalone/server.js that needs
  // no node_modules) is ONLY for the container build — the Dockerfile sets
  // BUILD_STANDALONE=1. It must not be on by default: Next refuses to support
  // `next start` alongside it ("next start does not work with output:
  // standalone"), and the Windows service on the always-on host runs exactly
  // that command.
  ...(process.env.BUILD_STANDALONE === "1" ? { output: "standalone" as const } : {}),

  // Development builds go to .next-dev, not .next.
  //
  // On the always-on host the WonderPortal service is serving the production
  // .next while development happens in the same working copy. Sharing one
  // build directory lets `next dev` overwrite manifests the running service
  // reads (routes start 404ing in dev, and the live site is at risk), so the
  // two are kept apart. `next dev` sets NODE_ENV=development; `next build`
  // and `next start` do not, so production still uses .next.
  ...(process.env.NODE_ENV === "development" ? { distDir: ".next-dev" } : {}),

  // NEXT_DIST_DIR overrides both of the above. Its purpose is a throwaway
  // production build that verifies the code compiles WITHOUT overwriting the
  // .next the live service is serving:
  //   NEXT_DIST_DIR=.next-validate npx next build
  // Leave it unset for the real deploy build.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default nextConfig;
