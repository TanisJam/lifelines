import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-hosted Docker deploy (docs: node_modules/next/dist/docs/01-app/02-guides/self-hosting.md,
  // "Automatic Copying Traced Files"): traces only the files each route needs into
  // `.next/standalone`, plus a minimal `server.js`, so the image doesn't need `node_modules`
  // installed at runtime. The Dockerfile copies `public/` and `.next/static` alongside it per the
  // docs' manual-copy step.
  output: "standalone",
};

export default nextConfig;
