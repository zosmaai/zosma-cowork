import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workflowPath = join(repoRoot, ".github", "workflows", "server-release.yml");
const workflow = readFileSync(workflowPath, "utf8");

const pins = [
  "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803",
  "actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38",
  "actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f",
  "actions/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131",
  "docker/login-action@dbcb813823bdd20940b903addbd779551569679f",
  "docker/setup-buildx-action@37fe631027851001ddb9b187196cc803df7f5f0e",
  "docker/build-push-action@53b7df96c91f9c12dcc8a07bcb9ccacbed38856a",
];

test("server release runs independently on canonical version tags", () => {
  assert.match(workflow, /push:[\s\S]*tags:[\s\S]*"v\*\.\*\.\*"/);
  assert.doesNotMatch(workflow, /workflow_run:/);
  assert.match(workflow, /gh api "repos\/\$\{GITHUB_REPOSITORY\}\/releases\/tags\/\$\{TAG\}"/);
  assert.match(workflow, /\.draft == false and \.prerelease == false/);
});

test("server release grants only read-content and scoped package publication", () => {
  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.match(workflow, /packages: write/);
  assert.doesNotMatch(workflow, /contents: write|id-token: write|attestations: write/);
});

test("server release pins every action dependency to an immutable SHA", () => {
  for (const pin of pins) assert.match(workflow, new RegExp(pin.replaceAll("/", "\\/")));
  assert.doesNotMatch(workflow, /uses:\s+[^\s]+@v\d/);
});

test("server release builds and smokes native amd64 and arm64 digests before tagging", () => {
  assert.match(workflow, /platform: linux\/amd64/);
  assert.match(workflow, /platform: linux\/arm64/);
  assert.match(workflow, /runner: ubuntu-22\.04-arm/);
  assert.match(workflow, /push-by-digest=true/);
  assert.match(workflow, /docker:smoke --image "\$\{IMAGE_NAME\}@\$\{DIGEST\}"/);
  assert.match(workflow, /imagetools create --tag "\$\{IMAGE_NAME\}:\$\{TAG\}"/);
});

test("server release records one top-level digest without promoting latest", () => {
  assert.match(workflow, /image-reference\.txt/);
  assert.match(workflow, /docker buildx imagetools inspect/);
  assert.match(workflow, /existing exact tag points to different platform digests/);
  assert.match(workflow, /docker logout ghcr\.io/);
  assert.match(workflow, /docker pull "\$\{IMAGE_NAME\}@\$\{DIGEST\}"/);
  assert.doesNotMatch(workflow, /zosma-cowork:latest|type=raw,value=latest/);
});

test("Phase 2 workflow does not alter GitHub releases or stable installer assets", () => {
  assert.doesNotMatch(workflow, /gh release (upload|edit)|upload-release-asset|install-manifest|install\.zosma\.ai/);
});