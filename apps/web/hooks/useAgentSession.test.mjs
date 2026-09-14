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
  readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8"),
  readFile(new URL("./useSessionLoader.ts", import.meta.url), "utf8"),
  readFile(new URL("./useSessionEvents.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/agent-session-messages.ts", import.meta.url), "utf8"),
]);
const agentSessionSource = files[0];
const loaderSource = files[1];
const eventsSource = files[2];
const libSource = files[3];
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

test("settle after an async abort keeps the frozen tail (no end blast)", () => {
  // Late duplicate terminal frames (daemon-synthesized settled after abort)
  // must not wipe the frozen streaming bubble.
  assert.match(
    eventsSource,
    /dispatch\(\{ type: wasRunning \? "end" : "frozen" \}\)/,
  );
  assert.match(
    eventsSource,
    /Already settled\? The run ended asynchronously \(abort-freeze or a late/,
  );
});

test("abort success: immediate feedback, frozen tail, stable deps (no events churn)", () => {
  assert.match(agentSessionSource, /addNotice\(\{ type: "info", message: "Generation aborted" \}\)/);
  // Freeze-settle keeps the partial/optimistic tail rendered; no `end`.
  assert.match(agentSessionSource, /await sendCommand\(sid, \{ type: "abort" \}\);[\s\S]*?dispatch\(\{ type: "frozen" \}\);/);
  // aborting state guards re-entry and is exposed for the button pending state.
  assert.match(agentSessionSource, /const \[aborting, setAborting\] = useState\(false\);/);
  assert.match(agentSessionSource, /if \(!sid \|\| aborting\) return;/);
  assert.match(agentSessionSource, /setAborting\(false\);/);
  // handleAbort deps must not include the fresh-per-render `events` object
  // (that identity churn re-created the callback every render).
  const abortDeps = agentSessionSource.match(/handleAbort = useCallback\([\s\S]*?\}, \[([^\]]+)\]\);/);
  assert.ok(abortDeps, "handleAbort deps array found");
  assert.ok(!abortDeps[1].includes("events"), "handleAbort deps must not reference the events object");
});

test("abort claim swallows the late prompt_rejected of the aborted run", () => {
  assert.match(agentSessionSource, /abortedRunIdRef\.current === promptRunId/);
  assert.match(agentSessionSource, /abortedRunIdRef\.current = -1[\s\S]*?return;/);
  assert.match(agentSessionSource, /abortedRunIdRef\.current = -1[\s\S]*?Failed to abort:/);
  // Race guard: prompt flags are only purged if this is still the in-flight
  // run — a newer run must not be settled by the aborted turn's rejection.
  assert.match(agentSessionSource, /if \(promptRunIdRef\.current === promptRunId\) \{[\s\S]*?rpcPromptPendingRef\.current = false;[\s\S]*?optimisticUserMessageKeyRef\.current = null;[\s\S]*?\}/);
});