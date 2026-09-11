import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Regression: POST /api/agent/new 403s when the daemon's allowed-roots set is
// empty (daemon restart). The route must grant the cwd root via piAllowRoot
// BEFORE piStart — pi:start on the daemon is root-gated, so the old
// start-then-grant order threw and the root never reached the daemon,
// wedging every subsequent new-session attempt.
const newRouteSource = await readFile(new URL("./new/route.ts", import.meta.url), "utf8");

test("zeta agent/new grants the daemon root before piStart", () => {
  assert.match(newRouteSource, /piAllowRoot\(cwd\)[\s\S]*piStart\(cwd/);
});