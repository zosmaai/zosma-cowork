# Concurrent Execution, Cached Switching, and Sidebar Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let several loaded sessions run simultaneously, retain each session's live state in a keyed frontend cache, switch loaded sessions without aborting or loading, and expose accurate running/error status in the sidebar.

**Architecture:** The Tauri relay publishes one canonical `session_event` stream containing complete session envelopes; per-prompt Tauri Channels are removed. `usePiStream` wraps the tested `streamReducer` in `Map<SessionFile, StreamState>`, routes every event and optimistic command to its key, deduplicates cold loads, and marks interrupted runtimes after sidecar loss. `App` changes only the active render key when switching, while sidecar runtimes and hidden frontend states continue independently.

**Tech Stack:** React 19, TypeScript, Vitest, Tauri 2/Rust, Pi coding-agent SDK, React Testing Library, existing Motion/Lucide components.

**Roadmap:** [`docs/superpowers/roadmaps/2026-08-09-chat-work-concurrent-sessions-roadmap.md`](../roadmaps/2026-08-09-chat-work-concurrent-sessions-roadmap.md)

**Phase:** Phase 2: Concurrent Execution, Cached Switching, and Sidebar Status

---

## Phase Guardrails

This phase completes real multi-session execution and navigation. It intentionally does not add:

- Chat/Work mode selection or mode metadata;
- Chat/Work empty-state redesign;
- typography changes;
- Work result canvas or Outputs/Sources;
- selected-text actions;
- runtime eviction, a concurrency cap, or work surviving app shutdown.

The existing Chat transcript remains the only center view. The feature PR stays draft until all roadmap phases and final release gates are complete.

## Phase 1 Contracts Carried Forward

- Every session-bound command extends `SessionBoundCommand`.
- Session identity is the canonical absolute `sessionFile` returned by the sidecar.
- `new_session` and `load_session` return complete snapshots.
- Runtime refresh uses `reloadAll()` and does not replace runtime identities.
- Structured errors retain `code`, `message`, and `retryable`.
- Prompt failure always ends with terminal `done`.
- `get_workspace` returns the addressed runtime's `cwd`.
- `abort` is awaited.
- Duplicate sidecar loads share one promise.
- Model, workspace, queue, scheduler, watchdog, abort, and extension UI state remain session-local.

## Important Existing-Code Finding

`src-tauri/src/lib.rs` currently emits each complete event envelope as global `session_event`, but its prompt-channel branch sends only the inner event object. `usePiStream` expects a complete envelope from that Channel. Maintaining both paths would also double-dispatch events once the global listener handles every event.

Phase 2 therefore makes `session_event` the sole frontend stream bus and removes `PendingPrompt`/Tauri Channel routing. Request/response commands continue using `pending_requests`; prompt streaming is fire-and-forget after the JSONL command is written.

## Review Decisions

Independent architecture critique identified restart/load/delete races. This plan incorporates the minimum protections that match the current non-replay transport:

- listener-readiness gate before prompt/load;
- process epoch invalidation for old loads;
- deleted-session tombstones for late events/load responses;
- promise-identity checks before in-flight cleanup;
- scheduler-idle abort acknowledgement;
- `done`-latched `settledVersion` instead of rendered boolean transition detection;
- stale session-list request rejection.

The plan intentionally does not add envelope sequence logs, replay cursors, runtime UUIDs, or client prompt idempotency. Current stdout events are not replayed, old stdout fully closes before `sidecar_lost`, and Cowork permits one direct prompt run per session while steer/follow-up remain inside that run. Add sequence/replay protocol only if transport replay, reconnect without process loss, or multiple direct prompt operations per session are introduced.

## File Structure

### New files

- `src/App.sessions.test.tsx`: App-level cached-switching, no-abort, cold-load, model/workspace, and running-delete integration tests.
- `agent-sidecar/src/concurrent-sessions.test.ts`: scheduler concurrency and cross-session isolation regression tests.

### Modified files

- `agent-sidecar/src/session-protocol.ts`: add interrupted-session error code.
- `agent-sidecar/src/session-protocol.test.ts`: freeze interrupted error serialization.
- `agent-sidecar/src/commands/handlers/core.ts`: acknowledge abort only after the target scheduler is idle.
- `agent-sidecar/src/commands/handlers/core.test.ts`: freeze quiescent abort ordering.
- `agent-sidecar/src/commands/handlers/sessions.ts`: reject deletion of a running runtime and return tagged mutation results.
- `agent-sidecar/src/commands/handlers/sessions.test.ts`: running-delete safety tests.
- `src-tauri/src/lib.rs`: remove prompt Channels, normalize prompt `event`/`error`/`done` messages into global session events, and retain request correlation.
- `src/types/session-runtime.ts`: add model/load/runtime metadata used by the keyed cache.
- `src/hooks/usePiStream.ts`: preserve the existing per-session reducer, add keyed map reducer, route global events, deduplicate loads, and mark sidecar interruption.
- `src/hooks/usePiStream.test.ts`: retain existing per-session reducer coverage and add complete state hydration/error behavior.
- `src/hooks/usePiStream.session.test.ts`: keyed concurrency, event isolation, cached state, load deduplication, command targeting, and sidecar-loss tests.
- `src/App.tsx`: remove stop-on-switch, render active cached state, isolate workspace/model operations, reconcile hidden completions, and implement safe running deletion.
- `src/App.telemetry.test.tsx`: update the mocked `usePiStream` return contract.
- `src/components/Sidebar.tsx`: accept runtime state, support manual collapse, and expose running-count badge.
- `src/components/Sidebar.test.tsx`: collapsed badge and forwarding tests.
- `src/components/ConversationSearch.tsx`: render accessible running/error indicators without coupling them to active styling.
- `src/components/ConversationSearch.test.tsx`: indicator accessibility, reduced-motion class, and active/status independence tests.

No dependency or lockfile change belongs in this phase.

---

### Task 1: Make `session_event` the Sole Relay Stream

**Files:**
- Modify: `src-tauri/src/lib.rs:13-63,558-670,744-766,2495-2535,2637-2817`

- [ ] **Step 1: Add failing normalization tests**

At the bottom of the existing Rust test module, add `normalize_session_stream_message`, `fail_pending_requests`, and `PendingRequest` to its `use super::{...}` list. Import `std::{collections::HashMap, sync::Arc}` and `tokio::sync::Mutex`, then add:

```rust
#[test]
fn session_stream_keeps_complete_event_envelope() {
    let message = serde_json::json!({
        "type": "event",
        "sessionFile": "/sessions/a.jsonl",
        "event": { "type": "text_delta", "delta": "A" }
    });
    assert_eq!(normalize_session_stream_message(&message), Some(message));
}

#[test]
fn session_stream_normalizes_prompt_done() {
    let message = serde_json::json!({
        "type": "done",
        "id": "p-1",
        "sessionFile": "/sessions/a.jsonl"
    });
    assert_eq!(
        normalize_session_stream_message(&message),
        Some(serde_json::json!({
            "type": "event",
            "sessionFile": "/sessions/a.jsonl",
            "event": { "type": "done" }
        }))
    );
}

#[test]
fn session_stream_preserves_structured_prompt_error() {
    let message = serde_json::json!({
        "type": "error",
        "id": "p-1",
        "sessionFile": "/sessions/a.jsonl",
        "code": "provider_error",
        "message": "rate limited",
        "retryable": true,
        "details": "429"
    });
    assert_eq!(
        normalize_session_stream_message(&message),
        Some(serde_json::json!({
            "type": "event",
            "sessionFile": "/sessions/a.jsonl",
            "event": {
                "type": "error",
                "code": "provider_error",
                "message": "rate limited",
                "retryable": true,
                "details": "429"
            }
        }))
    );
}

#[test]
fn session_stream_ignores_untagged_global_messages() {
    assert_eq!(
        normalize_session_stream_message(&serde_json::json!({ "type": "ready" })),
        None
    );
    assert_eq!(
        normalize_session_stream_message(&serde_json::json!({
            "type": "done",
            "id": "save-session"
        })),
        None
    );
}

#[tokio::test]
async fn sidecar_loss_rejects_pending_requests() {
    let pending = Arc::new(Mutex::new(HashMap::new()));
    let (sender, receiver) = tokio::sync::oneshot::channel();
    pending.lock().await.insert("r-1".to_string(), PendingRequest { sender });
    fail_pending_requests(&pending, "sidecar lost").await;
    assert_eq!(receiver.await.unwrap(), Err("sidecar lost".to_string()));
    assert!(pending.lock().await.is_empty());
}
```

Delete the old `prompt_channel_matches_only_its_own_session` test. It tests a transport path this task removes.

- [ ] **Step 2: Run the Rust tests and verify failure**

Run:

```bash
cargo test --workspace session_stream -- --nocapture
```

Expected: compilation fails because `normalize_session_stream_message` does not exist.

- [ ] **Step 3: Add the pure normalizer**

Add near the relay structs:

```rust
fn normalize_session_stream_message(message: &Value) -> Option<Value> {
    let session_file = message.get("sessionFile")?.as_str()?;
    match message.get("type").and_then(Value::as_str) {
        Some("event") => Some(message.clone()),
        Some("done") => Some(serde_json::json!({
            "type": "event",
            "sessionFile": session_file,
            "event": { "type": "done" }
        })),
        Some("error") => Some(serde_json::json!({
            "type": "event",
            "sessionFile": session_file,
            "event": {
                "type": "error",
                "code": message.get("code").cloned().unwrap_or(Value::Null),
                "message": message.get("message").cloned().unwrap_or(Value::Null),
                "retryable": message.get("retryable").cloned().unwrap_or(Value::Bool(false)),
                "details": message.get("details").cloned().unwrap_or(Value::Null)
            }
        })),
        _ => None,
    }
}
```

- [ ] **Step 4: Remove prompt-channel state and command argument**

Delete:

```rust
use tauri::ipc::Channel;

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

Remove `pending_prompts` from `AppState`. Change `send_prompt` to:

```rust
#[tauri::command]
async fn send_prompt(
    session_file: String,
    text: String,
    s: State<'_, AppState>,
) -> Result<(), String> {
    if !s.sidecar.ready.load(Ordering::Acquire) {
        return Err("not ready".into());
    }
    let id = format!("p-{}", uuid_v4());
    scmd(&s, &build_prompt_payload(&id, &session_file, &text)).await
}
```

- [ ] **Step 5: Route complete session envelopes globally**

Remove the `pp` argument from `read_stdout`. Update its relevant branches to this behavior:

```rust
"event" => {
    if let Some(event) = m.get("event") {
        if let Some(kind) = event.get("kind").and_then(|value| value.as_str()) {
            if kind.starts_with("oauth_")
                || kind == "agent_reload_failed"
                || kind == "ui_request"
                || kind == "ui_cancel"
            {
                let mut payload = event.clone();
                if let Some(session_file) = m.get("sessionFile") {
                    payload["sessionFile"] = session_file.clone();
                }
                let _ = app.emit(kind, payload);
            }
        }
    }
    if let Some(envelope) = normalize_session_stream_message(&m) {
        let _ = app.emit("session_event", envelope);
    }
}
"done" => {
    if let Some(envelope) = normalize_session_stream_message(&m) {
        let _ = app.emit("session_event", envelope);
    }
}
"error" => {
    let id = m.get("id").and_then(Value::as_str).unwrap_or("");
    let message = m
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("err");
    log::warn!("sidecar error response id={id}: {message}");
    if let Some(request) = pr.lock().await.remove(id) {
        let _ = request.sender.send(Err(m.to_string()));
    } else if let Some(envelope) = normalize_session_stream_message(&m) {
        let _ = app.emit("session_event", envelope);
    }
}
```

Keep `result` and global ready/OAuth/UI handling unchanged.

Add a drain helper so requests sent to a dead process cannot hang or resolve against a replacement process:

```rust
async fn fail_pending_requests(
    pending: &Arc<Mutex<HashMap<String, PendingRequest>>>,
    message: &str,
) {
    let requests: Vec<PendingRequest> = pending.lock().await.drain().map(|(_, request)| request).collect();
    for request in requests {
        let _ = request.sender.send(Err(message.to_string()));
    }
}
```

In setup, remove the `pp` clone and call:

```rust
read_stdout(o, pr.clone(), rd.clone(), h.clone()).await;
fail_pending_requests(&pr, "sidecar lost").await;
```

Run the drain before emitting `sidecar_lost` or spawning a replacement process.

- [ ] **Step 6: Run relay tests and formatting**

Run:

```bash
cargo fmt --check
cargo test --workspace session_stream -- --nocapture
cargo test --workspace prompt_payload -- --nocapture
```

Expected: all commands exit `0`.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "refactor(tauri): publish one keyed session event stream"
```

---

### Task 2: Prove Sidecar Concurrency and Block Unsafe Deletion

**Files:**
- Create: `agent-sidecar/src/concurrent-sessions.test.ts`
- Modify: `agent-sidecar/src/session-protocol.ts`
- Modify: `agent-sidecar/src/session-protocol.test.ts`
- Modify: `agent-sidecar/src/commands/handlers/core.ts`
- Modify: `agent-sidecar/src/commands/handlers/core.test.ts`
- Modify: `agent-sidecar/src/commands/handlers/sessions.ts`
- Modify: `agent-sidecar/src/commands/handlers/sessions.test.ts`

- [ ] **Step 1: Add a scheduler concurrency regression test**

Create `agent-sidecar/src/concurrent-sessions.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createPromptScheduler } from "./prompt-scheduler.js";

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("concurrent session schedulers", () => {
	it("runs different sessions concurrently while serializing each session", async () => {
		const a = createPromptScheduler();
		const b = createPromptScheduler();
		const releaseA = deferred();
		const releaseB = deferred();
		const started: string[] = [];

		a.schedule(async () => {
			started.push("a-1");
			await releaseA.promise;
		});
		a.schedule(async () => {
			started.push("a-2");
		});
		b.schedule(async () => {
			started.push("b-1");
			await releaseB.promise;
		});

		await vi.waitFor(() => expect(started).toEqual(["a-1", "b-1"]));
		releaseB.resolve();
		await b.idle();
		expect(started).toEqual(["a-1", "b-1"]);
		releaseA.resolve();
		await a.idle();
		expect(started).toEqual(["a-1", "b-1", "a-2"]);
	});
});
```

This test should pass against the Phase 1 runtime design. It is a Scenario 2 regression test; do not add production code merely to force a red test.

- [ ] **Step 2: Add failing quiescent-abort and running-delete tests**

In `core.test.ts`, add:

```ts
it("does not acknowledge abort until the target scheduler is idle", async () => {
	const idle = vi.spyOn(runtimeA.promptScheduler, "idle").mockResolvedValue(undefined);
	await handleAbort(deps, { type: "abort", id: "ab-a", sessionFile: "/a.jsonl" });
	expect(runtimeA.session.abort).toHaveBeenCalledOnce();
	expect(idle).toHaveBeenCalledOnce();
	expect(vi.mocked(runtimeA.session.abort).mock.invocationCallOrder[0]).toBeLessThan(
		idle.mock.invocationCallOrder[0],
	);
	const resultCall = mocks.send.mock.calls.findIndex(([message]) =>
		message.type === "result" && message.id === "ab-a",
	);
	expect(idle.mock.invocationCallOrder[0]).toBeLessThan(
		mocks.send.mock.invocationCallOrder[resultCall],
	);
});
```

In `sessions.test.ts`, create a running runtime by setting:

```ts
runtimeA.status = "responding";
(runtimeA.session as unknown as { isStreaming: boolean }).isStreaming = true;
```

Then add:

```ts
it("rejects deletion while the target runtime is running", async () => {
	(runtimeManager as any).runtimes.set(runtimeA.sessionFile, runtimeA);
	runtimeA.status = "responding";
	(runtimeA.session as unknown as { isStreaming: boolean }).isStreaming = true;

	await handleDeleteSession(deps, {
		type: "delete_session",
		id: "d-running",
		sessionFile: "/a.jsonl",
	});

	expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
		type: "error",
		id: "d-running",
		code: "session_busy",
		retryable: true,
	}));
	expect(runtimeManager.dispose).not.toHaveBeenCalled();
	expect(mocks.deletePiSession).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run focused tests and verify the expected failure**

Run:

```bash
(cd agent-sidecar && pnpm test -- src/concurrent-sessions.test.ts src/commands/handlers/sessions.test.ts)
```

Expected: concurrency test passes; abort test fails because `promptScheduler.idle()` is not awaited; running-delete test fails because deletion currently disposes the runtime.

- [ ] **Step 4: Add interrupted-session wire code**

Extend `SessionErrorCode` in `session-protocol.ts` with:

```ts
| "session_interrupted"
```

Add to `session-protocol.test.ts`:

```ts
it("serializes an interrupted-session error without losing retryability", () => {
	expect(makeSessionError("p-1", "/a.jsonl", {
		code: "session_interrupted",
		message: "Session stopped because the sidecar restarted",
		retryable: true,
	})).toMatchObject({
		type: "error",
		sessionFile: "/a.jsonl",
		code: "session_interrupted",
		retryable: true,
	});
});
```

- [ ] **Step 5: Make abort acknowledgement quiescent and reject running deletion**

Replace `handleAbort` in `core.ts` with:

```ts
export async function handleAbort(
	deps: HandlerDependencies,
	cmd: AbortCommand,
): Promise<void> {
	const runtime = runtimeFor(deps, cmd);
	if (!runtime) return;
	await runtime.session.abort();
	await runtime.promptScheduler.idle();
	sendMsg(makeSessionResult(cmd.id, cmd.sessionFile, { aborted: true }));
}
```

The scheduler becomes idle only after `runPromptTask` executes its `finally` block and emits terminal `done`. Therefore Tauri's awaited abort result means no old prompt terminal can race a new prompt or persistence deletion.

Replace `handleDeleteSession` with:

```ts
export async function handleDeleteSession(
	deps: HandlerDependencies,
	cmd: { id: string; sessionFile: string },
): Promise<void> {
	const runtime = deps.runtimeManager.get(cmd.sessionFile);
	if (runtime && snapshotRuntime(runtime).isRunning) {
		send(makeSessionError(cmd.id, cmd.sessionFile, {
			code: "session_busy",
			message: "Stop the running session before deleting it",
			retryable: true,
		}));
		return;
	}
	await deps.runtimeManager.dispose(cmd.sessionFile);
	const deleted = deletePiSession(piAgentDir(), cmd.sessionFile);
	send(makeSessionResult(cmd.id, cmd.sessionFile, { deleted }));
}
```

This guard is the trust-boundary protection. The frontend will stop first, but a race or direct command still cannot delete a running runtime.

- [ ] **Step 6: Run sidecar tests and build**

```bash
(cd agent-sidecar && pnpm test -- src/concurrent-sessions.test.ts src/session-protocol.test.ts src/commands/handlers/core.test.ts src/commands/handlers/sessions.test.ts && pnpm build)
```

Expected: all tests pass and TypeScript build exits `0`.

- [ ] **Step 7: Commit**

```bash
git add agent-sidecar/src/concurrent-sessions.test.ts \
  agent-sidecar/src/session-protocol.ts \
  agent-sidecar/src/session-protocol.test.ts \
  agent-sidecar/src/commands/handlers/core.ts \
  agent-sidecar/src/commands/handlers/core.test.ts \
  agent-sidecar/src/commands/handlers/sessions.ts \
  agent-sidecar/src/commands/handlers/sessions.test.ts
git commit -m "feat(sidecar): guard running sessions and prove concurrency"
```

---

### Task 3: Wrap the Existing Stream Reducer in a Keyed Map

**Files:**
- Modify: `src/types/session-runtime.ts`
- Modify: `src/hooks/usePiStream.ts`
- Modify: `src/hooks/usePiStream.test.ts`
- Modify: `src/hooks/usePiStream.session.test.ts`

- [ ] **Step 1: Add failing keyed-reducer tests**

Update imports in `usePiStream.session.test.ts` to include:

```ts
import {
	INITIAL_SESSION_STREAMS,
	INITIAL_STATE,
	sessionStreamsReducer,
	type SessionStreamsAction,
} from "./usePiStream";
```

Add:

```ts
function reduceSessions(actions: SessionStreamsAction[]) {
	return actions.reduce(sessionStreamsReducer, INITIAL_SESSION_STREAMS);
}

it("updates only the addressed stream entry", () => {
	const states = reduceSessions([
		{ type: "APPLY", sessionFile: "/a.jsonl", action: { type: "START_STREAM", prompt: "A" } },
		{ type: "APPLY", sessionFile: "/b.jsonl", action: { type: "START_STREAM", prompt: "B" } },
		{ type: "APPLY", sessionFile: "/a.jsonl", action: { type: "TEXT_DELTA", delta: "alpha" } },
	]);
	expect(states.get("/a.jsonl")?.streamingMessage?.content).toBe("alpha");
	expect(states.get("/b.jsonl")?.streamingMessage?.content).toBe("");
	expect(states.get("/a.jsonl")?.isRunning).toBe(true);
	expect(states.get("/b.jsonl")?.isRunning).toBe(true);
});

it("retains hidden completion after another key becomes active", () => {
	const states = reduceSessions([
		{ type: "APPLY", sessionFile: "/a.jsonl", action: { type: "START_STREAM", prompt: "A" } },
		{ type: "APPLY", sessionFile: "/b.jsonl", action: { type: "START_STREAM", prompt: "B" } },
		{ type: "APPLY", sessionFile: "/a.jsonl", action: { type: "TEXT_DELTA", delta: "done A" } },
		{ type: "APPLY", sessionFile: "/a.jsonl", action: { type: "STREAM_COMPLETE" } },
	]);
	expect(states.get("/a.jsonl")?.messages.at(-1)?.content).toBe("done A");
	expect(states.get("/a.jsonl")?.isRunning).toBe(false);
	expect(states.get("/a.jsonl")?.settledVersion).toBe(1);
	expect(states.get("/b.jsonl")?.isRunning).toBe(true);
	expect(states.get("/b.jsonl")?.settledVersion).toBe(0);
});

it("marks only running streams interrupted when the runtime process is lost", () => {
	const states = reduceSessions([
		{ type: "APPLY", sessionFile: "/a.jsonl", action: { type: "START_STREAM", prompt: "A" } },
		{ type: "APPLY", sessionFile: "/b.jsonl", action: { type: "HYDRATE_SESSION", snapshot: snapshot("/b.jsonl", "B") } },
		{ type: "SIDECAR_LOST" },
	]);
	expect(states.get("/a.jsonl")).toMatchObject({
		isRunning: false,
		status: "error",
		runtimeLoaded: false,
		sessionError: { code: "session_interrupted", retryable: true },
	});
	expect(states.get("/b.jsonl")).toMatchObject({
		status: "error",
		runtimeLoaded: false,
	});
	expect(states.get("/b.jsonl")?.sessionError?.code).toBe("provider_error");
});

it("removes only the deleted session cache entry", () => {
	const states = reduceSessions([
		{ type: "APPLY", sessionFile: "/a.jsonl", action: { type: "START_STREAM", prompt: "A" } },
		{ type: "APPLY", sessionFile: "/b.jsonl", action: { type: "START_STREAM", prompt: "B" } },
		{ type: "REMOVE_SESSION", sessionFile: "/a.jsonl" },
	]);
	expect(states.has("/a.jsonl")).toBe(false);
	expect(states.has("/b.jsonl")).toBe(true);
});
```

- [ ] **Step 2: Run the keyed tests and verify failure**

```bash
pnpm test -- src/hooks/usePiStream.session.test.ts
```

Expected: compilation fails because the keyed reducer exports do not exist.

- [ ] **Step 3: Extend frontend runtime types**

In `src/types/session-runtime.ts`, add:

```ts
export interface SessionModel {
	provider?: string;
	id?: string;
	name?: string;
}

export type SessionLoadStatus = "loaded" | "loading" | "error";
```

Use `SessionModel` for `SessionSnapshot.model`. Keep `SessionWireError.code` as `string` so forward-compatible sidecar codes do not break old clients.

- [ ] **Step 4: Add session metadata to `StreamState`**

Add these fields:

```ts
sessionFile: string | null;
cwd: string | null;
model?: SessionModel;
runtimeLoaded: boolean;
loadStatus: SessionLoadStatus;
/** True after START_STREAM until the correlated terminal done is reduced. */
awaitingDone: boolean;
/** Monotonic done count; survives React batching and duplicate render states. */
settledVersion: number;
```

Update `INITIAL_STATE`:

```ts
sessionFile: null,
cwd: null,
model: undefined,
runtimeLoaded: false,
loadStatus: "loaded",
awaitingDone: false,
settledVersion: 0,
```

Add a factory so nested arrays are not shared between new keys:

```ts
export function createStreamState(sessionFile: string): StreamState {
	return {
		...INITIAL_STATE,
		sessionFile,
		queue: { steering: [], followUp: [] },
		streamSegments: [],
		queuedKinds: {},
	};
}
```

- [ ] **Step 5: Add reducer actions for loading, model, and structured errors**

Extend `StreamAction` with:

```ts
| { type: "BEGIN_LOAD" }
| { type: "LOAD_FAILED"; error: SessionWireError }
| { type: "SET_SESSION_MODEL"; model: SessionModel }
```

Extend `STREAM_ERROR` to:

```ts
| { type: "STREAM_ERROR"; error: string; sessionError?: SessionWireError }
```

Implement:

```ts
case "BEGIN_LOAD":
	return { ...state, loadStatus: "loading" };

case "LOAD_FAILED":
	return {
		...state,
		isRunning: false,
		status: "error",
		error: action.error.message,
		sessionError: action.error,
		runtimeLoaded: false,
		loadStatus: "error",
	};

case "SET_SESSION_MODEL":
	return { ...state, model: action.model };
```

Update `HYDRATE_SESSION` to include:

```ts
sessionFile: action.snapshot.sessionFile,
cwd: action.snapshot.cwd,
model: action.snapshot.model,
runtimeLoaded: true,
loadStatus: "loaded",
```

Update `MODEL_INFO` to store the model on the session state as well as the streaming message:

```ts
model: { provider: action.provider, id: action.model },
```

Set `awaitingDone: true` in `START_STREAM`. Set it from `snapshot.isRunning` in `HYDRATE_SESSION`. `STREAM_ERROR` and `ABORT_STREAM` may make the UI non-running, but they must not increment completion or clear `awaitingDone`; the guaranteed `done` remains the authoritative terminal.

Every `STREAM_COMPLETE` return uses:

```ts
const settledVersion = state.settledVersion + (state.awaitingDone ? 1 : 0);
```

and sets:

```ts
awaitingDone: false,
settledVersion,
```

Update the no-message branch so an existing error remains an error:

```ts
if (!msg) {
	const settledVersion = state.settledVersion + (state.awaitingDone ? 1 : 0);
	return state.error
		? {
				...state,
				isRunning: false,
				status: "error",
				streamingMessage: null,
				awaitingDone: false,
				settledVersion,
			}
		: {
				...state,
				isRunning: false,
				status: "idle",
				streamingMessage: null,
				awaitingDone: false,
				settledVersion,
			};
}
```

A normalized terminal `done` is the completion signal. `agent_end` must not dispatch `STREAM_COMPLETE`; this avoids two terminal transitions for one prompt. `done` is guaranteed by the Phase 1 prompt contract even on failure. If the local `send_prompt` invoke itself fails before the sidecar accepts the command, dispatch `STREAM_ERROR` followed by `STREAM_COMPLETE` locally so the latch also settles.

- [ ] **Step 6: Add the keyed wrapper reducer**

Below `streamReducer`, add:

```ts
export type SessionStreamsState = Map<string, StreamState>;

export type SessionStreamsAction =
	| { type: "APPLY"; sessionFile: string; action: StreamAction }
	| { type: "REMOVE_SESSION"; sessionFile: string }
	| { type: "SIDECAR_LOST" };

export const INITIAL_SESSION_STREAMS: SessionStreamsState = new Map();

export function sessionStreamsReducer(
	states: SessionStreamsState,
	action: SessionStreamsAction,
): SessionStreamsState {
	if (action.type === "REMOVE_SESSION") {
		if (!states.has(action.sessionFile)) return states;
		const next = new Map(states);
		next.delete(action.sessionFile);
		return next;
	}

	if (action.type === "SIDECAR_LOST") {
		const next = new Map(states);
		const error: SessionWireError = {
			code: "session_interrupted",
			message: "Session stopped because the sidecar restarted",
			retryable: true,
		};
		for (const [sessionFile, state] of states) {
			const interrupted = state.loadStatus === "loading"
				? streamReducer(state, { type: "LOAD_FAILED", error })
				: state.isRunning
					? streamReducer(state, {
							type: "STREAM_ERROR",
							error: error.message,
							sessionError: error,
						})
					: state;
			next.set(sessionFile, {
				...interrupted,
				runtimeLoaded: false,
				awaitingDone: false,
			});
		}
		return next;
	}

	const current = states.get(action.sessionFile) ?? createStreamState(action.sessionFile);
	const updated = streamReducer(current, action.action);
	if (updated === current && states.has(action.sessionFile)) return states;
	const next = new Map(states);
	next.set(action.sessionFile, updated);
	return next;
}
```

- [ ] **Step 7: Update existing hydration tests**

The existing per-session hydration test must additionally assert:

```ts
expect(saved).toMatchObject({
	sessionFile: "/s/a.jsonl",
	cwd: "/work",
	model: { provider: "test", id: "model" },
	runtimeLoaded: true,
	loadStatus: "loaded",
	awaitingDone: false,
	settledVersion: 0,
});
```

Do not rewrite existing text/tool/queue reducer cases.

- [ ] **Step 8: Run reducer tests**

```bash
pnpm test -- src/hooks/usePiStream.test.ts src/hooks/usePiStream.session.test.ts
pnpm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 9: Commit**

```bash
git add src/types/session-runtime.ts src/hooks/usePiStream.ts \
  src/hooks/usePiStream.test.ts src/hooks/usePiStream.session.test.ts
git commit -m "refactor(frontend): store stream state by session file"
```

---

### Task 4: Route Global Events and Deduplicate Runtime Loads

**Files:**
- Modify: `src/hooks/usePiStream.ts`
- Modify: `src/hooks/usePiStream.session.test.ts`

- [ ] **Step 1: Replace Channel mocks and add failing hook tests**

Remove the `Channel` mock and `channels` collection from `usePiStream.session.test.ts`. Keep the callback map and make listener registration delayable:

```ts
const mocks = vi.hoisted(() => ({
	invoke: vi.fn(),
	listeners: new Map<string, (event: { payload: unknown }) => void>(),
	listenGate: null as Promise<void> | null,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
	listen: vi.fn(async (name: string, callback: (event: { payload: unknown }) => void) => {
		if (mocks.listenGate) await mocks.listenGate;
		mocks.listeners.set(name, callback);
		return () => mocks.listeners.delete(name);
	}),
}));
```

Import `waitFor` beside `act` and `renderHook`. Reset `mocks.listenGate = null` in `beforeEach`. Make `mocks.invoke` return snapshots for `load_session` and add:

```ts
it("routes simultaneous tagged events to independent cached states", async () => {
	const { result } = renderHook(() => usePiStream("/a.jsonl"));
	act(() => {
		result.current.hydrateSession(snapshot("/a.jsonl", "A history"));
		result.current.hydrateSession(snapshot("/b.jsonl", "B history"));
	});
	await act(async () => {
		await Promise.all([
			result.current.startStream("/a.jsonl", "A prompt"),
			result.current.startStream("/b.jsonl", "B prompt"),
		]);
	});
	act(() => {
		mocks.listeners.get("session_event")?.({
			payload: {
				type: "event",
				sessionFile: "/a.jsonl",
				event: {
					type: "message_update",
					assistantMessageEvent: { type: "text_delta", delta: "A live" },
				},
			},
		});
		mocks.listeners.get("session_event")?.({
			payload: {
				type: "event",
				sessionFile: "/b.jsonl",
				event: {
					type: "message_update",
					assistantMessageEvent: { type: "text_delta", delta: "B live" },
				},
			},
		});
	});
	expect(result.current.states.get("/a.jsonl")?.streamingMessage?.content).toBe("A live");
	expect(result.current.states.get("/b.jsonl")?.streamingMessage?.content).toBe("B live");
});

it("does not reload an already cached and runtime-loaded session", async () => {
	const { result } = renderHook(() => usePiStream("/a.jsonl"));
	act(() => result.current.hydrateSession(snapshot("/a.jsonl", "A")));
	await act(async () => result.current.ensureSession("/a.jsonl"));
	expect(mocks.invoke).not.toHaveBeenCalledWith("load_session", expect.anything());
});

it("deduplicates rapid cold loads", async () => {
	let release!: (value: ReturnType<typeof snapshot>) => void;
	const pending = new Promise<ReturnType<typeof snapshot>>((resolve) => {
		release = resolve;
	});
	mocks.invoke.mockImplementation((command) =>
		command === "load_session" ? pending : Promise.resolve(null),
	);
	const { result } = renderHook(() => usePiStream("/cold.jsonl"));
	let first!: Promise<unknown>;
	let second!: Promise<unknown>;
	act(() => {
		first = result.current.ensureSession("/cold.jsonl");
		second = result.current.ensureSession("/cold.jsonl");
	});
	await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
	release(snapshot("/cold.jsonl", "cold"));
	await act(async () => Promise.all([first, second]));
	expect(result.current.states.get("/cold.jsonl")?.messages.at(0)?.content).toBe("cold");
});

it("waits for the event listener before sending a prompt", async () => {
	let release!: () => void;
	mocks.listenGate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const { result } = renderHook(() => usePiStream("/a.jsonl"));
	act(() => result.current.hydrateSession(snapshot("/a.jsonl", "A")));
	let sending!: Promise<void>;
	act(() => {
		sending = result.current.startStream("/a.jsonl", "run");
	});
	await Promise.resolve();
	expect(mocks.invoke).not.toHaveBeenCalledWith("send_prompt", expect.anything());
	release();
	await act(async () => sending);
	expect(mocks.invoke).toHaveBeenCalledWith("send_prompt", {
		sessionFile: "/a.jsonl",
		text: "run",
	});
});

it("marks running sessions interrupted on sidecar loss", async () => {
	const { result } = renderHook(() => usePiStream("/a.jsonl"));
	await waitFor(() => expect(mocks.listeners.has("sidecar_lost")).toBe(true));
	act(() => result.current.hydrateSession(snapshot("/a.jsonl", "A")));
	await act(async () => result.current.startStream("/a.jsonl", "run"));
	act(() => mocks.listeners.get("sidecar_lost")?.({ payload: null }));
	expect(result.current.states.get("/a.jsonl")).toMatchObject({
		isRunning: false,
		status: "error",
		runtimeLoaded: false,
		sessionError: { code: "session_interrupted" },
	});
});

it("ignores an old load that resolves after sidecar loss", async () => {
	let release!: (value: ReturnType<typeof snapshot>) => void;
	mocks.invoke.mockImplementation((command) => command === "load_session"
		? new Promise((resolve) => { release = resolve; })
		: Promise.resolve(null));
	const { result } = renderHook(() => usePiStream("/a.jsonl"));
	await waitFor(() => expect(mocks.listeners.has("sidecar_lost")).toBe(true));
	let loading!: Promise<unknown>;
	act(() => { loading = result.current.ensureSession("/a.jsonl"); });
	await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("load_session", {
		sessionFile: "/a.jsonl",
	}));
	act(() => mocks.listeners.get("sidecar_lost")?.({ payload: null }));
	release(snapshot("/a.jsonl", "stale"));
	await act(async () => expect(loading).rejects.toThrow("invalidated"));
	expect(result.current.states.get("/a.jsonl")).toMatchObject({
		runtimeLoaded: false,
		loadStatus: "error",
		sessionError: { code: "session_interrupted" },
	});
});

it("ignores an old load that resolves after deletion", async () => {
	let release!: (value: ReturnType<typeof snapshot>) => void;
	mocks.invoke.mockImplementation((command) => command === "load_session"
		? new Promise((resolve) => { release = resolve; })
		: Promise.resolve(null));
	const { result } = renderHook(() => usePiStream("/a.jsonl"));
	let loading!: Promise<unknown>;
	act(() => { loading = result.current.ensureSession("/a.jsonl"); });
	await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("load_session", {
		sessionFile: "/a.jsonl",
	}));
	act(() => result.current.removeSession("/a.jsonl"));
	release(snapshot("/a.jsonl", "stale"));
	await act(async () => expect(loading).rejects.toThrow("invalidated"));
	expect(result.current.states.has("/a.jsonl")).toBe(false);
});

it("an old load cleanup cannot remove its replacement promise", async () => {
	let releaseOld!: (value: ReturnType<typeof snapshot>) => void;
	let releaseNew!: (value: ReturnType<typeof snapshot>) => void;
	mocks.invoke
		.mockImplementationOnce(() => new Promise((resolve) => { releaseOld = resolve; }))
		.mockImplementationOnce(() => new Promise((resolve) => { releaseNew = resolve; }));
	const { result } = renderHook(() => usePiStream("/a.jsonl"));
	await waitFor(() => expect(mocks.listeners.has("sidecar_lost")).toBe(true));
	let oldLoad!: Promise<unknown>;
	let newLoad!: Promise<unknown>;
	act(() => { oldLoad = result.current.ensureSession("/a.jsonl"); });
	await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
	act(() => mocks.listeners.get("sidecar_lost")?.({ payload: null }));
	act(() => { newLoad = result.current.ensureSession("/a.jsonl"); });
	await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
	releaseOld(snapshot("/a.jsonl", "old"));
	await act(async () => expect(oldLoad).rejects.toThrow("invalidated"));
	releaseNew(snapshot("/a.jsonl", "new"));
	await act(async () => newLoad);
	expect(result.current.states.get("/a.jsonl")?.messages.at(0)?.content).toBe("new");
});
```

- [ ] **Step 2: Run focused hook tests and verify failure**

```bash
pnpm test -- src/hooks/usePiStream.session.test.ts
```

Expected: failures because the hook still owns one reducer and listens only for active queue updates.

- [ ] **Step 3: Replace the hook's single reducer with the keyed reducer**

At the start of `usePiStream`, use:

```ts
const [states, dispatchSessions] = useReducer(
	sessionStreamsReducer,
	INITIAL_SESSION_STREAMS,
);
const statesRef = useRef(states);
const loadedRef = useRef(new Set<string>());
const loadingRef = useRef(new Map<string, Promise<SessionSnapshot>>());
const deletedRef = useRef(new Set<string>());
const sidecarEpochRef = useRef(0);
const listenerReadyRef = useRef<Promise<void> | null>(null);
const resolveListenerReadyRef = useRef<(() => void) | null>(null);
if (!listenerReadyRef.current) {
	listenerReadyRef.current = new Promise<void>((resolve) => {
		resolveListenerReadyRef.current = resolve;
	});
}

useLayoutEffect(() => {
	statesRef.current = states;
}, [states]);

const state = activeSessionFile
	? states.get(activeSessionFile) ?? createStreamState(activeSessionFile)
	: INITIAL_STATE;

const dispatchTo = useCallback((sessionFile: string, action: StreamAction) => {
	dispatchSessions({ type: "APPLY", sessionFile, action });
}, []);
```

Remove `activeSessionRef`, `generationRef`, Tauri `Channel`, and `toolPhase`. `toolPhase` has no consumer anywhere in `src`; deleting dead state prevents cross-session leakage.

- [ ] **Step 4: Implement snapshot hydration and cold-load deduplication**

```ts
const hydrateSession = useCallback((snapshot: SessionSnapshot) => {
	if (deletedRef.current.has(snapshot.sessionFile)) return;
	loadedRef.current.add(snapshot.sessionFile);
	dispatchTo(snapshot.sessionFile, { type: "HYDRATE_SESSION", snapshot });
}, [dispatchTo]);

const ensureSession = useCallback(async (sessionFile: string): Promise<SessionSnapshot | null> => {
	await listenerReadyRef.current;
	if (deletedRef.current.has(sessionFile)) throw new Error("Session was deleted");
	if (loadedRef.current.has(sessionFile)) return null;
	const pending = loadingRef.current.get(sessionFile);
	if (pending) return pending;

	const epoch = sidecarEpochRef.current;
	dispatchTo(sessionFile, { type: "BEGIN_LOAD" });
	let load!: Promise<SessionSnapshot>;
	load = invoke<SessionSnapshot>("load_session", { sessionFile })
		.then((snapshot) => {
			if (deletedRef.current.has(sessionFile) || epoch !== sidecarEpochRef.current) {
				throw new Error("Session load was invalidated");
			}
			hydrateSession(snapshot);
			return snapshot;
		})
		.catch((error) => {
			if (!deletedRef.current.has(sessionFile) && epoch === sidecarEpochRef.current) {
				const wireError: SessionWireError = {
					code: "session_load_failed",
					message: error instanceof Error ? error.message : String(error),
					retryable: true,
				};
				dispatchTo(sessionFile, { type: "LOAD_FAILED", error: wireError });
			}
			throw error;
		})
		.finally(() => {
			if (loadingRef.current.get(sessionFile) === load) loadingRef.current.delete(sessionFile);
		});
	loadingRef.current.set(sessionFile, load);
	return load;
}, [dispatchTo, hydrateSession]);

// ponytail: process epoch is enough for the current non-replay relay; add
// envelope sequence cursors only if transport replay/reconnect is introduced.
```

Because canonical paths come from session-list/snapshot wire data, do not normalize paths again in the browser.

- [ ] **Step 5: Make prompt and queue operations target keyed state**

For each operation, replace bare `dispatch(...)` with `dispatchTo(sessionFile, ...)`.

`startStream` becomes:

```ts
const startStream = useCallback(async (sessionFile: string, text: string) => {
	await ensureSession(sessionFile);
	dispatchTo(sessionFile, { type: "START_STREAM", prompt: text });
	try {
		await invoke("send_prompt", { sessionFile, text });
	} catch (error) {
		dispatchTo(sessionFile, {
			type: "STREAM_ERROR",
			error: error instanceof Error ? error.message : String(error),
		});
		dispatchTo(sessionFile, { type: "STREAM_COMPLETE" });
	}
}, [dispatchTo, ensureSession]);
```

`abortStream` must await the backend before declaring success and return a boolean for safe deletion:

```ts
const abortStream = useCallback(async (sessionFile: string): Promise<boolean> => {
	try {
		await invoke("abort_prompt", { sessionFile });
		dispatchTo(sessionFile, { type: "ABORT_STREAM" });
		return true;
	} catch (error) {
		log.warn("[cowork] abort_prompt rejected:", error);
		return false;
	}
}, [dispatchTo]);
```

Keep existing steer/follow-up/clear-queue error policy, but dispatch optimistic queue actions to `sessionFile`.

Add:

```ts
const setSessionModel = useCallback((sessionFile: string, model: SessionModel) => {
	dispatchTo(sessionFile, { type: "SET_SESSION_MODEL", model });
}, [dispatchTo]);

const removeSession = useCallback((sessionFile: string) => {
	deletedRef.current.add(sessionFile);
	loadedRef.current.delete(sessionFile);
	loadingRef.current.delete(sessionFile);
	dispatchSessions({ type: "REMOVE_SESSION", sessionFile });
}, []);
```

- [ ] **Step 6: Route every global session event to its key**

Move the existing event switch into one `handleEnvelope` callback. Preserve every existing event mapping, with these mechanical rules:

| Incoming event | Target reducer action(s) |
|---|---|
| `message_update/thinking_delta` | `THINKING_DELTA` |
| `message_update/text_delta` | `TEXT_DELTA` |
| `message_update/text_end` | `TEXT_END` |
| `message_update/toolcall_end` | `TOOL_CALL_START` |
| `message_update/error` | `STREAM_ERROR` |
| `message_start/assistant` | `TURN_RESET` |
| `message_start/user` | `USER_MESSAGE_STARTED` |
| `tool_execution_start` | no separate state; status is already driven by tool-call events |
| `tool_execution_update` | `TOOL_CALL_UPDATE` then `TOOL_PARTIAL_OUTPUT` |
| `tool_execution_end` | `TOOL_CALL_UPDATE` |
| `message_end` with terminal error | `STREAM_ERROR` |
| normal `message_end` | `MESSAGE_END` |
| `agent_end` | no reducer terminal; wait for guaranteed normalized `done` |
| normalized `done` | `STREAM_COMPLETE` |
| `queue_update` | `QUEUE_UPDATE` |
| structured `error` | `STREAM_ERROR` with `sessionError` |

Every action uses:

```ts
dispatchTo(envelope.sessionFile, action)
```

The structured error mapping is:

```ts
const wireError: SessionWireError = {
	code: errEvent.code ?? "provider_error",
	message: errEvent.message || errEvent.details || "Unknown error",
	retryable: errEvent.retryable ?? false,
	details: errEvent.details,
};
dispatchTo(envelope.sessionFile, {
	type: "STREAM_ERROR",
	error: wireError.message,
	sessionError: wireError,
});
```

Subscribe once and resolve the listener gate only after both subscriptions exist:

```ts
useEffect(() => {
	let disposed = false;
	let unlistenSession: (() => void) | undefined;
	let unlistenLost: (() => void) | undefined;

	void Promise.all([
		listen<SessionEventEnvelope>("session_event", ({ payload }) => {
			if (!payload?.sessionFile || deletedRef.current.has(payload.sessionFile)) return;
			handleEnvelope(payload);
		}),
		listen("sidecar_lost", () => {
			sidecarEpochRef.current += 1;
			loadedRef.current.clear();
			loadingRef.current.clear();
			dispatchSessions({ type: "SIDECAR_LOST" });
		}),
	]).then(([sessionUnlisten, lostUnlisten]) => {
		if (disposed) {
			sessionUnlisten();
			lostUnlisten();
			return;
		}
		unlistenSession = sessionUnlisten;
		unlistenLost = lostUnlisten;
		resolveListenerReadyRef.current?.();
	});

	return () => {
		disposed = true;
		unlistenSession?.();
		unlistenLost?.();
	};
}, [handleEnvelope]);
```

`startStream` waits through `ensureSession`, so no prompt can be sent before the event listener is attached. Add deterministic tests for a delayed listener registration, an old load resolving after `sidecar_lost`, an old load resolving after `removeSession`, and a replacement load whose promise must survive the old promise's `finally`.

- [ ] **Step 7: Return the keyed controller API**

Return:

```ts
return {
	state,
	states,
	getSessionState: (sessionFile: string) => statesRef.current.get(sessionFile),
	hydrateSession,
	ensureSession,
	startStream,
	abortStream,
	steerStream,
	followUpStream,
	clearQueue,
	setSessionModel,
	removeSession,
	dispatch: (action: StreamAction) => {
		if (activeSessionFile) dispatchTo(activeSessionFile, action);
	},
};
```

The compatibility `dispatch` remains temporarily for `App` reset/error paths, but it can mutate only the active key.

- [ ] **Step 8: Run hook and relay tests**

```bash
pnpm test -- src/hooks/usePiStream.test.ts src/hooks/usePiStream.session.test.ts
pnpm run typecheck
cargo test --workspace session_stream -- --nocapture
```

Expected: all commands pass. Assert `send_prompt` is invoked without `ch`.

- [ ] **Step 9: Commit**

```bash
git add src/hooks/usePiStream.ts src/hooks/usePiStream.session.test.ts
git commit -m "feat(frontend): route concurrent streams by session"
```

---

### Task 5: Switch Cached Sessions Without Abort or Backend Reload

**Files:**
- Create: `src/App.sessions.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.telemetry.test.tsx`

- [ ] **Step 1: Build an App session test harness**

Create `src/App.sessions.test.tsx`. Reuse the exact static auth/onboarding/update/settings mocks from `src/App.telemetry.test.tsx`, then add this stateful stream harness and functional component doubles:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockInvoke = vi.hoisted(() => vi.fn());
const controller = vi.hoisted(() => ({
	states: new Map<string, any>(),
	entries: [] as Array<any>,
	newSnapshot: null as any,
	ensureSession: vi.fn(),
	abortStream: vi.fn(),
	hydrateSession: vi.fn(),
	removeSession: vi.fn(),
	setSessionModel: vi.fn(),
	startStream: vi.fn(),
	steerStream: vi.fn(),
	followUpStream: vi.fn(),
	clearQueue: vi.fn(),
	dispatch: vi.fn(),
	getSessionState: vi.fn(),
}));

function streamState(
	sessionFile: string,
	content: string,
	options: {
		running?: boolean;
		model?: { provider: string; id: string };
		settledVersion?: number;
	} = {},
) {
	return {
		sessionFile,
		cwd: `/work/${sessionFile.slice(1, 2)}`,
		model: options.model,
		runtimeLoaded: true,
		loadStatus: "loaded",
		messages: [{ id: content, role: "assistant", content, timestamp: 1 }],
		streamingMessage: null,
		isRunning: options.running ?? false,
		status: options.running ? "responding" : "idle",
		error: null,
		sessionError: null,
		queue: { steering: [], followUp: [] },
		streamSegments: [],
		queuedKinds: {},
		promptEchoConsumed: false,
		awaitingDone: options.running ?? false,
		settledVersion: options.settledVersion ?? 0,
	};
}

const EMPTY: any = streamState("", "");
EMPTY.messages = [];
EMPTY.sessionFile = null;
EMPTY.cwd = null;
EMPTY.runtimeLoaded = false;

vi.mock("@/hooks/usePiStream", () => ({
	usePiStream: (activeFile: string | null) => ({
		state: activeFile ? controller.states.get(activeFile) ?? streamState(activeFile, "") : EMPTY,
		states: controller.states,
		getSessionState: controller.getSessionState,
		hydrateSession: controller.hydrateSession,
		ensureSession: controller.ensureSession,
		startStream: controller.startStream,
		abortStream: controller.abortStream,
		steerStream: controller.steerStream,
		followUpStream: controller.followUpStream,
		clearQueue: controller.clearQueue,
		setSessionModel: controller.setSessionModel,
		removeSession: controller.removeSession,
		dispatch: controller.dispatch,
	}),
}));

vi.mock("@tauri-apps/api/core", () => ({
	isTauri: () => false,
	invoke: mockInvoke,
}));

vi.mock("@/components/Sidebar", () => ({
	Sidebar: ({ sessions, onSessionSelect, onNewSession, onDeleteSession }: {
		sessions: Array<{ id: string; title: string; lastMessage: string; runtimeStatus?: string }>;
		onSessionSelect: (id: string) => void;
		onNewSession: () => void;
		onDeleteSession: (id: string) => void;
	}) => (
		<div>
			{sessions.map((session) => (
				<div key={session.id}>
					<button type="button" aria-label={`select ${session.id}`} onClick={() => onSessionSelect(session.id)}>
						{session.title}:{session.runtimeStatus}:{session.lastMessage}
					</button>
					<button type="button" aria-label={`delete ${session.id}`} onClick={() => onDeleteSession(session.id)}>
						delete
					</button>
				</div>
			))}
			<button type="button" onClick={onNewSession}>new-session</button>
		</div>
	),
}));

vi.mock("@/chat/ChatView", () => ({
	ChatView: ({ messages, currentModelId }: {
		messages: Array<{ content: string }>;
		currentModelId?: string;
	}) => (
		<div data-testid="chat-state">
			{messages.map((message) => message.content).join("|")}:{currentModelId}
		</div>
	),
}));

vi.mock("@/components/ui/confirm-dialog", () => ({
	ConfirmDialog: ({ open, title, confirmLabel, onConfirm }: {
		open: boolean;
		title: string;
		confirmLabel: string;
		onConfirm: () => void;
	}) => open ? (
		<div>
			<span>{title}</span>
			<button type="button" onClick={onConfirm}>{confirmLabel}</button>
		</div>
	) : null,
}));
```

In `beforeEach`, reset controller state and install real stateful mock behavior:

```ts
beforeEach(() => {
	controller.states = new Map();
	controller.entries = [];
	controller.newSnapshot = null;
	for (const mock of [
		controller.ensureSession,
		controller.abortStream,
		controller.hydrateSession,
		controller.removeSession,
		controller.setSessionModel,
		controller.startStream,
		controller.steerStream,
		controller.followUpStream,
		controller.clearQueue,
		controller.dispatch,
		controller.getSessionState,
	]) mock.mockReset();
	controller.getSessionState.mockImplementation((file: string) => controller.states.get(file));
	controller.abortStream.mockResolvedValue(true);
	controller.ensureSession.mockResolvedValue(null);
	controller.hydrateSession.mockImplementation((snapshot: any) => {
		controller.states = new Map(controller.states).set(
			snapshot.sessionFile,
			streamState(snapshot.sessionFile, snapshot.messages.at(0)?.content ?? "", {
				model: snapshot.model,
			}),
		);
	});
	controller.removeSession.mockImplementation((file: string) => {
		controller.states = new Map(controller.states);
		controller.states.delete(file);
	});
	mockInvoke.mockReset().mockImplementation((command: string) => {
		if (command === "list_sessions") return Promise.resolve({ sessions: controller.entries });
		if (command === "new_session") return Promise.resolve(controller.newSnapshot);
		if (command === "get_settings") return Promise.resolve({});
		if (command === "get_auth_status") return Promise.resolve({ providers: [] });
		return Promise.resolve(null);
	});
});
```

- [ ] **Step 2: Add failing App behavior tests**

After importing `App`, add:

```ts
it("switches to a cached session without aborting or loading", async () => {
	controller.states = new Map([
		["/a.jsonl", streamState("/a.jsonl", "A history", { running: true })],
		["/b.jsonl", streamState("/b.jsonl", "B history")],
	]);
	controller.entries = [
		{ file: "/a.jsonl", title: "A", messageCount: 1, createdAt: 1, lastActivity: 2 },
		{ file: "/b.jsonl", title: "B", messageCount: 1, createdAt: 1, lastActivity: 2 },
	];
	render(<App />);
	await screen.findByRole("button", { name: "select /a.jsonl" });
	fireEvent.click(screen.getByRole("button", { name: "select /a.jsonl" }));
	controller.ensureSession.mockClear();
	controller.abortStream.mockClear();
	fireEvent.click(screen.getByRole("button", { name: "select /b.jsonl" }));
	await waitFor(() => expect(screen.getByTestId("chat-state")).toHaveTextContent("B history"));
	expect(controller.ensureSession).not.toHaveBeenCalled();
	expect(controller.abortStream).not.toHaveBeenCalled();
	expect(mockInvoke).not.toHaveBeenCalledWith("load_session", expect.anything());
});

it("starts one cold load without stopping a running visible session", async () => {
	controller.states = new Map([
		["/a.jsonl", streamState("/a.jsonl", "A live", { running: true })],
	]);
	controller.entries = [
		{ file: "/a.jsonl", title: "A", messageCount: 1, createdAt: 1, lastActivity: 2 },
		{ file: "/c.jsonl", title: "C", messageCount: 1, createdAt: 1, lastActivity: 2 },
	];
	render(<App />);
	await screen.findByRole("button", { name: "select /a.jsonl" });
	fireEvent.click(screen.getByRole("button", { name: "select /a.jsonl" }));
	controller.abortStream.mockClear();
	fireEvent.click(screen.getByRole("button", { name: "select /c.jsonl" }));
	fireEvent.click(screen.getByRole("button", { name: "select /c.jsonl" }));
	expect(controller.ensureSession).toHaveBeenCalledTimes(1);
	expect(controller.ensureSession).toHaveBeenCalledWith("/c.jsonl");
	expect(controller.abortStream).not.toHaveBeenCalled();
});

it("keeps each cached session model visible when switching", async () => {
	controller.states = new Map([
		["/a.jsonl", streamState("/a.jsonl", "A", { model: { provider: "provider-a", id: "model-a" } })],
		["/b.jsonl", streamState("/b.jsonl", "B", { model: { provider: "provider-b", id: "model-b" } })],
	]);
	controller.entries = [
		{ file: "/a.jsonl", title: "A", messageCount: 1, createdAt: 1, lastActivity: 2 },
		{ file: "/b.jsonl", title: "B", messageCount: 1, createdAt: 1, lastActivity: 2 },
	];
	render(<App />);
	await screen.findByRole("button", { name: "select /a.jsonl" });
	fireEvent.click(screen.getByRole("button", { name: "select /a.jsonl" }));
	await waitFor(() => expect(screen.getByTestId("chat-state")).toHaveTextContent("provider-a/model-a"));
	fireEvent.click(screen.getByRole("button", { name: "select /b.jsonl" }));
	await waitFor(() => expect(screen.getByTestId("chat-state")).toHaveTextContent("provider-b/model-b"));
});

it("creates a new session without aborting the previous running session", async () => {
	controller.states = new Map([
		["/a.jsonl", streamState("/a.jsonl", "A live", { running: true })],
	]);
	controller.entries = [
		{ file: "/a.jsonl", title: "A", messageCount: 1, createdAt: 1, lastActivity: 2 },
	];
	controller.newSnapshot = {
		sessionFile: "/b.jsonl",
		mode: "chat",
		cwd: "/work/b",
		messages: [],
		isRunning: false,
		status: "idle",
		queue: { steering: [], followUp: [] },
	};
	render(<App />);
	await screen.findByRole("button", { name: "select /a.jsonl" });
	fireEvent.click(screen.getByRole("button", { name: "select /a.jsonl" }));
	controller.abortStream.mockClear();
	fireEvent.click(screen.getByText("new-session"));
	await waitFor(() => expect(controller.hydrateSession).toHaveBeenCalledWith(controller.newSnapshot));
	expect(controller.abortStream).not.toHaveBeenCalled();
});
```

Use the real model catalog mock with `provider-a/model-a` and `provider-b/model-b`; keep the remaining static component mocks identical to `App.telemetry.test.tsx`.

- [ ] **Step 3: Run the App tests and verify failure**

```bash
pnpm test -- src/App.sessions.test.tsx
```

Expected: cached-switch and new-session tests fail because `App` still aborts and always invokes `load_session`.

- [ ] **Step 4: Adopt the keyed controller in App**

Destructure:

```ts
const {
	state: streamState,
	states: streamStates,
	getSessionState,
	hydrateSession,
	ensureSession,
	startStream,
	abortStream,
	steerStream,
	followUpStream,
	clearQueue,
	setSessionModel,
	removeSession,
	dispatch,
} = usePiStream(activeSessionFile);
```

Delete `loadingSession` state. Replace mutable `workspaceCwd` state with:

```ts
const workspaceCwd = streamState.cwd;
```

Keep `homeDir` as global default-workspace state.

- [ ] **Step 5: Separate caching from activation**

Replace `adoptSnapshot` with:

```ts
const cacheSnapshot = useCallback((snapshot: SessionSnapshot) => {
	hydrateSession(snapshot);
}, [hydrateSession]);

const activateSnapshot = useCallback((snapshot: SessionSnapshot) => {
	cacheSnapshot(snapshot);
	setActiveSessionFile(snapshot.sessionFile);
}, [cacheSnapshot]);
```

Startup ready handling may call `activateSnapshot`. Background cold loads call only `cacheSnapshot` through `ensureSession`; a late A load must never steal focus from B.

- [ ] **Step 6: Remove stop-on-switch and stop-on-new-session**

Replace `handleSessionSelect` with:

```ts
const handleSessionSelect = useCallback((file: string) => {
	if (file === activeSessionFile) return;
	setActiveSessionFile(file);
	const cached = getSessionState(file);
	if (!cached?.runtimeLoaded) {
		void ensureSession(file).catch((error) => {
			log.error("Failed to load session:", error);
		});
	}
}, [activeSessionFile, ensureSession, getSessionState]);
```

Remove the abort block from `handleNewSession`. After `new_session` returns, call `activateSnapshot(snapshot)` and apply the selected default model only to `snapshot.sessionFile`.

The active content loading branch becomes:

```tsx
streamState.loadStatus === "loading" && streamState.messages.length === 0 ? (
	<div className="flex-1 flex flex-col items-center justify-center gap-4">
		<div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
		<div className="text-sm text-muted-foreground">Loading session...</div>
	</div>
) : (
	<ChatView />
)
```

- [ ] **Step 7: Make model display and mutation session-local**

Keep `activeModelId` as the saved default for future sessions. Derive the visible model:

```ts
const sessionModelId = streamState.model?.id
	? modelKey(streamState.model.provider, streamState.model.id)
	: undefined;
const visibleModelId = sessionModelId ?? activeModelId;
```

Pass `visibleModelId` to `ChatView.currentModelId` and use it for prompt telemetry.

After `set_active_model` succeeds, update only the addressed cache:

```ts
setSessionModel(sid, { provider, id: modelId });
```

Do the same after applying the saved default to a newly created session. Switching sessions must not call `set_active_model`.

- [ ] **Step 8: Update ready/restart behavior**

On initial ready, activate the supplied snapshot only if no active key exists. On sidecar restart, keep cached UI state. `usePiStream` marks runtimes unloaded; `handleSessionSelect`/`startStream` lazily reloads them through `ensureSession`.

Do not loop over every cache entry during restart. Lazy reload is smaller, avoids a restart thundering herd, and still renders cached state immediately.

- [ ] **Step 9: Update the telemetry test mock contract**

The mock hook must include:

```ts
states: new Map(),
getSessionState: vi.fn(),
hydrateSession: vi.fn(),
ensureSession: vi.fn(),
setSessionModel: vi.fn(),
removeSession: vi.fn(),
```

Its mocked `state` must use `queue: { steering: [], followUp: [] }`, `messages: []`, `streamingMessage: null`, `isRunning: false`, `status: "idle"`, `error: null`, `cwd: null`, `model: undefined`, `runtimeLoaded: false`, `loadStatus: "loaded"`, `awaitingDone: false`, and `settledVersion: 0`.

- [ ] **Step 10: Run App/frontend tests**

```bash
pnpm test -- src/App.sessions.test.tsx src/App.telemetry.test.tsx \
  src/hooks/usePiStream.session.test.ts
pnpm run typecheck
```

Expected: cached switch performs no abort/load, new session performs no abort, and all tests pass.

- [ ] **Step 11: Commit**

```bash
git add src/App.tsx src/App.sessions.test.tsx src/App.telemetry.test.tsx
git commit -m "feat(frontend): switch sessions from live cache"
```

---

### Task 6: Show Accessible Runtime Status and Collapsed Running Count

**Files:**
- Modify: `src/components/ConversationSearch.tsx`
- Modify: `src/components/ConversationSearch.test.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/Sidebar.test.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add failing row-indicator tests**

Extend the test `Session` fixtures with:

```ts
runtimeStatus: "running" as const,
runtimeError: undefined,
```

Add:

```ts
it("shows a labeled running indicator without replacing active styling", () => {
	render(
		<ConversationSearch
			sessions={[{
				...mockSessions[0],
				runtimeStatus: "running",
			}]}
			activeSessionId="1"
			onSelect={noop}
			onNewSession={noop}
			onOpenSession={noop}
			onDeleteSession={noop}
		/>,
	);
	expect(screen.getByLabelText("React project setup is running")).toBeInTheDocument();
	const row = screen.getByRole("button", { name: /React project setup/i });
	expect(row.className).toContain("bg-sidebar-accent");
});

it("shows a labeled session error", () => {
	render(
		<ConversationSearch
			sessions={[{
				...mockSessions[1],
				runtimeStatus: "error",
				runtimeError: "Rate limited",
			}]}
			onSelect={noop}
			onNewSession={noop}
			onOpenSession={noop}
			onDeleteSession={noop}
		/>,
	);
	expect(screen.getByLabelText("API design patterns failed: Rate limited")).toBeInTheDocument();
});
```

- [ ] **Step 2: Add failing collapsed-sidebar test**

In `Sidebar.test.tsx` add:

```ts
it("shows the running count when collapsed", () => {
	render(
		<Sidebar
			{...baseProps}
			collapsed
			onCollapsedChange={vi.fn()}
			sessions={[
				{ ...baseProps.sessions[0], runtimeStatus: "running" },
				{ id: "2", title: "Second", lastMessage: "work", timestamp: 2, runtimeStatus: "running" },
			]}
		/,
	);
	expect(screen.getByLabelText("2 running sessions")).toBeInTheDocument();
});
```

- [ ] **Step 3: Run component tests and verify failure**

```bash
pnpm test -- src/components/ConversationSearch.test.tsx src/components/Sidebar.test.tsx
```

Expected: TypeScript/runtime failures because status and collapse props do not exist.

- [ ] **Step 4: Add runtime fields to session presentation types**

In both `Sidebar.tsx` and `ConversationSearch.tsx`, extend `Session`:

```ts
runtimeStatus?: "idle" | "running" | "error";
runtimeError?: string;
```

Do not overload `active`; runtime status and selected-row state are independent.

- [ ] **Step 5: Render status before the title**

Import `CircleAlert` and `LoaderCircle`. Inside the title row, before pinned/title content, render:

```tsx
{session.runtimeStatus === "running" && (
	<LoaderCircle
		className="w-3 h-3 shrink-0 text-primary animate-spin motion-reduce:animate-none"
		aria-label={`${session.title} is running`}
	/>
)}
{session.runtimeStatus === "error" && (
	<CircleAlert
		className="w-3 h-3 shrink-0 text-destructive"
		aria-label={`${session.title} failed${session.runtimeError ? `: ${session.runtimeError}` : ""}`}
	/>
)}
```

Idle sessions render no status icon. Keep the active accent bar unchanged.

- [ ] **Step 6: Add manual sidebar collapse**

Add `collapsed: boolean` and `onCollapsedChange(collapsed: boolean)` props. Import `ChevronLeft`, `ChevronRight`, `FolderPlus`, and `FolderOpen` as needed.

Expanded mode keeps `ConversationSearch` and adds an accessible collapse button. Collapsed mode renders a `w-14` rail containing:

- expand button;
- new-session button;
- open-folder button;
- running-count badge when count is greater than zero;
- settings button.

The badge must be:

```tsx
<span
	className="min-w-5 h-5 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center"
	aria-label={`${runningCount} running ${runningCount === 1 ? "session" : "sessions"}`}
>
	{runningCount}
</span>
```

Default remains expanded. Phase 3 may choose a mode-specific default; Phase 2 adds only manual collapse and status visibility.

- [ ] **Step 7: Pass runtime summaries from App**

When building `sidebarSessions`, derive:

```ts
const live = streamStates.get(s.file);
const runtimeStatus = live?.isRunning
	? "running"
	: live?.status === "error" || live?.error
		? "error"
		: "idle";
```

Pass `runtimeStatus` and `runtimeError: live?.error ?? undefined`.

Add:

```ts
const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
```

Pass `collapsed={sidebarCollapsed}` and `onCollapsedChange={setSidebarCollapsed}` to every Sidebar renderer. Grep all `<Sidebar` renderers, including tests, before typecheck.

- [ ] **Step 8: Run component and frontend gates**

```bash
rg '<Sidebar' src -g '*.tsx'
pnpm test -- src/components/ConversationSearch.test.tsx src/components/Sidebar.test.tsx \
  src/App.sessions.test.tsx
pnpm run typecheck
```

Expected: indicators are accessible, active styling remains independent, collapsed badge reports count, and typecheck passes.

- [ ] **Step 9: Commit**

```bash
git add src/components/ConversationSearch.tsx \
  src/components/ConversationSearch.test.tsx \
  src/components/Sidebar.tsx src/components/Sidebar.test.tsx src/App.tsx \
  src/App.sessions.test.tsx
git commit -m "feat(frontend): show session runtime status"
```

---

### Task 7: Reconcile Hidden Completion and Require Stop-and-Delete

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.sessions.test.tsx`
- Modify: `src/hooks/usePiStream.session.test.ts`

- [ ] **Step 1: Add failing hidden-completion and deletion tests**

In `App.sessions.test.tsx`, add:

```ts
it("updates a hidden session row when it completes", async () => {
	const runningA = streamState("/a.jsonl", "A started", { running: true });
	const idleB = streamState("/b.jsonl", "B history");
	controller.states = new Map([
		["/a.jsonl", runningA],
		["/b.jsonl", idleB],
	]);
	controller.entries = [
		{ file: "/a.jsonl", title: "A", messageCount: 1, createdAt: 1, lastActivity: 2 },
		{ file: "/b.jsonl", title: "B", messageCount: 1, createdAt: 1, lastActivity: 2 },
	];
	const view = render(<App />);
	await screen.findByRole("button", { name: "select /b.jsonl" });
	fireEvent.click(screen.getByRole("button", { name: "select /b.jsonl" }));
	await waitFor(() => expect(screen.getByRole("button", { name: "select /a.jsonl" })).toHaveTextContent("running"));

	const completedA = streamState("/a.jsonl", "A completed result", { settledVersion: 1 });
	controller.states = new Map([
		["/a.jsonl", completedA],
		["/b.jsonl", idleB],
	]);
	view.rerender(<App />);

	await waitFor(() => {
		const row = screen.getByRole("button", { name: "select /a.jsonl" });
		expect(row).toHaveTextContent("idle");
		expect(row).toHaveTextContent("A completed result");
	});
	expect(screen.getByTestId("chat-state")).toHaveTextContent("B history");
});

it("stops a running session before deleting it", async () => {
	controller.states = new Map([
		["/a.jsonl", streamState("/a.jsonl", "A live", { running: true })],
	]);
	controller.entries = [
		{ file: "/a.jsonl", title: "A", messageCount: 1, createdAt: 1, lastActivity: 2 },
	];
	render(<App />);
	await screen.findByRole("button", { name: "delete /a.jsonl" });
	fireEvent.click(screen.getByRole("button", { name: "delete /a.jsonl" }));
	expect(screen.getByText("Stop and delete chat?")).toBeInTheDocument();
	fireEvent.click(screen.getByRole("button", { name: "Stop and delete" }));
	await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("delete_session", {
		sessionFile: "/a.jsonl",
	}));
	const deleteIndex = mockInvoke.mock.calls.findIndex(([command]) => command === "delete_session");
	expect(controller.abortStream.mock.invocationCallOrder[0]).toBeLessThan(
		mockInvoke.mock.invocationCallOrder[deleteIndex],
	);
	expect(controller.removeSession).toHaveBeenCalledWith("/a.jsonl");
});

it("does not delete when stopping the running session fails", async () => {
	controller.states = new Map([
		["/a.jsonl", streamState("/a.jsonl", "A live", { running: true })],
	]);
	controller.entries = [
		{ file: "/a.jsonl", title: "A", messageCount: 1, createdAt: 1, lastActivity: 2 },
	];
	controller.abortStream.mockResolvedValue(false);
	render(<App />);
	await screen.findByRole("button", { name: "delete /a.jsonl" });
	fireEvent.click(screen.getByRole("button", { name: "delete /a.jsonl" }));
	fireEvent.click(screen.getByRole("button", { name: "Stop and delete" }));
	await waitFor(() => expect(controller.abortStream).toHaveBeenCalledWith("/a.jsonl"));
	expect(mockInvoke.mock.calls.some(([command]) => command === "delete_session")).toBe(false);
	expect(controller.removeSession).not.toHaveBeenCalled();
});

it("deletes an idle session without sending abort", async () => {
	controller.states = new Map([
		["/a.jsonl", streamState("/a.jsonl", "A idle")],
	]);
	controller.entries = [
		{ file: "/a.jsonl", title: "A", messageCount: 1, createdAt: 1, lastActivity: 2 },
	];
	render(<App />);
	await screen.findByRole("button", { name: "delete /a.jsonl" });
	fireEvent.click(screen.getByRole("button", { name: "delete /a.jsonl" }));
	fireEvent.click(screen.getByRole("button", { name: "Delete" }));
	await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("delete_session", {
		sessionFile: "/a.jsonl",
	}));
	expect(controller.abortStream).not.toHaveBeenCalled();
});
```

Implement the fixtures and assertions directly in the test file. Do not use source-text assertions.

- [ ] **Step 2: Run the App tests and verify failure**

```bash
pnpm test -- src/App.sessions.test.tsx
```

Expected: running deletion currently calls delete directly; hidden completion does not reconcile an inactive row.

- [ ] **Step 3: Preserve live entries during disk-list reconciliation**

Add a ref synchronized with the keyed map:

```ts
const streamStatesRef = useRef(streamStates);
const sessionListRequestRef = useRef(0);
useEffect(() => {
	streamStatesRef.current = streamStates;
}, [streamStates]);
```

At the start of `loadSessionList`, capture a request token and discard older responses:

```ts
const request = ++sessionListRequestRef.current;
const result = await invoke("list_sessions", {
	allFolders,
	cwd: workspaceCwd ?? undefined,
});
if (request !== sessionListRequestRef.current) return;
```

This prevents a slower list refresh from overwriting a later folder switch, completion refresh, create, or delete. When replacing disk entries, preserve current metadata for running sessions and append running optimistic entries that disk has not persisted yet:

```ts
setSessionEntries((current) => {
	const disk = data.sessions || [];
	const currentByFile = new Map(current.map((entry) => [entry.file, entry]));
	const diskFiles = new Set(disk.map((entry) => entry.file));
	const reconciled = disk.map((entry) => {
		const live = streamStatesRef.current.get(entry.file);
		const optimistic = currentByFile.get(entry.file);
		return live?.isRunning && optimistic
			? { ...entry, ...optimistic, pinned: entry.pinned, titleLocked: entry.titleLocked }
			: entry;
	});
	for (const entry of current) {
		if (!diskFiles.has(entry.file) && streamStatesRef.current.get(entry.file)?.isRunning) {
			reconciled.push(entry);
		}
	}
	return reconciled;
});
```

- [ ] **Step 4: Reconcile every terminal `done` transition**

Replace the active-only completion effect with a keyed `settledVersion` effect:

```ts
const previousSettledRef = useRef(new Map<string, number>());

useEffect(() => {
	let settled = false;
	for (const [sessionFile, state] of streamStates) {
		const previous = previousSettledRef.current.get(sessionFile) ?? 0;
		previousSettledRef.current.set(sessionFile, state.settledVersion);
		if (state.settledVersion <= previous) continue;
		settled = true;
		const latest = state.messages.at(-1);
		setSessionEntries((entries) => entries.map((entry) =>
			entry.file === sessionFile
				? {
					...entry,
					messageCount: state.messages.length,
					lastActivity: Date.now(),
					preview: typeof latest?.content === "string"
						? latest.content.replace(/\s+/g, " ").trim().slice(0, 120)
						: entry.preview,
				}
				: entry,
		));
	}
	if (settled) loadSessionList().catch((error) => log.error("Failed to refresh sessions:", error));
}, [streamStates]);
```

This effect updates hidden A even while B is active. Disk reconciliation cannot overwrite another still-running session because Step 3 treats live state as authoritative.

- [ ] **Step 5: Capture running state in the delete request**

Change pending-delete state to:

```ts
const [pendingDelete, setPendingDelete] = useState<{
	file: string;
	title: string;
	running: boolean;
} | null>(null);
```

In `handleDeleteSession`, set `running` from `getSessionState(file)?.isRunning === true`.

Render copy:

```tsx
title={pendingDelete?.running ? "Stop and delete chat?" : "Delete chat?"}
confirmLabel={pendingDelete?.running ? "Stop and delete" : "Delete"}
```

The running description must state that current work will stop before permanent deletion.

- [ ] **Step 6: Stop successfully before deleting**

Replace `handleConfirmDelete` with:

```ts
const handleConfirmDelete = useCallback(async () => {
	if (!pendingDelete) return;
	const { file, running } = pendingDelete;
	if (running) {
		const stopped = await abortStream(file);
		if (!stopped) {
			log.error("Failed to stop running session; deletion cancelled");
			return;
		}
	}
	try {
		await invoke("delete_session", { sessionFile: file });
	} catch (error) {
		log.error("Failed to delete session:", error);
		return;
	}
	removeSession(file);
	setSessionEntries((entries) => entries.filter((entry) => entry.file !== file));
	if (activeSessionFile === file) setActiveSessionFile(null);
}, [pendingDelete, abortStream, removeSession, activeSessionFile]);
```

Do not dispatch global `RESET`; removing one key is sufficient and cannot erase another session.

- [ ] **Step 7: Add hook assertions for targeted abort/remove**

Add:

```ts
it("aborting and removing A leaves B running and unchanged", async () => {
	const { result } = renderHook(() => usePiStream("/a.jsonl"));
	act(() => {
		result.current.hydrateSession(snapshot("/a.jsonl", "A history"));
		result.current.hydrateSession(snapshot("/b.jsonl", "B history"));
	});
	await act(async () => Promise.all([
		result.current.startStream("/a.jsonl", "A prompt"),
		result.current.startStream("/b.jsonl", "B prompt"),
	]));
	const bBefore = result.current.states.get("/b.jsonl");
	await act(async () => result.current.abortStream("/a.jsonl"));
	act(() => result.current.removeSession("/a.jsonl"));
	expect(result.current.states.has("/a.jsonl")).toBe(false);
	expect(result.current.states.get("/b.jsonl")).toEqual(bBefore);
	expect(result.current.states.get("/b.jsonl")?.isRunning).toBe(true);
});
```

- [ ] **Step 8: Run focused tests**

```bash
pnpm test -- src/App.sessions.test.tsx src/hooks/usePiStream.session.test.ts \
  src/components/ConversationSearch.test.tsx
pnpm run typecheck
```

Expected: hidden completion updates A's row, stop precedes delete, stop failure prevents deletion, and B remains untouched.

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx src/App.sessions.test.tsx src/hooks/usePiStream.session.test.ts
git commit -m "feat(frontend): reconcile and safely delete live sessions"
```

---

### Task 8: Phase Boundary Regression and Manual Acceptance

**Files:**
- No planned production files.
- Fix regressions only in files already listed in Tasks 1–7.

- [ ] **Step 1: Run all Phase 2 focused tests**

```bash
pnpm test -- src/hooks/usePiStream.test.ts src/hooks/usePiStream.session.test.ts \
  src/App.sessions.test.tsx src/App.telemetry.test.tsx \
  src/components/Sidebar.test.tsx src/components/ConversationSearch.test.tsx
(cd agent-sidecar && pnpm test -- src/concurrent-sessions.test.ts \
  src/session-protocol.test.ts src/session-runtime-manager.test.ts \
  src/commands/handlers/core.test.ts src/commands/handlers/sessions.test.ts)
cargo test --workspace session_stream -- --nocapture
```

Expected: every test passes.

- [ ] **Step 2: Run repository build/quality gates**

```bash
pnpm run validate
pnpm run build:frontend
(cd agent-sidecar && pnpm test && pnpm build)
cargo fmt --check
cargo clippy --workspace -- -D warnings
cargo test --workspace
```

Expected: all code/test/build gates exit `0` with no warnings.

Known PR-wide security audits were already failing before Phase 2 due newly published transitive npm advisories and `RUSTSEC-2026-0235` for `rkyv 0.7.46`. Do not change dependencies inside this phase plan. They remain a required final-merge gate and must be remediated in release hardening or a dedicated approved task before the draft PR becomes ready.

- [ ] **Step 3: Verify one event transport and no stop-on-switch**

```bash
rg 'PendingPrompt|pending_prompts|Channel<Value>|new Channel' src-tauri/src/lib.rs src/hooks/usePiStream.ts
rg 'session_event' src-tauri/src/lib.rs src/hooks/usePiStream.ts
rg 'abortStream\(activeSessionFile' src/App.tsx
rg 'Map<string, StreamState>' src/hooks/usePiStream.ts
```

Expected:

- first search returns no matches;
- relay and hook both use `session_event`;
- stop-on-switch search returns no matches;
- keyed state map exists.

- [ ] **Step 4: Run manual concurrent-session acceptance**

Use:

```bash
pnpm run dev
```

Verify in order:

1. Start a long prompt in session A.
2. Click New and start a different prompt in B before A completes.
3. Confirm A and B both show running indicators.
4. Switch A → B → A repeatedly. Loaded switches show cached content immediately, with no loading screen and no abort.
5. Confirm A and B continue receiving only their own text, tools, model labels, queues, and errors.
6. Steer A. Confirm B continues unchanged.
7. Queue a follow-up in B, switch to A, return to B, and confirm its queue remains.
8. Abort A. Confirm B continues.
9. Let hidden B complete. Confirm its sidebar indicator clears and its updated preview appears; reopen B and confirm complete output.
10. Rapid-click a cold persisted session. Confirm one `load_session` request and one coherent transcript.
11. Change A's model, switch to B, and confirm B's model did not change. Create C and confirm the saved default applies only as intended for the new session.
12. Attempt to delete running B. Confirm `Stop and delete`, stop completion, then deletion. Confirm another session remains intact.
13. Crash/reload the sidecar during a run. Confirm running sessions become failed/interrupted, persisted history remains visible, and selecting/sending lazily reloads the runtime after readiness.
14. Collapse the sidebar. Confirm the running-count badge is visible and labeled. Enable reduced motion and confirm spinner motion is disabled while status remains readable.
15. Confirm loaded-session switching feels immediate and measures below `100ms` using browser performance tooling.

- [ ] **Step 5: Confirm later phases did not leak in**

Verify:

- snapshot mode remains the hard-coded `"chat"` compatibility value;
- no Chat/Work switch or mode metadata was added;
- no Work result canvas or Outputs/Sources rail was added;
- no typography baseline changed;
- no selected-text action menu was added;
- no runtime eviction or concurrency limit was added.

- [ ] **Step 6: Review branch diff**

```bash
git diff --check
git status --short
git log --oneline --decorate -12
git diff --stat main...HEAD
```

Expected: clean working tree after commits, no whitespace errors, and focused Phase 1/2 commits on `feat/chat-work-phase-1-runtime-identity`.

- [ ] **Step 7: Run a focused code review**

Run repository review tooling against `main`, focusing on:

- event duplication/loss;
- stale closures and rapid-switch races;
- hidden-session state crossover;
- sidecar restart behavior;
- delete/abort ordering;
- whole-app rerender pressure;
- accessibility of runtime indicators.

Fix verified Critical/Important findings with failing tests first. Do not broaden into Phase 3.

- [ ] **Step 8: Push the draft PR branch**

```bash
git push origin feat/chat-work-phase-1-runtime-identity
```

Keep PR #354 draft. Do not merge or mark ready.

## Phase 2 Completion Criteria

Phase 2 is complete only when:

- two sessions can stream concurrently;
- every event, queue update, error, abort, and completion mutates only its session key;
- loaded switching changes only `activeSessionFile`, performs no backend load, and does not abort;
- cold loads deduplicate in frontend and sidecar;
- hidden completion remains cached and updates sidebar metadata;
- model/workspace/queue commands target the addressed session;
- running/error/idle sidebar states are accessible and independent from active styling;
- collapsed navigation exposes a running-count badge;
- running deletion requires successful stop before persistence deletion;
- sidecar loss marks running sessions interrupted and cached sessions remain lazily reloadable;
- all Phase 2 code/test/build gates pass;
- no Phase 3–5 product UI appears.

This plan intentionally stops at **Phase 2: Concurrent Execution, Cached Switching, and Sidebar Status**. Phase 3 requires a separate detailed plan for Chat/Work mode persistence, mode-specific empty states, and readable typography.
