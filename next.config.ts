import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit .next/standalone with a self-contained server.js, so the Docker image
  // does not need node_modules. Used by the container deployment (Dockerfile);
  // `npm run dev` and `npm start` are unaffected.
  output: "standalone",
};

export default nextConfig;
