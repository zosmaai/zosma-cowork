import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Repo root — pnpm symlinks resolve next/react out of the app dir into the
// root store; root turbopack there so those packages stay inside the root.
const REPO_ROOT = path.join(__dirname, "../..");

/** @type {import('next').NextConfig} */
const config = {
	reactStrictMode: true,
	pageExtensions: ["js", "jsx", "md", "mdx", "ts", "tsx"],
	output: "standalone",
	turbopack: {
		// Root Turbopack at the pnpm workspace root so symlinked deps
		// (next, react) resolve inside the compile root.
		root: REPO_ROOT,
	},
};

export default withMDX(config);
