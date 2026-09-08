import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const agentDir = fileURLToPath(new URL("./", import.meta.url));

test("agent namespace separates the static running route from dynamic state routes", async () => {
  const entries = await readdir(agentDir, { withFileTypes: true });
  assert.ok(entries.some((e) => e.isDirectory() && e.name === "running"), "static running directory exists");
  assert.ok(entries.some((e) => e.isDirectory() && e.name === "[id]"), "dynamic [id] directory exists");
  const runningRoute = await readFile(join(agentDir, "running/route.ts"), "utf8");
  const stateRoute = await readFile(join(agentDir, "[id]/state/route.ts"), "utf8");
  assert.match(runningRoute, /getRunningSessionIds\(\)/);
  assert.doesNotMatch(runningRoute, /getAgentState\(/);
  assert.match(stateRoute, /getAgentState\(/);
  // No bare `[id]/route.ts` exists at the agent root, so an id can never be "running".
  await assert.rejects(stat(join(agentDir, "[id]/route.ts")));
});
