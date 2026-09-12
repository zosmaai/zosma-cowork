import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Regression: a degraded/dead daemon can yield non-array `extensionStatuses`,
// `extensionWidgets`, or `queuedMessages` shapes. Every state setter must
// normalize through `asArray(...)` — a bare `?? []` fallback only covers
// null/undefined and lets a non-array through into state (the
// `statuses is not iterable` crash).
const hookSource = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");

test("extension status/widget & queued-message setters normalize through asArray", () => {
  assert.match(hookSource, /setExtensionStatuses\(asArray\(/);
  assert.match(hookSource, /setExtensionWidgets\(asArray\(/);
  assert.match(hookSource, /steering: asArray\(q\?\.steering\)/);
  assert.match(hookSource, /followUp: asArray\(q\?\.followUp\)/);
});

test("no bare ?? [] fallback remains on the array setters", () => {
  const drift = hookSource.match(/setExtension(Statuses|Widgets)\(([^)]*)\?\? \[\]/);
  assert.equal(drift, null, `bare ?? [] on extension setter: ${drift && drift[0]}`);
});