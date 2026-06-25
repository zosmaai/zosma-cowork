import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  pageExtensions: ["js", "jsx", "md", "mdx", "ts", "tsx"],
  output: "standalone",
  turbopack: {
    // Explicitly root Turbopack to website/ so it doesn't confuse
    // the monorepo root package-lock.json with our pnpm-lock.yaml.
    root: __dirname,
  },
};

export default withMDX(config);
