import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("turn fold shows overall ran duration computed from group timestamps", () => {
  assert.match(source, /formatSessionDuration/);
  assert.match(source, /turnRunDurationMs\(messages, userIdx, endIdx\)/);
  assert.match(source, /duration=\{runMs === null \? null : formatSessionDuration\(roundToSecondMs\(runMs\)\)\}/);
});

test("parent total rounds to the nearest second, matching child step durations", () => {
  // Child thinking/tool durations use Math.round; parent must not floor or the
  // totals disagree (e.g. child "4s" under parent "3s").
  assert.match(source, /function roundToSecondMs\(ms: number\): number \{\s*return Math\.round\(ms \/ 1000\) \* 1000;/);
  assert.doesNotMatch(source, /formatSessionDuration\(runMs\)/);
});

test("live fold spinner tracks the agent, not the session-wide busy flag", () => {
  assert.match(source, /runningSince=\{agentRunning \? turnStart : null\}/);
  assert.match(source, /duration=\{agentRunning \|\| liveRunMs === null \? null/);
});

test("turn fold ticks a live elapsed clock while the turn is still running", () => {
  assert.match(source, /useElapsedSeconds/);
  assert.match(source, /runningSince/);
  assert.match(source, /setInterval\(/);
});

test("live tail groups intermediate process steps into a running fold", () => {
  assert.match(source, /isLiveTail/);
  assert.match(source, /runningSince=\{/);
  assert.match(source, /key=\{`turn-process-live-\$\{userIdx\}`\}/);
});

test("process bubbles hide the model label so the turn shows it once", () => {
  // The fold's process bubble used to render the provider label above the
  // thinking step, reading as "model responded, then thought". The model name
  // now renders only on the answer bubble.
  assert.match(source, /keyPrefix: "process", hideModelLabel: true/);
  assert.match(source, /hideModelLabel: true,/);
});

test("live streaming tail wraps thinking in a running fold above the answer", () => {
  // The streamed message used to render as one inline bubble (thinking + text
  // side by side). Now it is split so the process blocks stream inside a
  // "Reasoning & tools" fold that sits above the answer — same shape as the
  // settled turn, so thinking can never appear after the response.
  assert.match(source, /turn-process-live-stream/);
  assert.match(source, /streamSplit\.processBlocks/);
  assert.match(source, /streamSplit\.answerBlocks/);
  assert.match(source, /withAssistantBlocks\(streamMsg, streamSplit\.processBlocks\)/);
});

test("parent fold keeps child folds and auto-opens while running", () => {
  assert.match(source, /if \(running\) setOpen\(true\)/);
  assert.match(source, /turn-process-children/);
});
