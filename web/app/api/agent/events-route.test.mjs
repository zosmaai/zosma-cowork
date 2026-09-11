import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const agentEventsSource = await readFile(new URL("./[id]/events/route.ts", import.meta.url), "utf8");
const bridgeSource = await readFile(new URL("../../../lib/daemon-agent-stream.ts", import.meta.url), "utf8");

test("agent SSE relays the daemon watch stream instead of spawning in-process", () => {
  assert.match(agentEventsSource, /piList\(/);
  assert.match(agentEventsSource, /piResume\(id, filePath/);
  assert.match(agentEventsSource, /daemonStream\(/);
  assert.match(agentEventsSource, /createDaemonAgentEventStream\(req, \{ sessionId: id \}/);
  assert.match(agentEventsSource, /if \(req\.signal\.aborted\) return new Response\(null, \{ status: 204 \}\)/);
  assert.doesNotMatch(agentEventsSource, /startRpcSession/);
  assert.doesNotMatch(agentEventsSource, /createAgentEventStream/);
  assert.match(agentEventsSource, /"X-Accel-Buffering": "no"/);
});

test("daemon bridge emits connected first and one TextEncoder per stream", () => {
  assert.equal((bridgeSource.match(/new TextEncoder\(\)/g) ?? []).length, 1);
  assert.match(bridgeSource, /controller\.enqueue\(encoder\.encode\(/);
  assert.match(bridgeSource, /{ type: "connected", sessionId, isStreaming: false }/);
  assert.match(bridgeSource, /case "message"/);
  assert.match(bridgeSource, /case "tool"/);
  assert.match(bridgeSource, /case "end"/);
});