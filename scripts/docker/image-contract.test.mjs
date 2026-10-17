import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";
import { BUNDLED_NODE_VERSION } from "../bundled-node-version.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const readRoot = (name) => readFileSync(join(repoRoot, name), "utf8");

const NODE_INDEX = "sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d";
const DEBIAN_INDEX = "sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171";

test("Dockerfile pins the builder and runtime image indexes", () => {
  const source = readRoot("Dockerfile");
  assert.match(
    source,
    new RegExp(`ARG NODE_IMAGE=node:${BUNDLED_NODE_VERSION.slice(1)}-bookworm-slim@${NODE_INDEX}`),
  );
  assert.match(source, new RegExp(`ARG RUNTIME_IMAGE=debian:bookworm-slim@${DEBIAN_INDEX}`));
});

test("Dockerfile consumes the Phase 1 server package instead of rebuilding a second runtime", () => {
  const source = readRoot("Dockerfile");
  assert.match(source, /pnpm server:package --version "\$\{ZOSMA_VERSION\}"/);
  assert.match(source, /zosma-cowork-server-\$\{ZOSMA_VERSION\}-linux-\$\{arch\}\.tar\.gz/);
});

test("Dockerfile installs Git and launches the shared supervisor as a non-root user", () => {
  const source = readRoot("Dockerfile");
  assert.match(source, /apt-get install[^\n]*--no-install-recommends[^\n]*ca-certificates[^\n]*git[^\n]*tzdata/);
  assert.match(source, /^USER 10001:10001$/m);
  assert.match(source, /HEALTHCHECK[^\n]*CMD \["\/opt\/zosma\/runtime\/bin\/node", "\/opt\/zosma\/supervisor\/healthcheck\.mjs"\]/);
  assert.match(source, /ENTRYPOINT \["\/opt\/zosma\/runtime\/bin\/node", "\/opt\/zosma\/supervisor\/run-server\.mjs"\]/);
});

test("Dockerfile contains no sandbox-only privilege or Tailscale setup", () => {
  const source = readRoot("Dockerfile");
  assert.doesNotMatch(source, /tailscale|tailscaled|NET_ADMIN|SYS_ADMIN|\/dev\/net\/tun/i);
});

test("root Docker context excludes build products, repositories, and local secrets", () => {
  const entries = new Set(
    readRoot(".dockerignore")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")),
  );
  for (const entry of [
    ".git",
    ".env*",
    "**/.env*",
    ".zosma*",
    ".llm-wiki",
    ".pi",
    ".worktrees",
    "**/node_modules",
    "**/.next",
    "**/dist-server",
    "dist",
    "target",
    "*.log",
  ]) {
    assert.equal(entries.has(entry), true, `missing .dockerignore entry: ${entry}`);
  }
});