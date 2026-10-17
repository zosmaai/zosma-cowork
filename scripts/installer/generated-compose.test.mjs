import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { makeHarness } from "./test-helpers.mjs";

const VERSION = "v1.2.3";
const IMAGE = `ghcr.io/zosmaai/zosma-cowork@sha256:${"b".repeat(64)}`;

test("generated Docker Compose preserves the Phase 2 template contract", (t) => {
  const h = makeHarness();
  t.after(() => h.cleanup());
  const workspace = join(h.root, "space with # and $value");
  mkdirSync(workspace, { recursive: true });
  h.makeCLI(VERSION, { scriptBody: "exit 0" });
  h.makeManifest({ version: VERSION, overrides: { docker_image: IMAGE } });
  h.write("fixtures/stable", h.read("fixtures/manifest.txt"));
  h.plan("docker", [
    'case "$1 $2" in',
    '  "compose version") printf "Docker Compose version v2.30.0\\n" ;;',
    '  "image inspect") printf "%s\\n" "$ZOSMA_TEST_IMAGE" ;;',
    "esac",
    "exit 0",
  ].join("\n"));
  const r = h.runCLI(["install", "--mode", "docker", "--workspace", workspace, "--yes", "--no-start"], {
    env: { ZOSMA_TEST_IMAGE: IMAGE, ZOSMA_INSTALL_MANIFEST: `${h.fixtures}/manifest.txt` },
  });
  assert.equal(r.status, 0, r.stderr);
  const generated = readFileSync(join(h.config, "zosma-cowork", "docker", "compose.yml"), "utf8");
  const template = readFileSync(join(process.cwd(), "deploy", "compose.yml.template"), "utf8");
  assert.equal(generated.trimEnd(), template.trimEnd());
  assert.match(readFileSync(join(h.config, "zosma-cowork", "config"), "utf8"), /space with # and \$value/);
});
