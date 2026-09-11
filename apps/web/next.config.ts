import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const configDir = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(configDir, "package.json"), "utf8")) as { version: string };
// ponytail: Pi's version is daemon-owned now (SDK dep removed from web). The
// UI label mirrors the daemon's pinned @earendil-works/pi-coding-agent — bump
// alongside ../daemon/package.json when the SDK upgrades.
const PI_VERSION = "0.84.2";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: configDir,
  serverExternalPackages: ["undici"],
  allowedDevOrigins: ["127.0.0.1", "192.168.*.*"],
  webpack: (config, { isServer }) => {
  if (isServer) {
    const existing = config.externals ?? [];
    const list = Array.isArray(existing) ? existing : [existing];
    config.externals = [...list, { undici: 'commonjs undici' }];
  }
  return config;
},
  async headers() {
    return [
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "private, no-cache, max-age=0, must-revalidate" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_PI_VERSION: PI_VERSION,
  },
};

export default nextConfig;
