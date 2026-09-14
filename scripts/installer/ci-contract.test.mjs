import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("package and CI expose the Phase 3 installer gate", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(pkg.scripts["test:installer"], "node --test scripts/installer/*.test.mjs");
  assert.equal(pkg.scripts["installer:check"], "node scripts/build-zosma.mjs --check");
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(workflow, /pnpm test:installer/);
  assert.match(workflow, /shellcheck -s sh scripts\/zosma/);
  assert.match(workflow, /sh -n scripts\/zosma/);
  assert.match(workflow, /pnpm installer:check/);
});
