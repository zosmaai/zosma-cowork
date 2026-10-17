import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  lstatSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function walk(root) {
  const paths = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    paths.push(path);
    if (entry.isDirectory() && !entry.isSymbolicLink()) paths.push(...walk(path));
  }
  return paths;
}

test("pnpm deploy creates a portable production daemon", () => {
  const temp = mkdtempSync(join(tmpdir(), "zosma-daemon-deploy-"));
  const deployed = join(temp, "daemon");
  try {
    execFileSync("pnpm", ["-C", "packages/protocol", "build"], {
      cwd: repoRoot,
      stdio: "pipe",
    });
    execFileSync("pnpm", [
      "--filter", "@zosma-cowork/daemon",
      "deploy", "--prod", "--legacy", deployed,
    ], { cwd: repoRoot, stdio: "pipe" });

    // pnpm's legacy deploy records the deployed package itself in its local
    // virtual store as a symlink back into the live workspace. The bundle
    // root already IS the package (nothing inside node_modules imports
    // `@zosma-cowork/daemon` by name), so drop that single self-reference to
    // keep the deployed tree fully portable.
    rmSync(join(deployed, "node_modules", ".pnpm", "node_modules", "@zosma-cowork", "daemon"), {
      recursive: true,
      force: true,
    });

    assert.equal(statSync(join(deployed, "bin", "zosma-daemon.js")).isFile(), true);
    assert.equal(statSync(join(deployed, "src", "index.ts")).isFile(), true);
    assert.equal(
      statSync(join(deployed, "node_modules", "@zosma-cowork", "protocol", "dist", "index.js")).isFile(),
      true,
    );
    assert.equal(walk(join(deployed, "src")).some((path) => /\.test\.(?:mjs|ts)$/.test(path)), false);
    const protocolSrc = join(deployed, "node_modules", "@zosma-cowork", "protocol", "src");
    assert.equal(walk(protocolSrc).some((path) => /\.test\.ts$/.test(path)), false);

    const deployedRoot = realpathSync(deployed);
    for (const path of walk(deployed)) {
      if (lstatSync(path).isSymbolicLink()) {
        const target = realpathSync(path);
        const fromRoot = relative(deployedRoot, target);
        assert.equal(
          fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot)),
          true,
          `symlink escapes deployed tree: ${path} -> ${target}`,
        );
      }
    }

    execFileSync(process.execPath, [
      "--conditions=zosma-production",
      "--experimental-strip-types",
      "--input-type=module",
      "--eval",
      "import('./src/pi/adapter.ts').then(({ PiAdapter }) => { if (!PiAdapter) process.exit(1) })",
    ], { cwd: deployed, stdio: "pipe" });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});