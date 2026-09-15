import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workflow = readFileSync(join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");

test("normal CI builds without publishing a production image", () => {
  assert.match(workflow, /^  docker:/m);
  assert.match(workflow, /docker build[\s\S]*--tag zosma-cowork:ci/);
  assert.doesNotMatch(workflow, /docker push|packages:\s*write/);
});

test("normal CI checks both loopback and LAN container modes", () => {
  assert.match(workflow, /docker:smoke --image zosma-cowork:ci --bind 127\.0\.0\.1/);
  assert.match(workflow, /docker:smoke --image zosma-cowork:ci --bind 0\.0\.0\.0/);
});