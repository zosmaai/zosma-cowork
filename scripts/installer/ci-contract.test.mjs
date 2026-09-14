import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("package and CI expose the Phase 3 installer gate", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(pkg.scripts["test:installer"], "node --test scripts/installer/*.test.mjs");
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.match(workflow, /pnpm test:installer/);
  assert.match(workflow, /shellcheck -s sh scripts\/zosma/);
  assert.match(workflow, /sh -n scripts\/zosma/);
});
