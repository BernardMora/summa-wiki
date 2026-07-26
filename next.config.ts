import type { NextConfig } from "next";

const config: NextConfig = {
  // Local-only tool: the vault lives outside the project root, and the server
  // reads it with fs at request time. Nothing is bundled or uploaded.
  eslint: { ignoreDuringBuilds: true },
};

export default config;
