# Session Runtime and Identity Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Cowork's singleton agent state with session-keyed sidecar runtimes and carry canonical `sessionFile` identity through sidecar, Tauri, and the existing single-active frontend stream.

**Architecture:** A `SessionRuntimeManager` owns `Map<canonicalSessionFile, SessionRuntime>`. Each runtime owns its Pi `AgentSession`, `SessionManager`, resource loader/cwd, model, scheduler, prompt watchdog state, queue, event subscription, and extension UI binding. Sidecar envelopes and Tauri commands carry `sessionFile`; the frontend still renders one reducer and explicitly stops the current run before switching, leaving true visible concurrency to Phase 2.

**Tech Stack:** TypeScript, Pi coding-agent SDK, Vitest, Rust/Tauri 2, React 19, Tauri Channels/events.

**Roadmap:** [`docs/superpowers/roadmaps/2026-08-09-chat-work-concurrent-sessions-roadmap.md`](../roadmaps/2026-08-09-chat-work-concurrent-sessions-roadmap.md)

**Phase:** Phase 1: Session Runtime and Identity Foundation

---

## Phase Guardrails

This plan intentionally does not add keyed frontend stream state, background-running UI, sidebar spinners, Chat/Work modes, typography changes, Outputs/Sources, or selection actions. During this phase:

- the sidecar may hold several isolated runtimes;
- the React app still renders one active stream reducer;
- selecting or creating another session explicitly awaits abort of the current run before changing the active file;
- no UI claims that hidden work continues.

Phase 2 removes stop-on-switch and retains every tagged stream in a frontend map.

## File Structure

### New files

- `agent-sidecar/src/session-protocol.ts`: wire types and pure envelope constructors.
- `agent-sidecar/src/session-protocol.test.ts`: envelope and structured-error contract tests.
- `agent-sidecar/src/session-runtime-manager.ts`: runtime shape, canonical path identity, snapshots, map lifecycle, and in-flight load deduplication.
- `agent-sidecar/src/session-runtime-manager.test.ts`: canonicalization, deduplication, isolation, snapshots, and disposal tests.
- `agent-sidecar/src/session-runtime-factory.ts`: one Pi SDK runtime builder using shared auth/model/settings infrastructure.
- `agent-sidecar/src/session-runtime-factory.test.ts`: proof that Pi sessions receive distinct cwd/resource/scheduler state.
- `agent-sidecar/src/commands/handlers/core.test.ts`: session-targeting regression tests for prompt, abort, queue, and model handlers.
- `agent-sidecar/src/commands/handlers/sessions.test.ts`: new/load/delete handler lifecycle tests.
- `agent-sidecar/src/extension-ui-bridge.test.ts`: session-tagged UI request and cleanup tests.
- `src/types/session-runtime.ts`: frontend copy of stable wire types.
- `src/hooks/usePiStream.session.test.ts`: Tauri invoke identity and event-filtering tests.

### Modified files

- `agent-sidecar/src/protocol.ts`, `protocol.test.ts`, `event-bus.ts`: retain identity and structured error fields.
- `agent-sidecar/src/pi-session-store.test.ts`: protect message conversion used by runtime snapshots.
- `agent-sidecar/src/prompt-runner.ts`, `subscribe-session.test.ts`: runtime-local watchdog/status and tagged events.
- `agent-sidecar/src/extension-ui-bridge.ts`: capture session identity in extension UI bindings.
- `agent-sidecar/src/commands/types.ts`: require `sessionFile` on session-bound commands.
- `agent-sidecar/src/commands/handler-registry.ts`: expose `runtimeManager` instead of singleton agent state.
- `agent-sidecar/src/commands/handlers/core.ts`: resolve target runtime for every agent operation.
- `agent-sidecar/src/commands/handlers/sessions.ts`: create/load/snapshot/dispose through runtime manager.
- `agent-sidecar/src/commands/handlers/settings.ts`, `auth.ts`: reload/check runtime manager instead of one session.
- `agent-sidecar/src/index.ts`, `zosma-auth/index.test.ts`: initialize shared infrastructure plus runtime factory/manager and keep provider reload fakes current.
- `src-tauri/src/lib.rs`: include session identity in payloads, pending prompt routing, and emitted events.
- `src/hooks/usePiStream.ts`: accept explicit session arguments and ignore mismatched envelopes.
- `src/App.tsx`: adopt ready/new/load snapshots and pass session identity to every operation.
- `src/hooks/useProviders.ts`: remove unused global `setModel` helper.
- `src/hooks/useFileMention.ts`, `useFileMention.test.ts`: query the explicitly selected session workspace and cache by workspace.
- `src/components/MessageInput.tsx`, `src/chat/ChatView.tsx` and tests: thread `sessionFile` into file mentions.

---

### Task 1: Freeze Session-aware Wire Contracts

**Files:**
- Create: `agent-sidecar/src/session-protocol.ts`
- Create: `agent-sidecar/src/session-protocol.test.ts`
- Modify: `agent-sidecar/src/protocol.ts`
- Modify: `agent-sidecar/src/protocol.test.ts`
- Modify: `agent-sidecar/src/event-bus.ts`

- [ ] **Step 1: Run current sidecar protocol tests**

Run:

```bash
cd agent-sidecar && pnpm test -- src/protocol.test.ts
```

Expected: PASS. This establishes Scenario 2's green baseline before changing tested protocol code.

- [ ] **Step 2: Write failing envelope contract tests**

Create `agent-sidecar/src/session-protocol.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	makeSessionDone,
	makeSessionError,
	makeSessionEvent,
	makeSessionResult,
} from "./session-protocol.js";

describe("session protocol envelopes", () => {
	const sessionFile = "/tmp/pi/session-a.jsonl";

	it("tags agent events with canonical session identity", () => {
		expect(makeSessionEvent(sessionFile, { type: "agent_start" })).toEqual({
			type: "event",
			sessionFile,
			event: { type: "agent_start" },
		});
	});

	it("tags results and terminal done with command and session identity", () => {
		expect(makeSessionResult("p-1", sessionFile, { queued: true })).toEqual({
			type: "result",
			id: "p-1",
			sessionFile,
			data: { queued: true },
		});
		expect(makeSessionDone("p-1", sessionFile)).toEqual({
			type: "done",
			id: "p-1",
			sessionFile,
		});
	});

	it("keeps structured error fields on the wire", () => {
		expect(
			makeSessionError("p-1", sessionFile, {
				code: "session_not_loaded",
				message: "Session is not loaded",
				retryable: true,
				details: "runtime missing",
			}),
		).toEqual({
			type: "error",
			id: "p-1",
			sessionFile,
			code: "session_not_loaded",
			message: "Session is not loaded",
			retryable: true,
			details: "runtime missing",
		});
	});
});
```

- [ ] **Step 3: Run the new tests and verify expected failure**

Run:

```bash
cd agent-sidecar && pnpm test -- src/session-protocol.test.ts
```

Expected: FAIL because `session-protocol.ts` does not exist.

- [ ] **Step 4: Add exact wire types and pure constructors**

Create `agent-sidecar/src/session-protocol.ts` with these public contracts:

```ts
export type SessionStatus = "idle" | "thinking" | "tool_call" | "responding" | "error";

export type SessionErrorCode =
	| "session_not_loaded"
	| "session_load_failed"
	| "session_busy"
	| "session_aborted"
	| "provider_error";

export interface SessionWireError {
	code: SessionErrorCode;
	message: string;
	retryable: boolean;
	details?: string;
}

export interface SessionSnapshot {
	sessionFile: string;
	mode: "chat";
	cwd: string;
	messages: Array<Record<string, unknown>>;
	isRunning: boolean;
	status: SessionStatus;
	queue: { steering: string[]; followUp: string[] };
	model?: { provider?: string; id?: string; name?: string };
	error?: SessionWireError;
}

export interface SessionEventEnvelope {
	type: "event";
	sessionFile: string;
	event: unknown;
}

export interface SessionResultEnvelope {
	type: "result";
	id: string;
	sessionFile: string;
	data: unknown;
}

export interface SessionDoneEnvelope {
	type: "done";
	id: string;
	sessionFile: string;
}

export interface SessionErrorEnvelope extends SessionWireError {
	type: "error";
	id: string;
	sessionFile: string;
}

export function makeSessionEvent(sessionFile: string, event: unknown): SessionEventEnvelope {
	return { type: "event", sessionFile, event };
}

export function makeSessionResult(
	id: string,
	sessionFile: string,
	data: unknown,
): SessionResultEnvelope {
	return { type: "result", id, sessionFile, data };
}

export function makeSessionDone(id: string, sessionFile: string): SessionDoneEnvelope {
	return { type: "done", id, sessionFile };
}

export function makeSessionError(
	id: string,
	sessionFile: string,
	error: SessionWireError,
): SessionErrorEnvelope {
	return { type: "error", id, sessionFile, ...error };
}
```

`mode` is hard-coded to `"chat"` in Phase 1. Phase 3 widens it and persists mode metadata.

- [ ] **Step 5: Preserve full envelopes in protocol broadcasts**

Update `agent-sidecar/src/event-bus.ts` so event subscribers cannot lose `sessionFile`, `code`, or `retryable`, while global auth/settings envelopes remain valid:

```ts
export type BusEvent =
	| { type: "event"; data: Record<string, unknown> }
	| { type: "result"; id: string; data: unknown; sessionFile?: string }
	| { type: "done"; id: string; sessionFile?: string }
	| {
			type: "error";
			id: string;
			message: string;
			sessionFile?: string;
			code?: string;
			retryable?: boolean;
			details?: string;
	  }
	| { type: "ready" };
```

Update the dispatch portion of `send()` in `agent-sidecar/src/protocol.ts` to forward all fields:

```ts
import { eventBus, type BusEvent } from "./event-bus.js";

const busEvent = obj as Record<string, unknown> & { type?: string };
if (busEvent.type === "event") {
	eventBus.publish({ type: "event", data: busEvent });
} else if (
	busEvent.type === "result" ||
	busEvent.type === "done" ||
	busEvent.type === "error" ||
	busEvent.type === "ready"
) {
	eventBus.publish(busEvent as unknown as BusEvent);
}
```

Keep stdout JSONL writing and EPIPE handling unchanged. Add a protocol regression test that subscribes to `eventBus`, mocks `process.stdout.write`, calls `send(makeSessionError("p-1", "/tmp/a.jsonl", { code: "session_not_loaded", message: "missing", retryable: true }))`, and asserts the subscriber receives `sessionFile`, `code`, and `retryable` unchanged.

- [ ] **Step 6: Run protocol tests**

Run:

```bash
cd agent-sidecar && pnpm test -- src/session-protocol.test.ts src/protocol.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit wire contracts**

```bash
git add agent-sidecar/src/session-protocol.ts agent-sidecar/src/session-protocol.test.ts agent-sidecar/src/protocol.ts agent-sidecar/src/protocol.test.ts agent-sidecar/src/event-bus.ts
git commit -m "feat(sidecar): add session-aware protocol envelopes"
```

---

### Task 2: Add Canonical Session Runtime Manager

**Files:**
- Create: `agent-sidecar/src/session-runtime-manager.ts`
- Create: `agent-sidecar/src/session-runtime-manager.test.ts`
- Modify: `agent-sidecar/src/pi-session-store.test.ts`

- [ ] **Step 1: Write failing manager tests**

Create `agent-sidecar/src/session-runtime-manager.test.ts`. Use an injected factory, not the real Pi SDK:

```ts
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPromptScheduler } from "./prompt-scheduler.js";
import {
	SessionRuntimeManager,
	type SessionRuntime,
	type SessionRuntimeFactory,
} from "./session-runtime-manager.js";

function fakeRuntime(sessionFile: string, cwd = "/work"): SessionRuntime {
	const session = {
		messages: [],
		isStreaming: false,
		model: { provider: "test", id: sessionFile, name: sessionFile },
		getSteeringMessages: () => [],
		getFollowUpMessages: () => [],
		abort: vi.fn().mockResolvedValue(undefined),
		dispose: vi.fn(),
	} as unknown as SessionRuntime["session"];
	return {
		sessionFile: resolve(sessionFile),
		cwd,
		session,
		sessionManager: {} as SessionRuntime["sessionManager"],
		resourceLoader: {} as SessionRuntime["resourceLoader"],
		promptScheduler: createPromptScheduler(),
		prompt: { activePromptId: null, startedAt: 0, hasEmitted: false },
		status: "idle",
		error: undefined,
		unsubscribe: vi.fn(),
		dispose: vi.fn().mockResolvedValue(undefined),
	};
}

function factory(): SessionRuntimeFactory & {
	create: ReturnType<typeof vi.fn>;
	load: ReturnType<typeof vi.fn>;
} {
	return {
		create: vi.fn(async (cwd: string) => fakeRuntime(`${cwd}/new.jsonl`, cwd)),
		load: vi.fn(async (file: string) => fakeRuntime(file)),
	};
}

describe("SessionRuntimeManager", () => {
	it("returns the same runtime for duplicate concurrent loads", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
		const f = factory();
		f.load.mockImplementation(async (file: string) => {
			await gate;
			return fakeRuntime(file);
		});
		const manager = new SessionRuntimeManager(f);
		const first = manager.load("/tmp/a.jsonl");
		const second = manager.load("/tmp/a.jsonl");
		release();
		expect(await first).toBe(await second);
		expect(f.load).toHaveBeenCalledTimes(1);
	});

	it("throws a structured error instead of falling back to another runtime", async () => {
		const manager = new SessionRuntimeManager(factory());
		await manager.load("/tmp/a.jsonl");
		expect(() => manager.require("/tmp/missing.jsonl")).toThrow("Session is not loaded");
		try {
			manager.require("/tmp/missing.jsonl");
		} catch (error) {
			expect(error).toMatchObject({ code: "session_not_loaded", retryable: true });
		}
	});

	it("keeps per-session schedulers and state independent", async () => {
		const manager = new SessionRuntimeManager(factory());
		const a = await manager.load("/tmp/a.jsonl");
		const b = await manager.load("/tmp/b.jsonl");
		a.status = "responding";
		a.prompt.activePromptId = "p-a";
		expect(b.status).toBe("idle");
		expect(b.prompt.activePromptId).toBeNull();
		expect(a.promptScheduler).not.toBe(b.promptScheduler);
	});

	it("disposes only the addressed runtime", async () => {
		const manager = new SessionRuntimeManager(factory());
		const a = await manager.load("/tmp/a.jsonl");
		const b = await manager.load("/tmp/b.jsonl");
		await manager.dispose(a.sessionFile);
		expect(a.dispose).toHaveBeenCalledOnce();
		expect(manager.get(a.sessionFile)).toBeUndefined();
		expect(manager.get(b.sessionFile)).toBe(b);
	});

	it("waits for in-flight loads before disposing all", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
		const loaded = fakeRuntime("/tmp/a.jsonl");
		const f = factory();
		f.load.mockImplementation(async () => { await gate; return loaded; });
		const manager = new SessionRuntimeManager(f);
		void manager.load("/tmp/a.jsonl");
		const disposing = manager.disposeAll();
		release();
		await disposing;
		expect(loaded.dispose).toHaveBeenCalledOnce();
		expect(manager.get("/tmp/a.jsonl")).toBeUndefined();
	});
});
```

Add one `pi-session-store.test.ts` case proving `convertAgentMessagesToChat` remains the snapshot conversion boundary and does not mutate input messages.

- [ ] **Step 2: Run tests and verify expected failure**

Run:

```bash
cd agent-sidecar && pnpm test -- src/session-runtime-manager.test.ts src/pi-session-store.test.ts
```

Expected: FAIL because runtime-manager exports do not exist.

- [ ] **Step 3: Implement runtime shape, canonical identity, snapshots, and lifecycle**

Create `agent-sidecar/src/session-runtime-manager.ts`:

```ts
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type {
	AgentSession,
	DefaultResourceLoader,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { convertAgentMessagesToChat } from "./pi-session-store.js";
import type { PromptScheduler } from "./prompt-scheduler.js";
import type {
	SessionErrorCode,
	SessionSnapshot,
	SessionStatus,
	SessionWireError,
} from "./session-protocol.js";

export interface PromptRunState {
	activePromptId: string | null;
	startedAt: number;
	hasEmitted: boolean;
}

export interface SessionRuntime {
	sessionFile: string;
	cwd: string;
	session: AgentSession;
	sessionManager: SessionManager;
	resourceLoader: DefaultResourceLoader;
	promptScheduler: PromptScheduler;
	prompt: PromptRunState;
	status: SessionStatus;
	error?: SessionWireError;
	unsubscribe: () => void;
	dispose: () => Promise<void>;
}

export interface SessionRuntimeFactory {
	create(cwd: string): Promise<SessionRuntime>;
	load(sessionFile: string): Promise<SessionRuntime>;
}

export class SessionRuntimeError extends Error {
	constructor(
		message: string,
		readonly code: SessionErrorCode,
		readonly retryable: boolean,
		readonly details?: string,
	) {
		super(message);
		this.name = "SessionRuntimeError";
	}
}

export function canonicalSessionFile(sessionFile: string): string {
	const absolute = resolve(sessionFile);
	try {
		return realpathSync.native(absolute);
	} catch {
		return absolute;
	}
}

export function snapshotRuntime(runtime: SessionRuntime): SessionSnapshot {
	const model = runtime.session.model;
	return {
		sessionFile: runtime.sessionFile,
		mode: "chat",
		cwd: runtime.cwd,
		messages: convertAgentMessagesToChat(runtime.session.messages as unknown[]),
		isRunning: runtime.session.isStreaming || runtime.status === "thinking" || runtime.status === "tool_call" || runtime.status === "responding",
		status: runtime.status,
		queue: {
			steering: [...runtime.session.getSteeringMessages()],
			followUp: [...runtime.session.getFollowUpMessages()],
		},
		model: model
			? { provider: model.provider, id: model.id, name: model.name }
			: undefined,
		error: runtime.error,
	};
}

export class SessionRuntimeManager {
	private readonly runtimes = new Map<string, SessionRuntime>();
	private readonly loading = new Map<string, Promise<SessionRuntime>>();

	constructor(private readonly factory: SessionRuntimeFactory) {}

	get(sessionFile: string): SessionRuntime | undefined {
		return this.runtimes.get(canonicalSessionFile(sessionFile));
	}

	require(sessionFile: string): SessionRuntime {
		const runtime = this.get(sessionFile);
		if (!runtime) {
			throw new SessionRuntimeError(
				"Session is not loaded",
				"session_not_loaded",
				true,
				canonicalSessionFile(sessionFile),
			);
		}
		return runtime;
	}

	async create(cwd: string): Promise<SessionRuntime> {
		return this.remember(await this.factory.create(cwd));
	}

	async load(sessionFile: string): Promise<SessionRuntime> {
		const key = canonicalSessionFile(sessionFile);
		const existing = this.runtimes.get(key);
		if (existing) return existing;
		const pending = this.loading.get(key);
		if (pending) return pending;
		const load = this.factory
			.load(key)
			.then((runtime) => this.remember(runtime))
			.finally(() => this.loading.delete(key));
		this.loading.set(key, load);
		return load;
	}

	async reloadAll(): Promise<void> {
		await Promise.all([...this.runtimes.values()].map((runtime) => runtime.session.reload()));
	}

	async dispose(sessionFile: string): Promise<void> {
		const key = canonicalSessionFile(sessionFile);
		const pending = this.loading.get(key);
		if (pending) await pending.catch(() => undefined);
		const runtime = this.runtimes.get(key);
		if (!runtime) return;
		this.runtimes.delete(key);
		await runtime.dispose();
	}

	async disposeAll(): Promise<void> {
		await Promise.allSettled([...this.loading.values()]);
		const runtimes = [...this.runtimes.values()];
		this.runtimes.clear();
		this.loading.clear();
		await Promise.all(runtimes.map((runtime) => runtime.dispose()));
	}

	private remember(runtime: SessionRuntime): SessionRuntime {
		const key = canonicalSessionFile(runtime.sessionFile);
		const existing = this.runtimes.get(key);
		if (existing) return existing;
		runtime.sessionFile = key;
		this.runtimes.set(key, runtime);
		return runtime;
	}
}
```

Use the SDK's exported `DefaultResourceLoader` concrete type shown above; `buildResourceLoader` returns that type. Do not widen runtime fields to `any`.

- [ ] **Step 4: Run manager tests**

Run:

```bash
cd agent-sidecar && pnpm test -- src/session-runtime-manager.test.ts src/pi-session-store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit runtime manager**

```bash
git add agent-sidecar/src/session-runtime-manager.ts agent-sidecar/src/session-runtime-manager.test.ts agent-sidecar/src/pi-session-store.test.ts
git commit -m "feat(sidecar): add session runtime manager"
```

---

### Task 3: Make Prompt and Extension Events Runtime-local

**Files:**
- Modify: `agent-sidecar/src/prompt-runner.ts`
- Modify: `agent-sidecar/src/subscribe-session.test.ts`
- Modify: `agent-sidecar/src/extension-ui-bridge.ts`
- Create: `agent-sidecar/src/extension-ui-bridge.test.ts`

- [ ] **Step 1: Update subscription tests first**

Replace the forwarding assertion in `agent-sidecar/src/subscribe-session.test.ts` with two-runtime coverage:

```ts
it("tags events and marks only the emitting runtime watchdog", async () => {
	const send = vi.fn();
	vi.doMock("./protocol.js", () => ({
		send,
		log: vi.fn(),
		logDebug: vi.fn(),
		logWarn: vi.fn(),
		logError: vi.fn(),
	}));
	const { subscribeSession } = await import("./prompt-runner.js");
	const callbacks = new Map<string, (event: unknown) => void>();
	const runtime = (sessionFile: string) => ({
		sessionFile,
		status: "thinking",
		error: undefined,
		prompt: { activePromptId: "p", startedAt: 1, hasEmitted: false },
		session: {
			subscribe: (callback: (event: unknown) => void) => {
				callbacks.set(sessionFile, callback);
				return vi.fn();
			},
		},
	});
	const a = runtime("/tmp/a.jsonl");
	const b = runtime("/tmp/b.jsonl");
	subscribeSession(a as never);
	subscribeSession(b as never);
	callbacks.get("/tmp/a.jsonl")?.({ type: "message_update" });
	expect(a.prompt.hasEmitted).toBe(true);
	expect(b.prompt.hasEmitted).toBe(false);
	expect(send).toHaveBeenCalledWith({
		type: "event",
		sessionFile: "/tmp/a.jsonl",
		event: { type: "message_update" },
	});
	vi.resetModules();
});
```

Keep the static regression guard, but update it to ensure all subscriptions live in `session-runtime-factory.ts` and call `subscribeSession(runtime)`.

- [ ] **Step 2: Add failing extension UI identity tests**

Create `agent-sidecar/src/extension-ui-bridge.test.ts` using a fake session whose `bindExtensions` captures `uiContext`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
vi.mock("./protocol.js", () => ({ send }));

import {
	bindExtensionUi,
	cancelSessionUiRequests,
} from "./extension-ui-bridge.js";

describe("extension UI session routing", () => {
	beforeEach(() => send.mockClear());

	it("tags a UI request with the bound session file", async () => {
		let uiContext: { confirm: (title: string, message: string) => Promise<boolean> } | undefined;
		await bindExtensionUi("/tmp/a.jsonl", {
			bindExtensions: async (bindings) => {
				uiContext = bindings.uiContext as typeof uiContext;
			},
		});
		void uiContext?.confirm("Continue?", "Run tool?");
		expect(send).toHaveBeenCalledWith(expect.objectContaining({
			type: "event",
			sessionFile: "/tmp/a.jsonl",
			event: expect.objectContaining({ kind: "ui_request", method: "confirm" }),
		}));
		cancelSessionUiRequests("/tmp/a.jsonl");
	});
});
```

- [ ] **Step 3: Run tests and verify failures**

Run:

```bash
cd agent-sidecar && pnpm test -- src/subscribe-session.test.ts src/extension-ui-bridge.test.ts
```

Expected: FAIL because subscriptions and UI bindings do not accept runtime identity.

- [ ] **Step 4: Refactor prompt-runner state into each runtime**

In `agent-sidecar/src/prompt-runner.ts`:

- delete module globals `currentPromptStartedAt`, `promptHasEmitted`, and `activePromptId`;
- delete their global setter/reset helpers;
- accept the following narrow structural runtime type so the module does not import the manager class at runtime:

```ts
import { makeSessionDone, makeSessionError, makeSessionEvent } from "./session-protocol.js";
import type { SessionRuntime } from "./session-runtime-manager.js";

type PromptRuntime = Pick<
	SessionRuntime,
	"sessionFile" | "session" | "prompt" | "status" | "error"
>;
```

Make `subscribeSession(runtime)` return the SDK unsubscribe function and update only that runtime:

```ts
export function subscribeSession(runtime: PromptRuntime): () => void {
	return runtime.session.subscribe((event: unknown) => {
		if (runtime.prompt.startedAt > 0) runtime.prompt.hasEmitted = true;
		const eventType = (event as { type?: string })?.type;
		if (eventType === "tool_execution_start" || eventType === "tool_execution_update") {
			runtime.status = "tool_call";
		} else if (eventType === "message_update") {
			runtime.status = "responding";
		} else if (eventType === "agent_start" || eventType === "turn_start") {
			runtime.status = "thinking";
		} else if (eventType === "agent_end") {
			runtime.status = "idle";
		} else if (eventType === "error") {
			runtime.status = "error";
		}
		if (eventType && !HIGH_FREQ_EVENTS.has(eventType)) logDebug("event[%s]: %s", runtime.sessionFile, eventType);
		send(makeSessionEvent(runtime.sessionFile, event));
	});
}
```

Change `runPromptTask(cmd, runtime)` to write all watchdog fields through `runtime.prompt`, set `runtime.status`, and send session-aware errors/done:

```ts
runtime.prompt.activePromptId = cmd.id;
runtime.prompt.startedAt = Date.now();
runtime.prompt.hasEmitted = false;
runtime.status = "thinking";
runtime.error = undefined;
```

In the catch block, construct one `SessionWireError`, assign it to `runtime.error`, set `runtime.status = "error"`, and call `send(makeSessionError(cmd.id, runtime.sessionFile, runtime.error))`. In `finally`, clear both timers, reset only `runtime.prompt`, call `send(makeSessionDone(cmd.id, runtime.sessionFile))`, and return status to `idle` only when no error was recorded.

- [ ] **Step 5: Bind extension UI to session identity**

In `agent-sidecar/src/extension-ui-bridge.ts`:

- store `{ sessionFile, resolve }` in `pendingUiRequests`;
- make `emitUiRequest` and `emitUiCancel` accept `sessionFile` and call `send(makeSessionEvent(sessionFile, event))`;
- make `createUiDialog` and `createUiContext` capture `sessionFile`;
- change the public binding signature to:

```ts
export async function bindExtensionUi(
	sessionFile: string,
	session: {
		bindExtensions: (opts: { uiContext: ExtensionUIContext }) => Promise<void>;
	},
): Promise<void> {
	await session.bindExtensions({ uiContext: createUiContext(sessionFile) });
}
```

Add deterministic cleanup used by runtime disposal:

```ts
export function cancelSessionUiRequests(sessionFile: string): void {
	for (const [id, pending] of pendingUiRequests) {
		if (pending.sessionFile !== sessionFile) continue;
		pendingUiRequests.delete(id);
		emitUiCancel(sessionFile, id);
		pending.resolve({ cancelled: true });
	}
}
```

`resolveUiResponse` remains keyed by random request ID and resolves only its stored entry. Extend the disposal test to assert `cancelSessionUiRequests("/tmp/a.jsonl")` emits a session-tagged `ui_cancel`, preventing a stale dialog from remaining visible.

- [ ] **Step 6: Run focused tests**

Run:

```bash
cd agent-sidecar && pnpm test -- src/subscribe-session.test.ts src/extension-ui-bridge.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit event isolation**

```bash
git add agent-sidecar/src/prompt-runner.ts agent-sidecar/src/subscribe-session.test.ts agent-sidecar/src/extension-ui-bridge.ts agent-sidecar/src/extension-ui-bridge.test.ts
git commit -m "refactor(sidecar): scope prompt and UI events by session"
```

---

### Task 4: Route Core Commands to Explicit Runtimes

**Files:**
- Modify: `agent-sidecar/src/commands/types.ts`
- Modify: `agent-sidecar/src/commands/handler-registry.ts`
- Modify: `agent-sidecar/src/commands/handlers/core.ts`
- Create: `agent-sidecar/src/commands/handlers/core.test.ts`
- Modify: `agent-sidecar/src/commands/handlers/auth.ts`
- Modify: `agent-sidecar/src/commands/handlers/settings.ts`

- [ ] **Step 1: Write failing core isolation tests**

Create `agent-sidecar/src/commands/handlers/core.test.ts`. Mock `protocol.send` and `runPromptTask`, build two fake runtimes, and use a manager whose `require(file)` returns by exact key. Cover these behaviors separately:

```ts
it("abort targets A without touching B", async () => {
	await handleAbort(deps, { type: "abort", id: "ab-a", sessionFile: "/a.jsonl" });
	expect(runtimeA.session.abort).toHaveBeenCalledOnce();
	expect(runtimeB.session.abort).not.toHaveBeenCalled();
});

it("steer and follow-up use only the addressed runtime queue", async () => {
	await handleSteer(deps, { type: "steer", id: "st-a", sessionFile: "/a.jsonl", text: "A" });
	await handleFollowUp(deps, { type: "follow_up", id: "fu-b", sessionFile: "/b.jsonl", text: "B" });
	expect(runtimeA.session.steer).toHaveBeenCalledWith("A", undefined);
	expect(runtimeB.session.followUp).toHaveBeenCalledWith("B", undefined);
});

it("unknown runtime returns structured session_not_loaded", async () => {
	await handleClearQueue(deps, { type: "clear_queue", id: "cq-x", sessionFile: "/missing.jsonl" });
	expect(send).toHaveBeenCalledWith(expect.objectContaining({
		type: "error",
		id: "cq-x",
		sessionFile: "/missing.jsonl",
		code: "session_not_loaded",
		retryable: true,
	}));
});

it("terminates an unknown-session prompt after its structured error", async () => {
	await handlePrompt(deps, {
		type: "prompt",
		id: "p-x",
		sessionFile: "/missing.jsonl",
		text: "hello",
	});
	expect(send).toHaveBeenNthCalledWith(1, expect.objectContaining({
		type: "error",
		id: "p-x",
		code: "session_not_loaded",
	}));
	expect(send).toHaveBeenNthCalledWith(2, {
		type: "done",
		id: "p-x",
		sessionFile: "/missing.jsonl",
	});
});
```

Also assert `handlePrompt` schedules on A's scheduler and passes runtime A to `runPromptTask`; assert `handleSetModel` changes A only; assert `handleGetActiveModel` returns A's model and top-level session identity.

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
cd agent-sidecar && pnpm test -- src/commands/handlers/core.test.ts
```

Expected: FAIL because commands and handlers still use singleton dependencies.

- [ ] **Step 3: Require session identity in command types**

Add this shared shape in `agent-sidecar/src/commands/types.ts`:

```ts
interface SessionBoundCommand {
	sessionFile: string;
}
```

Extend it from `GetActiveModelCommand`, `PromptCommand`, `AbortCommand`, `SteerCommand`, `FollowUpCommand`, `ClearQueueCommand`, `SetModelCommand`, and `GetWorkspaceCommand`. Keep `NewSessionCommand` unbound because it creates identity. Keep `LoadSessionCommand`, delete, rename, and pin using their existing `sessionFile` field.

Add explicit scope inputs instead of reading an active sidecar workspace:

```ts
export interface ListSessionsCommand {
	type: "list_sessions";
	id: string;
	allFolders?: boolean;
	cwd?: string;
}

export interface SearchSessionsCommand {
	type: "search_sessions";
	id: string;
	query: string;
	allFolders?: boolean;
	cwd?: string;
}
```

- [ ] **Step 4: Replace singleton handler dependencies**

In `agent-sidecar/src/commands/handler-registry.ts`, remove `session`, `sessionManager`, `resourceLoader`, `workspaceCwd`, `promptScheduler`, `buildResourceLoader`, `bindExtensionUi`, and their setters. Add:

```ts
runtimeManager: SessionRuntimeManager;
```

Keep shared `authStorage`, `modelRegistry`, `settingsManager`, `zosmaDir`, OAuth state, `initAgent`, `resolveUiResponse`, and OAuth setters.

- [ ] **Step 5: Resolve the target runtime once per core command**

Add a private helper in `agent-sidecar/src/commands/handlers/core.ts`:

```ts
function runtimeFor(
	deps: HandlerDependencies,
	cmd: { id: string; sessionFile: string },
): SessionRuntime | undefined {
	try {
		return deps.runtimeManager.require(cmd.sessionFile);
	} catch (error) {
		const runtimeError = error as SessionRuntimeError;
		sendMsg(makeSessionError(cmd.id, cmd.sessionFile, {
			code: runtimeError.code ?? "session_not_loaded",
			message: runtimeError.message,
			retryable: runtimeError.retryable ?? true,
			details: runtimeError.details,
		}));
		return undefined;
	}
}
```

Use it independently in every session-bound handler:

- `handleGetActiveModel`: read `runtime.session.model` and `thinkingLevel`.
- `handlePrompt`: if `runtimeFor` returns `undefined`, immediately send `makeSessionDone(cmd.id, cmd.sessionFile)` after the structured error so Tauri removes its pending channel. Otherwise call `runtime.promptScheduler.schedule(() => runPromptTask(cmd, runtime), onError)`. The scheduler `onError` path must also send both `makeSessionError` and `makeSessionDone`.
- `handleAbort`: `await runtime.session.abort()` then send `{ aborted: true }` through `makeSessionResult`.
- `handleSteer`: call `runtime.session.steer`.
- `handleFollowUp`: call `runtime.session.followUp`.
- `handleClearQueue`: call `runtime.session.clearQueue()` and return the drained `{ steering, followUp }` directly, not nested below `drained`, because the frontend consumes that shape.
- `handleSetModel`: find in shared `modelRegistry`, then call only `runtime.session.setModel(found)`.

All success/error envelopes from these handlers use the command's `sessionFile`. Keep `get_models`, auth, init, and `ui_response` global.

- [ ] **Step 6: Update shared handlers that referenced one session**

In `agent-sidecar/src/commands/handlers/settings.ts`, make instruction reload apply to every loaded runtime:

```ts
try {
	await deps.runtimeManager.reloadAll();
} catch (reloadError) {
	log(
		"save_instructions: runtime reload failed (applies on next new chat): %s",
		reloadError instanceof Error ? reloadError.message : String(reloadError),
	);
}
```

In `agent-sidecar/src/commands/handlers/auth.ts`, change logout's initialization guard from `deps.sessionManager` to `deps.runtimeManager`. Auth/model registry operations remain shared.

- [ ] **Step 7: Run core and existing steering tests**

Run:

```bash
cd agent-sidecar && pnpm test -- src/commands/handlers/core.test.ts src/steering.test.ts src/prompt-scheduler.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit command routing**

```bash
git add agent-sidecar/src/commands/types.ts agent-sidecar/src/commands/handler-registry.ts agent-sidecar/src/commands/handlers/core.ts agent-sidecar/src/commands/handlers/core.test.ts agent-sidecar/src/commands/handlers/auth.ts agent-sidecar/src/commands/handlers/settings.ts
git commit -m "refactor(sidecar): route agent commands by session"
```

---

### Task 5: Build Pi Runtimes and Rewire Session Lifecycle

**Files:**
- Create: `agent-sidecar/src/session-runtime-factory.ts`
- Create: `agent-sidecar/src/session-runtime-factory.test.ts`
- Modify: `agent-sidecar/src/commands/handlers/sessions.ts`
- Create: `agent-sidecar/src/commands/handlers/sessions.test.ts`
- Modify: `agent-sidecar/src/index.ts`
- Modify: `agent-sidecar/src/zosma-auth/index.test.ts`

- [ ] **Step 1: Write failing session lifecycle tests**

In `agent-sidecar/src/commands/handlers/sessions.test.ts`, mock protocol sending and use a fake runtime manager. Test each behavior separately:

```ts
it("new_session returns a complete runtime snapshot", async () => {
	await handleNewSession(deps, { type: "new_session", id: "n-1", cwd: "/work" });
	expect(deps.runtimeManager.create).toHaveBeenCalledWith("/work");
	expect(send).toHaveBeenCalledWith(expect.objectContaining({
		type: "result",
		id: "n-1",
		sessionFile: "/work/new.jsonl",
		data: expect.objectContaining({
			sessionFile: "/work/new.jsonl",
			cwd: "/work",
			messages: [],
			isRunning: false,
			status: "idle",
		}),
	}));
});

it("load_session is idempotent through the manager and does not abort another runtime", async () => {
	await handleLoadSession(deps, { type: "load_session", id: "l-1", sessionFile: "/a.jsonl" });
	expect(deps.runtimeManager.load).toHaveBeenCalledWith("/a.jsonl");
	expect(runtimeB.session.abort).not.toHaveBeenCalled();
});

it("delete disposes the loaded runtime before deleting persistence", async () => {
	await handleDeleteSession(deps, { type: "delete_session", id: "d-1", sessionFile: "/a.jsonl" });
	expect(deps.runtimeManager.dispose).toHaveBeenCalledWith("/a.jsonl");
	expect(deps.runtimeManager.dispose.mock.invocationCallOrder[0]).toBeLessThan(
		deletePiSession.mock.invocationCallOrder[0],
	);
});
```

Mock persistence for deletion and list/search with:

```ts
vi.mock("../../pi-session-store.js", () => ({
	deletePiSession: vi.fn(() => true),
	listPiSessions: vi.fn(async () => []),
	renamePiSession: vi.fn(() => true),
	searchPiSessions: vi.fn(async () => []),
	setPiSessionPinned: vi.fn(() => true),
}));
```

Add tests proving list/search use `cmd.cwd` when `allFolders` is false and `undefined` when true.

- [ ] **Step 2: Run session tests and verify failure**

Run:

```bash
cd agent-sidecar && pnpm test -- src/commands/handlers/sessions.test.ts
```

Expected: FAIL because session handlers still rebind singleton state.

- [ ] **Step 3: Write a failing Pi runtime-factory isolation test**

Create `agent-sidecar/src/session-runtime-factory.test.ts` with hoisted SDK/resource mocks:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	createAgentSession: vi.fn(),
	createManager: vi.fn(),
	buildResourceLoader: vi.fn(),
	bindExtensionUi: vi.fn(),
	subscribeSession: vi.fn(() => vi.fn()),
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
	SessionManager: { create: mocks.createManager },
	createAgentSession: mocks.createAgentSession,
}));
vi.mock("./agent-init.js", () => ({
	buildResourceLoader: mocks.buildResourceLoader,
	resolveWorkspace: (cwd: string) => cwd,
}));
vi.mock("./extension-ui-bridge.js", () => ({
	bindExtensionUi: mocks.bindExtensionUi,
	cancelSessionUiRequests: vi.fn(),
}));
vi.mock("./prompt-runner.js", () => ({ subscribeSession: mocks.subscribeSession }));
vi.mock("./pi-session-store.js", () => ({ loadPiSession: vi.fn() }));

import { createPiRuntimeFactory } from "./session-runtime-factory.js";

function fakeSession(file: string) {
	return {
		messages: [],
		isStreaming: false,
		model: { provider: "test", id: file, name: file },
		getSteeringMessages: () => [],
		getFollowUpMessages: () => [],
		abort: vi.fn().mockResolvedValue(undefined),
		dispose: vi.fn(),
		bindExtensions: vi.fn().mockResolvedValue(undefined),
		subscribe: vi.fn(() => vi.fn()),
	};
}

describe("createPiRuntimeFactory", () => {
	beforeEach(() => {
		mocks.createManager.mockReset().mockImplementation((cwd: string) => ({
			getSessionFile: () => `${cwd}/session.jsonl`,
		}));
		mocks.buildResourceLoader.mockReset().mockImplementation(async (cwd: string) => ({ cwd }));
		mocks.createAgentSession.mockReset().mockImplementation(async ({ sessionManager }) => ({
			session: fakeSession(sessionManager.getSessionFile()),
		}));
	});

	it("creates distinct cwd-bound resources and schedulers", async () => {
		const factory = createPiRuntimeFactory({
			zosmaDir: "/zosma",
			authStorage: {} as never,
			modelRegistry: {} as never,
			settingsManager: {} as never,
		});
		const a = await factory.create("/work/a");
		const b = await factory.create("/work/b");
		expect(a.cwd).toBe("/work/a");
		expect(b.cwd).toBe("/work/b");
		expect(a.resourceLoader).not.toBe(b.resourceLoader);
		expect(a.promptScheduler).not.toBe(b.promptScheduler);
		expect(mocks.bindExtensionUi).toHaveBeenCalledWith(a.sessionFile, a.session);
		expect(mocks.bindExtensionUi).toHaveBeenCalledWith(b.sessionFile, b.session);
	});
});
```

Run:

```bash
cd agent-sidecar && pnpm test -- src/session-runtime-factory.test.ts
```

Expected: FAIL because `session-runtime-factory.ts` does not exist.

- [ ] **Step 4: Implement the one real Pi runtime factory**

Create `agent-sidecar/src/session-runtime-factory.ts` with a dependency object containing `zosmaDir`, `authStorage`, `modelRegistry`, and `settingsManager`. Its returned factory must:

1. use `SessionManager.create(cwd)` for new sessions;
2. use `loadPiSession(canonicalFile).manager` and the saved header cwd for loaded sessions;
3. call `buildResourceLoader(cwd, zosmaDir, settingsManager)` for every runtime;
4. call `createAgentSession` with the runtime's manager and loader;
5. initialize a fresh `createPromptScheduler()` and prompt state;
6. construct the runtime before subscribing, then assign `runtime.unsubscribe = subscribeSession(runtime)`;
7. call `bindExtensionUi(runtime.sessionFile, runtime.session)`;
8. dispose in this order: cancel session UI requests, await abort when streaming, await scheduler idle, unsubscribe, then `session.dispose()`.

Use this concrete structure:

```ts
export interface PiRuntimeFactoryDependencies {
	zosmaDir: string;
	authStorage: AuthStorage;
	modelRegistry: ModelRegistry;
	settingsManager: SettingsManager;
}

export function createPiRuntimeFactory(
	deps: PiRuntimeFactoryDependencies,
): SessionRuntimeFactory {
	async function build(sessionManager: SessionManager, cwd: string): Promise<SessionRuntime> {
		const resourceLoader = await buildResourceLoader(cwd, deps.zosmaDir, deps.settingsManager);
		const { session } = await createAgentSession({
			cwd,
			authStorage: deps.authStorage,
			modelRegistry: deps.modelRegistry,
			sessionManager,
			settingsManager: deps.settingsManager,
			resourceLoader,
		});
		const sessionFile = sessionManager.getSessionFile();
		if (!sessionFile) throw new Error("Pi did not create a persisted session file");
		const runtime: SessionRuntime = {
			sessionFile: canonicalSessionFile(sessionFile),
			cwd,
			session,
			sessionManager,
			resourceLoader,
			promptScheduler: createPromptScheduler(),
			prompt: { activePromptId: null, startedAt: 0, hasEmitted: false },
			status: "idle",
			error: undefined,
			unsubscribe: () => {},
			dispose: async () => {
				cancelSessionUiRequests(runtime.sessionFile);
				if (session.isStreaming) await session.abort();
				await runtime.promptScheduler.idle();
				runtime.unsubscribe();
				session.dispose();
			},
		};
		runtime.unsubscribe = subscribeSession(runtime);
		await bindExtensionUi(runtime.sessionFile, session);
		return runtime;
	}

	return {
		create: async (cwd) => build(SessionManager.create(cwd), cwd),
		load: async (sessionFile) => {
			const loaded = loadPiSession(sessionFile);
			const cwd = resolveWorkspace(loaded.cwd, deps.zosmaDir);
			return build(loaded.manager, cwd);
		},
	};
}
```

Retain the best-effort `.pi/cowork_active` marker by moving its write into `build()` for each runtime cwd.

- [ ] **Step 5: Rewrite session handlers around manager operations**

In `agent-sidecar/src/commands/handlers/sessions.ts`:

- delete `spawnSession`, direct `createAgentSession`, direct resource-loader mutation, all `deps.session.abort()` calls, and all singleton setters;
- `handleNewSession`: resolve `cmd.cwd` with `resolveWorkspace`, call `runtimeManager.create`, and return `snapshotRuntime(runtime)` through `makeSessionResult`;
- `handleLoadSession`: call `runtimeManager.load(cmd.sessionFile)` and return its snapshot; map failures to `session_load_failed`, `retryable: true`;
- `handleGetWorkspace`: require `cmd.sessionFile`, then return `{ cwd: runtime.cwd, default: defaultWorkspaceDir(deps.zosmaDir) }` through `makeSessionResult`;
- `handleListSessions`: pass `cmd.allFolders ? undefined : cmd.cwd` to `listPiSessions`;
- `handleSearchSessions`: pass `cmd.allFolders ? undefined : cmd.cwd` to `searchPiSessions`;
- `handleDeleteSession`: await `runtimeManager.dispose(cmd.sessionFile)` before `deletePiSession`;
- leave rename/pin persistence behavior unchanged, but keep their existing session identity fields;
- keep `save_session` as a no-op compatibility command;
- `handleReload`: call `deps.initAgent(deps.zosmaDir)` and let `initAgent` dispose old runtimes first.

- [ ] **Step 6: Replace index-level singleton agent state**

In `agent-sidecar/src/index.ts`:

- remove `session`, `sessionManager`, `resourceLoader`, `promptScheduler`, `workspaceCwd`, and the unused local `activePromptId`;
- retain global auth/model/settings and OAuth state;
- add `let runtimeManager: SessionRuntimeManager | undefined`;
- split `initAgent` into first initialization and in-process refresh behavior;
- expose `runtimeManager` through `HandlerDependencies` and delete obsolete setters;
- on stdin close, await `runtimeManager?.disposeAll()` before exiting;
- in the outer command catch, use `cmd.sessionFile` when present to send `makeSessionError`; for a failed `prompt` command also send `makeSessionDone` so no pending relay channel leaks.

First initialization creates shared auth/model/settings, constructs `SessionRuntimeManager(createPiRuntimeFactory(sharedDeps))`, creates one initial runtime for `resolveWorkspace(workspace, zosmaDir)`, and emits ready with `session: snapshotRuntime(initialRuntime)` plus `defaultWorkspace`.

Subsequent `initAgent` calls are provider/resource refreshes triggered by auth, settings, or `reload`. They must preserve the same runtime manager and session identities:

```ts
if (runtimeManager && authStorage && modelRegistry && settingsManager) {
	modelRegistry.refresh();
	const piPackages = readPiPackages(piAgentDir());
	settingsManager.setPackages(piPackages);
	applyBundledNpm(settingsManager);
	await runtimeManager.reloadAll();
	await emitReady({ defaultWorkspace: defaultWorkspaceDir(zosmaDir) });
	return;
}
```

`emitReady` is a local helper that reads the current available model catalog. Its optional argument includes `session` only on first initialization. Do not dispose or replace runtimes during an in-process auth/reload, because App continues targeting their files.

The dependency getter must fail loudly only before first initialization:

```ts
get runtimeManager() {
	if (!runtimeManager) throw new Error("Runtime manager not initialized");
	return runtimeManager;
},
```

Add a regression test in `commands/handlers/sessions.test.ts` that reads `../../index.ts`, isolates the `initAgent` function text, asserts the existing-manager branch calls `runtimeManager.reloadAll()`, and asserts that branch does not contain `disposeAll()`. Keep runtime disposal in the stdin-close shutdown block. Existing provider-auth tests must continue to prove refreshed models become visible.

- [ ] **Step 7: Keep provider reload tests compatible**

`completeZosmaAuth`, disconnect, and refresh continue calling `deps.initAgent(deps.zosmaDir)`. Update their fake `HandlerDependencies` in `agent-sidecar/src/zosma-auth/index.test.ts` to provide `runtimeManager`; remove singleton session fields from those fakes. Do not change auth transaction behavior.

- [ ] **Step 8: Run sidecar lifecycle tests and typecheck**

Run:

```bash
cd agent-sidecar && pnpm test -- src/commands/handlers/sessions.test.ts src/zosma-auth/index.test.ts src/session-runtime-manager.test.ts src/session-runtime-factory.test.ts
cd agent-sidecar && pnpm build
```

Expected: both commands PASS. TypeScript emits no errors.

- [ ] **Step 9: Run full sidecar test suite**

Run:

```bash
cd agent-sidecar && pnpm test
```

Expected: PASS with pristine output.

- [ ] **Step 10: Commit sidecar runtime integration**

```bash
git add agent-sidecar/src/session-runtime-factory.ts agent-sidecar/src/session-runtime-factory.test.ts agent-sidecar/src/commands/handlers/sessions.ts agent-sidecar/src/commands/handlers/sessions.test.ts agent-sidecar/src/index.ts agent-sidecar/src/zosma-auth/index.test.ts
git commit -m "feat(sidecar): manage persisted sessions as isolated runtimes"
```

---

### Task 6: Preserve Session Identity Through Tauri Relay

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add failing Rust payload tests**

Update the existing payload helpers' tests and add prompt/abort/model tests. Each session-bound payload must include exactly the target file:

```rust
#[test]
fn prompt_payload_carries_session_identity() {
    let p = build_prompt_payload("p-1", "/sessions/a.jsonl", "hello");
    assert_eq!(p["type"], "prompt");
    assert_eq!(p["id"], "p-1");
    assert_eq!(p["sessionFile"], "/sessions/a.jsonl");
    assert_eq!(p["text"], "hello");
}

#[test]
fn queue_payloads_carry_session_identity() {
    let steer = build_steer_payload("s-1", "/sessions/a.jsonl", "change");
    let follow = build_follow_up_payload("f-1", "/sessions/b.jsonl", "later");
    let clear = build_clear_queue_payload("c-1", "/sessions/a.jsonl");
    assert_eq!(steer["sessionFile"], "/sessions/a.jsonl");
    assert_eq!(follow["sessionFile"], "/sessions/b.jsonl");
    assert_eq!(clear["sessionFile"], "/sessions/a.jsonl");
}
```

Add a pure `matches_prompt_session(&PendingPrompt, &Value)` test proving an A event does not match B. Derive no serialization on `PendingPrompt`; the helper only compares its `session_file` with envelope `sessionFile`.

- [ ] **Step 2: Run Rust tests and verify failure**

Run:

```bash
cargo test --workspace prompt_payload_carries_session_identity
```

Expected: FAIL because builders do not accept session files.

- [ ] **Step 3: Store session identity with pending prompt channels**

Change the Rust relay state:

```rust
struct PendingPrompt {
    session_file: String,
    channel: Channel<Value>,
}

fn matches_prompt_session(prompt: &PendingPrompt, envelope: &Value) -> bool {
    envelope
        .get("sessionFile")
        .and_then(Value::as_str)
        .is_some_and(|file| file == prompt.session_file)
}
```

In `read_stdout`:

- for `event`, retain the full sidecar envelope and send it only to pending prompt channels whose `session_file` matches;
- emit every full session envelope as Tauri event `session_event` for queue updates and Phase 2's future keyed listener;
- for `ui_request`, `ui_cancel`, and OAuth/reload events, preserve current event names; when a sidecar event has `sessionFile`, add that field to the emitted payload without removing `kind`, `id`, or method fields;
- for `done`, remove the matching command ID and send this channel payload:

```rust
serde_json::json!({
    "type": "event",
    "sessionFile": session_file,
    "event": { "type": "done" }
})
```

- for a prompt `error`, send an event envelope containing `message`, `details`, `code`, and `retryable` from the sidecar error;
- for a one-shot request error, return `m.to_string()` so structured fields survive the Tauri rejection instead of collapsing to the message alone.

- [ ] **Step 4: Add `session_file` to every Tauri session command**

Use `session_file: String` Rust arguments and include `sessionFile` in JSON for:

- `get_active_model`;
- `send_prompt`;
- `abort_prompt`;
- `steer_prompt`;
- `follow_up_prompt`;
- `clear_queue`;
- `set_active_model`;
- `get_workspace`.

Use unique command IDs for abort and set-model instead of fixed `"ab"`/`"sm"`. Make abort use `scmd_r` and await the sidecar result so App can safely stop before switching.

The prompt wrapper becomes:

```rust
#[tauri::command]
async fn send_prompt(
    session_file: String,
    text: String,
    ch: Channel<Value>,
    s: State<'_, AppState>,
) -> Result<(), String> {
    if !s.sidecar.ready.load(Ordering::Acquire) {
        return Err("not ready".into());
    }
    let id = format!("p-{}", uuid_v4());
    s.pending_prompts.lock().await.insert(
        id.clone(),
        PendingPrompt { session_file: session_file.clone(), channel: ch },
    );
    if let Err(error) = scmd(&s, &build_prompt_payload(&id, &session_file, &text)).await {
        s.pending_prompts.lock().await.remove(&id);
        return Err(error);
    }
    Ok(())
}
```

Update list/search relay commands to accept `all_folders: Option<bool>` and `cwd: Option<String>`, forwarding both fields. Keep new/load/delete/rename/pin session identity as currently named.

Map `get_workspace`'s sidecar result to only its `cwd` string because `useFileMention` consumes a path; initial `defaultWorkspace` comes from ready payload.

- [ ] **Step 5: Run Rust formatting and focused tests**

Run:

```bash
cargo fmt --check
cargo test --workspace
```

Expected: PASS.

- [ ] **Step 6: Commit relay identity**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(tauri): route agent traffic by session file"
```

---

### Task 7: Thread Explicit Session Identity Through Existing Frontend

**Files:**
- Create: `src/types/session-runtime.ts`
- Modify: `src/hooks/usePiStream.ts`
- Create: `src/hooks/usePiStream.session.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/hooks/useProviders.ts`
- Modify: `src/hooks/useFileMention.ts`
- Modify: `src/hooks/useFileMention.test.ts`
- Modify: `src/components/MessageInput.tsx`
- Modify: `src/components/MessageInput.test.tsx`
- Modify: `src/chat/ChatView.tsx`
- Modify: `src/chat/ChatView.test.tsx`

- [ ] **Step 1: Run existing frontend stream and composer tests**

Run:

```bash
pnpm test -- src/hooks/usePiStream.test.ts src/hooks/useFileMention.test.ts src/components/MessageInput.test.tsx src/chat/ChatView.test.tsx
```

Expected: PASS before modifying tested code.

- [ ] **Step 2: Add frontend wire types**

Create `src/types/session-runtime.ts`:

```ts
import type { ChatMessage } from "@/types";
import type { PiEvent } from "@/types/pi-events";

export type SessionStatus = "idle" | "thinking" | "tool_call" | "responding" | "error";

export interface SessionWireError {
	code: string;
	message: string;
	retryable: boolean;
	details?: string;
}

export interface SessionSnapshot {
	sessionFile: string;
	mode: "chat";
	cwd: string;
	messages: ChatMessage[];
	isRunning: boolean;
	status: SessionStatus;
	queue: { steering: string[]; followUp: string[] };
	model?: { provider?: string; id?: string; name?: string };
	error?: SessionWireError;
}

export interface SessionEventEnvelope {
	type: "event";
	sessionFile: string;
	event: PiEvent;
}

export interface SidecarReadyPayload {
	session?: SessionSnapshot;
	defaultWorkspace?: string;
	sidecarRestarted?: boolean;
}
```

- [ ] **Step 3: Write failing hook identity tests**

Create `src/hooks/usePiStream.session.test.ts` with hoisted Tauri mocks. Capture created channels so tests can inject envelopes:

```ts
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	listeners: new Map<string, (event: { payload: unknown }) => void>(),
	channels: [] as Array<{ onmessage?: (value: unknown) => void }>,
}));

vi.mock("@tauri-apps/api/core", () => ({
	invoke: mocks.invoke,
	Channel: class {
		onmessage?: (value: unknown) => void;
		constructor() { mocks.channels.push(this); }
	},
}));

vi.mock("@tauri-apps/api/event", () => ({
	listen: vi.fn(async (name: string, callback: (event: { payload: unknown }) => void) => {
		mocks.listeners.set(name, callback);
		return () => mocks.listeners.delete(name);
	}),
}));

import { usePiStream } from "./usePiStream";

describe("usePiStream session identity", () => {
	beforeEach(() => {
		mocks.invoke.mockReset().mockResolvedValue({ steering: [], followUp: [] });
		mocks.channels.length = 0;
		mocks.listeners.clear();
	});

	it("includes sessionFile in every prompt operation", async () => {
		const { result } = renderHook(() => usePiStream("/sessions/a.jsonl"));
		await act(async () => result.current.startStream("/sessions/a.jsonl", "hello"));
		expect(mocks.invoke).toHaveBeenCalledWith("send_prompt", expect.objectContaining({
			sessionFile: "/sessions/a.jsonl",
			text: "hello",
		}));
		await act(async () => result.current.abortStream("/sessions/a.jsonl"));
		expect(mocks.invoke).toHaveBeenCalledWith("abort_prompt", {
			sessionFile: "/sessions/a.jsonl",
		});
	});

	it("ignores a channel event tagged for another session", async () => {
		const { result } = renderHook(() => usePiStream("/sessions/a.jsonl"));
		await act(async () => result.current.startStream("/sessions/a.jsonl", "hello"));
		act(() => {
			mocks.channels[0].onmessage?.({
				type: "event",
				sessionFile: "/sessions/b.jsonl",
				event: { type: "done" },
			});
		});
		expect(result.current.state.isRunning).toBe(true);
	});
});
```

Add assertions for `steerStream`, `followUpStream`, and `clearQueue` session arguments. Add one test that invokes the registered `session_event` listener with A and B queue updates and verifies only active A changes the current reducer.

Add complete hydration and late-event regression tests:

```ts
const snapshot = (sessionFile: string, content: string) => ({
	sessionFile,
	mode: "chat" as const,
	cwd: `/work/${sessionFile.at(-6)}`,
	messages: [{ id: content, role: "assistant" as const, content, timestamp: 1 }],
	isRunning: false,
	status: "error" as const,
	queue: { steering: ["steer"], followUp: ["later"] },
	model: { provider: "test", id: "model", name: "Model" },
	error: { code: "provider_error", message: "failed", retryable: true },
});

it("hydrates every snapshot field into the single active reducer", () => {
	const { result } = renderHook(() => usePiStream("/sessions/a.jsonl"));
	act(() => result.current.hydrateSession(snapshot("/sessions/a.jsonl", "A history")));
	expect(result.current.state).toMatchObject({
		messages: [expect.objectContaining({ content: "A history" })],
		isRunning: false,
		status: "error",
		error: "failed",
		sessionError: { code: "provider_error", message: "failed", retryable: true },
		queue: { steering: ["steer"], followUp: ["later"] },
	});
});

it("ignores late A events after hydrating B", async () => {
	const { result } = renderHook(() => usePiStream("/sessions/a.jsonl"));
	act(() => result.current.hydrateSession(snapshot("/sessions/a.jsonl", "A history")));
	await act(async () => result.current.startStream("/sessions/a.jsonl", "A prompt"));
	const aChannel = mocks.channels[0];
	act(() => result.current.hydrateSession(snapshot("/sessions/b.jsonl", "B history")));
	act(() => {
		aChannel.onmessage?.({
			type: "event",
			sessionFile: "/sessions/a.jsonl",
			event: { type: "done" },
		});
	});
	expect(result.current.state.messages.map((message) => message.content)).toEqual(["B history"]);
	expect(result.current.state.error).toBe("failed");
});
```

Add a reducer test in `usePiStream.test.ts`: hydrate saved history, dispatch `START_STREAM`, and assert the saved messages remain before the new user prompt.

- [ ] **Step 4: Run hook test and verify failure**

Run:

```bash
pnpm test -- src/hooks/usePiStream.session.test.ts
```

Expected: FAIL because the hook uses untagged `PiEvent` channels and global invokes.

- [ ] **Step 5: Make `usePiStream` target explicit sessions**

Change the hook signature to `usePiStream(activeSessionFile: string | null)`. Keep one reducer. Add `sessionError: SessionWireError | null` to `StreamState`/`INITIAL_STATE` so hydration retains the structured form while existing `error: string | null` continues feeding `ErrorBanner`. Add a `HYDRATE_SESSION` action carrying `SessionSnapshot`. Its reducer branch restores:

```ts
case "HYDRATE_SESSION":
	return {
		...INITIAL_STATE,
		messages: action.snapshot.messages,
		isRunning: action.snapshot.isRunning,
		status: action.snapshot.status,
		error: action.snapshot.error?.message ?? null,
		sessionError: action.snapshot.error ?? null,
		queue: action.snapshot.queue,
	};
```

Change `START_STREAM` to preserve `state.messages` and append the new user prompt rather than spreading `INITIAL_STATE` and erasing history. Reset only turn-local fields (`streamingMessage`, `streamSegments`, `promptEchoConsumed`, status, `error`, and `sessionError`) while preserving persisted messages, queue history labels, and the session's queued messages.

Expose these operations:

```ts
hydrateSession(snapshot: SessionSnapshot): void
startStream(sessionFile: string, text: string): Promise<void>
abortStream(sessionFile: string): Promise<void>
steerStream(sessionFile: string, text: string): Promise<void>
followUpStream(sessionFile: string, text: string): Promise<void>
clearQueue(sessionFile: string): Promise<QueueSnapshot>
```

Add current-session and generation refs inside the hook:

```ts
const activeSessionRef = useRef(activeSessionFile);
const generationRef = useRef(0);

const hydrateSession = useCallback((snapshot: SessionSnapshot) => {
	activeSessionRef.current = snapshot.sessionFile;
	generationRef.current += 1;
	setToolPhase(null);
	dispatch({ type: "HYDRATE_SESSION", snapshot });
}, []);
```

Synchronize `activeSessionRef` from the prop in `useLayoutEffect` for active-session deletion/reset paths. At every `startStream`, set `activeSessionRef.current = sessionFile` and capture `const generation = ++generationRef.current`. Use `Channel<SessionEventEnvelope>`, and reject an event unless all three checks pass:

```ts
if (
	envelope.sessionFile !== sessionFile ||
	activeSessionRef.current !== sessionFile ||
	generationRef.current !== generation
) return;
```

This prevents an aborted A channel from mutating the reducer after B is hydrated, even though the envelope correctly says A.

Pass `{ sessionFile }` in every Tauri invoke. Replace the dedicated `queue_update` listener with a typed `session_event` listener. Its callback reads `tauriEvent.payload` as `SessionEventEnvelope`, compares `payload.sessionFile` with `activeSessionRef.current`, and dispatches only when `payload.event.type === "queue_update"`.

Keep optimistic queue actions and existing event-to-reducer parsing unchanged.

- [ ] **Step 6: Make workspace file mentions session-specific**

Update `useFileMention` to accept `sessionFile: string`. Replace the single module cache with `Map<string, FileEntry[]>`, where the key is the returned workspace root. Fetch root with:

```ts
const root = await invoke<string>("get_workspace", { sessionFile });
```

Reset/reload entries when `sessionFile` changes. Add a test rendering with A, rerendering with B, and asserting each workspace gets its own `readDir` call and results.

Add required `sessionFile: string` props to `MessageInput` and `ChatView`, then pass the active file through to `useFileMention`. Existing empty startup always adopts the initial ready snapshot before rendering ChatView; use `activeSessionFile ?? ""` only at the top render boundary, and make the hook skip loading when the string is empty.

- [ ] **Step 7: Adopt session snapshots in App**

Move the `usePiStream(activeSessionFile)` call below `activeSessionFile` state creation so hook order remains unconditional. Destructure `hydrateSession` and stop maintaining a second `loadedSessionMessages` store.

Make the stream reducer the single owner of the active session's complete message history:

- `displayMessages` becomes `streamState.messages`;
- remove `loadedSessionMessages`, its merge branches, and `CLEAR_MESSAGES` from the stream-completion effect;
- the completion effect only reconciles sidebar metadata from `streamState.messages` and Pi persistence;
- ready/new/load all call `hydrateSession(snapshot)` before rendering or sending.

Add one local App helper that applies non-reducer snapshot fields:

```ts
const adoptSnapshot = useCallback((snapshot: SessionSnapshot) => {
	setActiveSessionFile(snapshot.sessionFile);
	setWorkspaceCwd(snapshot.cwd);
	hydrateSession(snapshot);
	if (snapshot.model?.id) {
		setActiveModelId(modelKey(snapshot.model.provider, snapshot.model.id));
	}
}, [hydrateSession]);
```

Update the real sidecar `ready` listener to read `SidecarReadyPayload`:

1. Always apply `payload.defaultWorkspace` when present.
2. Ignore the earlier spawn-level ready payload when it has no session.
3. If `payload.session` exists and `activeSessionFile` is null, call `adoptSnapshot(payload.session)`.
4. If `payload.session` exists but App already targets a different file, this is a new sidecar process after loss. Call `load_session` for the existing `activeSessionFile` and adopt the returned snapshot. If reload fails because that file no longer exists, explicitly adopt `payload.session` so App never targets a disposed/missing runtime.
5. In-process auth/resource refreshes from Task 5 emit ready without replacing `session`, so the current identity remains valid.

Register the listener with current `activeSessionFile` and `adoptSnapshot` dependencies, and use a cancellation flag so an old async reload cannot adopt after cleanup.

Update session operations:

- first send: invoke `new_session` only if no ready snapshot was adopted; require a real `SessionSnapshot`; remove client-invented `session-${Date.now()}.jsonl` fallbacks; on failure log and return without calling `startStream`;
- send: call `startStream(sessionFile, text)` after the snapshot was adopted;
- abort/steer/follow-up/clear: pass `activeSessionFile` through wrappers given to `ChatView`;
- create/switch: if the current stream is running, await `abortStream(activeSessionFile)` before invoking `new_session` or `load_session`; do not set the destination active file early. After invoke resolves, call `adoptSnapshot(snapshot)`, which synchronously advances the hook generation before late events can be reduced;
- load: hydrate `messages`, `queue`, `status`, `isRunning`, and structured `error` through the full snapshot; apply cwd/model through `adoptSnapshot`; do not issue a second global model mutation after load;
- active-session delete: set `activeSessionFile` to null and dispatch `RESET`, causing the hook's layout-effect guard to invalidate the old generation;
- model restore/select: pass `sessionFile` to `get_active_model` and `set_active_model`; wait until `activeSessionFile` exists before setting `settingsLoadedRef.current`;
- list/search: pass `{ allFolders, cwd: workspaceCwd }`;
- new session: after adopting its snapshot, set the user's currently selected model on that exact new `sessionFile` before the first prompt;
- remove the startup `get_workspace` effect because ready/load/new snapshots now supply cwd and default workspace.

Delete the unused global `setModel` callback from `useProviders`; App already owns model selection.

- [ ] **Step 8: Run focused frontend tests**

Run:

```bash
pnpm test -- src/hooks/usePiStream.session.test.ts src/hooks/usePiStream.test.ts src/hooks/useFileMention.test.ts src/components/MessageInput.test.tsx src/chat/ChatView.test.tsx
pnpm run typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 9: Run full frontend validation**

Run:

```bash
pnpm run validate
pnpm run build:frontend
```

Expected: PASS.

- [ ] **Step 10: Commit frontend identity plumbing**

```bash
git add src/types/session-runtime.ts src/hooks/usePiStream.ts src/hooks/usePiStream.session.test.ts src/App.tsx src/hooks/useProviders.ts src/hooks/useFileMention.ts src/hooks/useFileMention.test.ts src/components/MessageInput.tsx src/components/MessageInput.test.tsx src/chat/ChatView.tsx src/chat/ChatView.test.tsx
git commit -m "refactor(frontend): target active agent session explicitly"
```

---

### Task 8: Phase Boundary Regression and Manual Acceptance

**Files:**
- No changes expected.
- Any regression fix must stay within files already listed in Tasks 1–7.

- [ ] **Step 1: Run all automated gates**

Run from repository root:

```bash
pnpm run validate
pnpm run build:frontend
(cd agent-sidecar && pnpm test && pnpm build)
cargo fmt --check
cargo clippy --workspace -- -D warnings
cargo test --workspace
```

Expected: every command exits `0` with no warnings.

- [ ] **Step 2: Verify session identity is present end to end**

Run:

```bash
rg 'type: "(prompt|abort|steer|follow_up|clear_queue|set_model|get_active_model|get_workspace)"' agent-sidecar/src/commands/types.ts
rg 'sessionFile' agent-sidecar/src/commands/handlers/core.ts src-tauri/src/lib.rs src/hooks/usePiStream.ts src/App.tsx
rg 'deps\.session|deps\.sessionManager|deps\.resourceLoader|deps\.promptScheduler' agent-sidecar/src
```

Expected:

- every listed command type has `sessionFile` through `SessionBoundCommand`;
- sidecar, relay, hook, and App all pass identity;
- final singleton-dependency search returns no production matches.

- [ ] **Step 3: Run manual single-active acceptance**

Use a development build:

```bash
pnpm run dev
```

Verify in order:

1. Empty startup adopts a real Pi session file; no client-generated fallback identity appears.
2. Send a prompt and receive streaming text/tools normally.
3. Steering, follow-up, queue edit, stop, retry, model selection, attachments, voice, and file mentions still work.
4. While a prompt runs, select another saved session. Current prompt stops before the loaded transcript appears.
5. Switch between two loaded sessions. Each restores its own cwd, model, messages, and file-mention root.
6. Load the same session twice rapidly. Logs show one runtime load, and UI remains coherent.
7. Send in a resumed session, restart app, reload it, and confirm Pi appended to the same JSONL history.
8. Delete a loaded idle session and confirm its file and runtime are gone without affecting another loaded session.
9. Trigger an unavailable-session command from devtools or a focused relay test and confirm the error includes `session_not_loaded`, target file, and retryable status.

- [ ] **Step 4: Confirm Phase 2 behavior did not leak in**

Verify:

- no sidebar running spinner or error icon was added;
- no `Map<SessionFile, StreamState>` exists in frontend code;
- no hidden session is allowed to continue when the user switches;
- no Chat/Work UI or persisted mode metadata exists; the Phase 1 wire snapshot intentionally carries only the hard-coded `mode: "chat"` compatibility value;
- no Outputs/Sources or selection action components exist.

- [ ] **Step 5: Commit any gate-only fixes**

If Step 1 or Step 3 required code changes, commit only those fixes:

```bash
git add agent-sidecar/src src src-tauri/src/lib.rs
git commit -m "fix: preserve single-session behavior after runtime migration"
```

If no fixes were required, skip this commit.

- [ ] **Step 6: Record final verification evidence**

Run:

```bash
git status --short
git log --oneline -8
```

Expected: clean working tree and the Phase 1 commits listed in this plan.

## Phase 1 Completion Criteria

Phase 1 is complete only when:

- every real agent operation resolves a canonical explicit session file;
- no handler can fall back to whichever session was viewed most recently;
- two sidecar runtimes have independent session, cwd/resource loader, model, scheduler, watchdog, queue, subscription, and extension UI state;
- duplicate cold loads create one runtime;
- Tauri routes prompt events only to matching session channels and preserves structured errors;
- the frontend ignores mismatched events but intentionally retains one reducer;
- switching still stops current work before replacing the visible transcript;
- existing single-session UX and all CI gates remain green.

This plan intentionally stops at **Phase 1: Session Runtime and Identity Foundation**. Phase 2 requires a separate detailed plan for keyed frontend stream state, true visible concurrency, cached switching, and sidebar runtime indicators.

---

## Post-Execution Notes / Phase 2 Contracts

These notes record the implemented Phase 1 boundary. They are not retroactive changes to the execution steps above.

- Every new session-bound command must extend `SessionBoundCommand` in `agent-sidecar/src/commands/types.ts`.
- Required props added to shared components require a grep of every production and test renderer; Phase 1 additionally touched `MessageInput.steering.test.tsx`, `MessageInput.queue.test.tsx`, `MessageInput.paste.test.tsx`, and `CommandPalette.test.tsx` beyond the original file list.
- Ready payloads carry `session` only when initialization creates the first runtime; `defaultWorkspace` remains available independently. In-process auth/settings refreshes call `runtimeManager.reloadAll()` and never replace loaded runtime identities.
- Session errors retain structured `code`, `message`, and `retryable` fields. Prompt failures always terminate with `done`.
- `get_workspace` returns an object containing the target runtime's `cwd`; `abort` is awaited before its result is returned.
- `load_session` is idempotent and duplicate cold loads share one sidecar promise.
- The frontend Phase 1 reducer intentionally remains single-active and guards late channel events by active session plus generation.
- Phase 2 must replace that guard with keyed routing, remove stop-on-switch, preserve every loaded session's complete state, and keep model/workspace/queue/error operations session-local.
- Phase 1 currently emits each full envelope through global `session_event`, while the prompt-channel event branch forwards only the inner event. Phase 2 should make global `session_event` the sole frontend stream bus and remove the redundant prompt-channel path rather than maintaining two event routes that can diverge or double-dispatch.
