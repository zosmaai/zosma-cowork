import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const RUNTIME_MANAGER_URL = new URL("../packages/pi-backend/runtime-manager.ts", import.meta.url);
const RUNTIME_URL = new URL("../packages/pi-backend/runtime.ts", import.meta.url);

test("RPC session startup preloads extension-registered providers before restoring models", async () => {
  const source = await readFile(RUNTIME_MANAGER_URL, "utf8");
  const startupSource = source.slice(source.indexOf("export class RuntimeManager"));

  assert.match(startupSource, /createAgentSessionServices\(/);
  assert.match(startupSource, /createAgentSessionFromServices\(/);
  assert.doesNotMatch(startupSource, /await createAgentSession\(/);
});

test("RPC session startup resolves and passes the SDK-native enabled model scope", async () => {
  const source = await readFile(RUNTIME_MANAGER_URL, "utf8");
  const startupSource = source.slice(source.indexOf("export class RuntimeManager"));
  const resolveIndex = startupSource.indexOf("resolveVisibleModels(");
  const createIndex = startupSource.indexOf("createAgentSessionFromServices(");

  assert.ok(resolveIndex >= 0);
  assert.ok(createIndex >= 0);
  assert.ok(createIndex > resolveIndex);
  assert.match(startupSource, /selectInitialModelScope\(/);
  assert.match(startupSource, /scopedModels: initial\.scopedModels/);
  assert.match(startupSource, /model: initial\.model/);
  assert.match(startupSource, /thinkingLevel: initial\.thinkingLevel/);
});

test("RPC session startup treats only sessions with messages as continuing", async () => {
  const source = await readFile(RUNTIME_MANAGER_URL, "utf8");
  const startupSource = source.slice(source.indexOf("export class RuntimeManager"));

  assert.match(
    startupSource,
    /const hasExistingMessages = sessionManager\.getBranch\(\)\.some\(\(entry\) => entry\.type === "message"\)/,
  );
  assert.match(startupSource, /const initial = hasExistingMessages/);
  assert.doesNotMatch(startupSource, /const initial = sessionFile/);
  assert.doesNotMatch(startupSource, /sessionManager\.buildSessionContext\(\)/);
});

test("RPC session startup opens an existing session file only once and trusts its cwd", async () => {
  const source = await readFile(RUNTIME_MANAGER_URL, "utf8");
  const startupSource = source.slice(source.indexOf("export class RuntimeManager"));
  const routeSource = await readFile(new URL("../app/api/agent/[id]/route.ts", import.meta.url), "utf8");
  const eventRouteSource = await readFile(new URL("../app/api/agent/[id]/events/route.ts", import.meta.url), "utf8");
  const autoNameRouteSource = await readFile(new URL("../app/api/sessions/[id]/auto-name/route.ts", import.meta.url), "utf8");

  assert.equal((startupSource.match(/SessionManager\.open\(/g) ?? []).length, 1);
  assert.match(startupSource, /const sessionCwd = sessionManager\.getCwd\(\)/);
  assert.match(startupSource, /projectTrustReloadOptions\(sessionCwd, agentDir\)/);
  assert.match(startupSource, /cwd: sessionCwd/);
  for (const route of [routeSource, eventRouteSource, autoNameRouteSource]) {
    assert.doesNotMatch(route, /SessionManager\.open\(/);
  }
});

test("RPC wrapper avoids per-chunk idle and running-state maintenance", async () => {
  const wrapperSource = await readFile(RUNTIME_URL, "utf8");
  const managerSource = await readFile(RUNTIME_MANAGER_URL, "utf8");
  const startSource = wrapperSource.slice(
    wrapperSource.indexOf("  start(): void"),
    wrapperSource.indexOf("  setForceEmptySystemPrompt"),
  );
  const notifySource = managerSource.slice(
    managerSource.indexOf("notifyRunningChange(): void {"),
    managerSource.indexOf("async startSession("),
  );

  assert.match(startSource, /IDLE_RESET_EVENT_TYPES\.has\(event\.type\)/);
  assert.match(startSource, /RUNNING_STATE_EVENT_TYPES\.has\(event\.type\)/);
  assert.doesNotMatch(startSource, /subscribe\(\(event: AgentEvent\) => \{\s*this\.resetIdleTimer\(\)/);
  assert.match(notifySource, /if \(listeners\.size === 0\)/);
  assert.match(notifySource, /lastRunningSnapshot = ""/);
});

test("normal session teardown paths use graceful extension shutdown", async () => {
  const source = await readFile(RUNTIME_URL, "utf8");
  const deleteRouteSource = await readFile(new URL("../packages/pi-backend/sessions.ts", import.meta.url), "utf8");
  const trustRouteSource = await readFile(new URL("../app/api/project-trust/route.ts", import.meta.url), "utf8");
  const idleSource = source.slice(
    source.indexOf("  private resetIdleTimer"),
    source.indexOf("  private persistBashOnlySession"),
  );
  const forkSource = source.slice(
    source.indexOf('case "fork"'),
    source.indexOf('case "navigate_tree"'),
  );

  assert.match(idleSource, /this\.shutdown\(\)/);
  assert.match(forkSource, /await this\.shutdown\(\)/);
  assert.match(deleteRouteSource, /await runtime\.getSession\(id\)\?\.shutdown\(\)/);
  assert.match(trustRouteSource, /await destroyRpcSessionsForCwd\(result\.cwd\)/);
});

test("new-session route applies model scope during construction instead of follow-up commands", async () => {
  const source = await readFile(new URL("../app/api/agent/new/route.ts", import.meta.url), "utf8");

  assert.match(source, /initialModel: \{ provider, modelId \}/);
  assert.match(source, /thinkingLevel: explicitThinkingLevel/);
  assert.doesNotMatch(source, /session\.send\(\{ type: "set_model"/);
  assert.doesNotMatch(source, /session\.send\(\{ type: "set_thinking_level"/);
  assert.match(source, /model: state\.model/);
  assert.match(source, /thinkingLevel: state\.thinkingLevel/);
});

test("prompt routes mark only preflight failures as rejected", async () => {
  const existingRoute = await readFile(new URL("../app/api/agent/[id]/route.ts", import.meta.url), "utf8");
  const newRoute = await readFile(new URL("../app/api/agent/new/route.ts", import.meta.url), "utf8");

  for (const source of [existingRoute, newRoute]) {
    assert.match(source, /let promptAccepted = false/);
    assert.match(source, /await .*\.send\(/);
    assert.match(source, /promptAccepted = .*\.type === "prompt"/);
    assert.match(source, /commandType === "prompt" && !promptAccepted/);
  }
});

test("RPC session startup persists explicit preferences without replaying setters", async () => {
  const source = await readFile(RUNTIME_MANAGER_URL, "utf8");
  const startupSource = source.slice(source.indexOf("export class RuntimeManager"));

  assert.match(startupSource, /persistExplicitStartupPreferences\(/);
  assert.match(startupSource, /modelDefaultChanged\) invalidateModelsCache\(\)/);
});

test("custom extension UI receives the fixed headless terminal facade", async () => {
  const source = await readFile(RUNTIME_URL, "utf8");
  const customUiSource = source.slice(
    source.indexOf("private requestExtensionCustomUi"),
    source.indexOf("private requestExtensionUi"),
  );

  assert.match(customUiSource, /createHeadlessCustomUiTui\(/);
  assert.match(customUiSource, /width,/);
});

test("reloading a session invalidates the models cache", async () => {
  const source = await readFile(RUNTIME_URL, "utf8");
  const reloadSource = source.slice(
    source.indexOf('case "reload"'),
    source.indexOf('case "abort_compaction"'),
  );

  assert.match(reloadSource, /await this\.inner\.reload\(\)/);
  assert.match(reloadSource, /this\.applyForcedEmptySystemPrompt\(\);\s*invalidateModelsCache\(\)/);
});

test("rpc-manager seam re-exports the frozen surface and delegates to the manager", async () => {
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");

  // Re-exported types/values (unchanged public surface).
  assert.match(source, /export type \{ AgentEvent, AgentRuntimeHooks \} from/);
  assert.match(source, /export \{ AgentSessionWrapper \} from/);
  assert.match(source, /export type \{ RpcSessionStartOptions \} from/);

  // Delegation seam: no registry/local helpers, everything flows through the
  // manager singleton so the globalThis contract lives only in runtime-state.ts.
  assert.match(source, /export function getRpcSession\(/);
  assert.match(source, /export function getRpcSessionInfos\(/);
  assert.match(source, /export function hasBusyRpcSessionForCwd\(/);
  assert.match(source, /export async function destroyRpcSessionsForCwd\(/);
  assert.match(source, /export function getRunningRpcSessionIds\(/);
  assert.match(source, /export function subscribeRunningSessions\(/);
  assert.match(source, /export function notifyRunningChange\(/);
  assert.match(source, /export async function startRpcSession\(/);
  assert.doesNotMatch(source, /getRegistry\(\)|getLocks\(\)|getStartingSessionCwds\(\)/);
  assert.match(source, /getRuntimeManager\(\)\.getSession\(/);
  assert.match(source, /getRuntimeManager\(\)\.getSessionInfos\(\)/);
  assert.match(source, /getRuntimeManager\(\)\.startSession\(/);
});
