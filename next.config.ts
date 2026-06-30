import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output: Next.js bundles only what's needed to run the server.
  // The Docker image copies .next/standalone + .next/static — no node_modules
  // in the final image, much smaller container.
  output: "standalone",

  // Raw data files in data/raw/ are never served — only public/ (lowercase)
  // is shipped. Next.js ignores everything outside public/ automatically.
};

export default nextConfig;
