import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Regression: a degraded/dead daemon can yield non-array `extensionStatuses`,
// `extensionWidgets`, or `queuedMessages` shapes. Every state setter must
// normalize through `asArray(...)` — a bare `?? []` fallback only covers
// null/undefined and lets a non-array through into state (the
// `statuses is not iterable` crash).
//
// The setters moved out of the composition root during the
// useAgentSession → useSessionLoader/useSessionEvents split, so the guards
// now live in those files (plus the shared lib helper).
const files = await Promise.all([
  readFile(new URL("./useSessionLoader.ts", import.meta.url), "utf8"),
  readFile(new URL("./useSessionEvents.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/agent-session-messages.ts", import.meta.url), "utf8"),
]);
const loaderSource = files[0];
const eventsSource = files[1];
const libSource = files[2];
const all = files.join("\n");

test("extension status/widget & queued-message setters normalize through asArray", () => {
  assert.match(loaderSource, /setExtensionStatuses\(asArray\(/);
  assert.match(loaderSource, /setExtensionWidgets\(asArray\(/);
  assert.match(libSource, /steering: asArray\(q\?\.steering\)/);
  assert.match(libSource, /followUp: asArray\(q\?\.followUp\)/);
});

test("no bare ?? [] fallback remains on the array setters", () => {
  const drift = all.match(/setExtension(Statuses|Widgets)\(([^)]*)\?\? \[\]/);
  assert.equal(drift, null, `bare ?? [] on extension setter: ${drift && drift[0]}`);
});

test("reconcile + agent_end state application also normalizes (not just loader)", () => {
  assert.match(eventsSource, /setExtensionStatuses\(asArray\(/);
  assert.match(eventsSource, /setExtensionWidgets\(asArray\(/);
});