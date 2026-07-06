import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output: Next.js bundles only what's needed to run the server.
  // The Docker image copies .next/standalone + .next/static — no node_modules
  // in the final image, much smaller container.
  output: "standalone",

  // pdf-parse v1 uses fs.readFileSync for test fixtures at require() time,
  // which breaks when webpack bundles it. Marking it external forces Next.js
  // to require() it at runtime from node_modules instead of bundling it.
  serverExternalPackages: ["pdf-parse"],
};

export default nextConfig;
