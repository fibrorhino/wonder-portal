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

  // Do not announce the framework in every response.
  poweredByHeader: false,

  // The app has one image, a plain <img>. Next's Image Optimization endpoint
  // (/_next/image) is on by default all the same, and it is where several of
  // the 2026 remote-code-execution advisories against Next were found. Nothing
  // here uses it, so it is switched off rather than left listening.
  images: { unoptimized: true },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Browsers must not guess a content type other than the one sent.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // A link out of the site carries the origin, never the path.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // The site asks for none of these, so no script running in it can.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          // HTTPS only, for six months. Browsers ignore this over plain HTTP,
          // so local development on http://localhost is unaffected.
          { key: "Strict-Transport-Security", value: "max-age=15552000" },
        ],
      },
    ];
  },
};

export default nextConfig;
