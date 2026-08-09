# Chat/Work Mode, Empty States, and Readable Typography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each session a durable Chat or Work mode that can change only before its first prompt, render the approved mode-specific empty states, and raise Chat/Work typography to the approved readable desktop defaults.

**Architecture:** Extend existing `cowork-meta.json` with validated per-session mode entries and expose one guarded `set_session_mode` command through the thin Tauri relay. Carry mode inside existing keyed `StreamState`; serialize mode mutations per session and await the final mutation before the first `START_STREAM`, so optimistic messages cannot race persistence. Keep `ChatView` as the Phase 3 shared shell and keep its one `MessageInput` mounted while mode-specific intro/starter regions move around it; active Work intentionally remains the existing transcript until Phase 4.

**Tech Stack:** React 19, TypeScript, Vitest, React Testing Library, Tauri 2/Rust, Pi coding-agent SDK, Tailwind CSS v4, existing Motion/Lucide components.

**Roadmap:** [`docs/superpowers/roadmaps/2026-08-09-chat-work-concurrent-sessions-roadmap.md`](../roadmaps/2026-08-09-chat-work-concurrent-sessions-roadmap.md)

**Phase:** Phase 3: Chat/Work Mode, Empty States, and Readable Typography

---

## Phase Guardrails

This phase adds truthful session mode, empty-state presentation, and readability. It intentionally does **not** add:

- active Work document/result layout;
- Outputs or Sources;
- `RightPanel`/`DocumentsPanel` replacement;
- selected-text `Ask AI` or `Start writing`;
- Projects, plugins, Library, Agents, or Scheduled tasks;
- a new state-management/UI dependency;
- runtime eviction, a concurrency cap, replay cursors, or work surviving app shutdown.

Active Work sessions use the existing transcript after the first prompt. The selected mode is still truthful and durable; Phase 4 changes only its active presentation. PR #354 remains draft and unmerged.

## Phase 1–2 Contracts Carried Forward

- Canonical absolute `sessionFile` remains session identity.
- Every session-bound command addresses one loaded runtime; no active-session fallback.
- `new_session` and `load_session` return complete snapshots.
- Mode joins model/cwd/queue as keyed `StreamState` data; it is never App-global for loaded sessions.
- `settledVersion`/`awaitingDone` and normalized `done` remain the sole terminal-completion contract.
- Abort remains a quiescence barrier; delete remains stop-first, then persisted deletion, then cache removal.
- Sidecar epoch invalidation, deletion tombstones, listener readiness, load deduplication, and promise-identity cleanup remain unchanged.
- The global `session_event` bus remains the sole stream path. This phase adds no replay protocol.
- `modelKey(provider, id)` remains the only frontend model identity.

## Important Existing-Code Findings

1. `SessionSnapshot.mode` is currently hard-coded to `"chat"` in both sidecar and frontend types.
2. `snapshotRuntime()` has no metadata input. Only new/load/ready handlers call it, so adding an optional mode argument is smaller than putting filesystem state on every runtime.
3. `App.handleSend()` dispatches `START_STREAM` through `startStream()`, which immediately adds the optimistic first user message. Mode persistence must therefore complete **before** `startStream()`.
4. The sidecar reads stdin commands asynchronously. Rapid mode switches need explicit per-session serialization in the frontend; transport write order alone is not a lock contract.
5. `ChatView` currently keeps one composer mounted and positions it with flex spacers. Empty-state work must preserve that component position instead of branching to a second composer.
6. `font-scale.ts` still contains persisted zoom presets, but `App` hard-codes `[zoom:1] h-screen`. Phase 3 restores the persisted class without adding a new settings UI.
7. Existing Chat/Work-relevant UI contains `9–11px` labels. The typography task raises core Chat, composer, model/command menus, tool activity, and sidebar text; settings/onboarding typography is not redesigned in this phase.

## File Structure

### New files

- `src/components/SessionModeSwitcher.tsx`: accessible Chat/Work tab control for empty sessions.
- `src/components/SessionEmptyState.tsx`: mode-specific intro and starter regions; no composer duplication.
- `src/components/SessionEmptyState.test.tsx`: headings, keyboard mode switching, starter-fill behavior, workspace label, and no auto-send coverage.
- `src/test/chat-typography.test.ts`: static regression guard for approved typography tokens and core minimums.

### Modified files

- `agent-sidecar/src/session-protocol.ts`, `session-protocol.test.ts`: define `SessionMode`, broaden snapshot mode, and freeze mode error codes.
- `agent-sidecar/src/pi-session-store.ts`, `pi-session-store.test.ts`: validate/read/write/list/delete mode metadata.
- `agent-sidecar/src/session-runtime-manager.ts`, `session-runtime-manager.test.ts`: snapshot an explicitly supplied mode while preserving Chat default.
- `agent-sidecar/src/commands/types.ts`, `handler-registry.ts`: register `set_session_mode`.
- `agent-sidecar/src/commands/handlers/sessions.ts`, `sessions.test.ts`: guarded empty-runtime mode mutation and mode-aware snapshots.
- `src-tauri/src/lib.rs`: forward `set_session_mode` with a unique request ID and register the command.
- `src/types/session-runtime.ts`: shared frontend `SessionMode` and snapshot mode.
- `src/hooks/usePiStream.ts`, `usePiStream.test.ts`, `usePiStream.session.test.ts`: keyed mode state and serialized mutation controller.
- `src/App.tsx`, `App.sessions.test.tsx`, `App.telemetry.test.tsx`: mode ownership, first-send ordering, targeted drafts, sidebar defaults, and mode errors.
- `src/chat/ChatView.tsx`, `ChatView.test.tsx`: shared empty/active shell around one persistent composer.
- `src/components/MessageInput.tsx`, `MessageInput.test.tsx`: Chat/Work empty variants without losing attachment/voice/model/queue behavior.
- `src/components/Sidebar.tsx`, `Sidebar.test.tsx`: preserve collapse controls with readable sizes.
- `src/components/ConversationSearch.tsx`, `ConversationSearch.test.tsx`: show Chat/Work row labels and readable session metadata.
- `src/components/ChatMessage.tsx`, `ActivityBlock.tsx`, `ThinkingBlock.tsx`, `ToolCallTimeline.tsx`, `ArtifactPreview.tsx`, `FileMentionPopup.tsx`, `FilePreviewChip.tsx`, `InThreadFind.tsx`, `ModelSelector.tsx`, `CommandPalette.tsx`: approved Chat reading/control sizes.
- `src/App.css`, `src/test/theme-consistency.test.ts`: semantic typography tokens, system reading stack, and persisted zoom application.

No dependency or lockfile change belongs in this phase.

---

### Task 1: Persist Validated Session Mode Metadata

**Files:**
- Modify: `agent-sidecar/src/session-protocol.ts`
- Modify: `agent-sidecar/src/session-protocol.test.ts`
- Modify: `agent-sidecar/src/pi-session-store.ts`
- Modify: `agent-sidecar/src/pi-session-store.test.ts`

- [ ] **Step 1: Add failing metadata tests**

Update every `CoworkMeta` literal in `pi-session-store.test.ts` to include `modes: {}`. Import `writeFileSync` and these new functions:

```ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
// Add these names to the existing ./pi-session-store.js import:
deletePiSession,
getPiSessionMode,
setPiSessionMode,
```

Add:

```ts
describe("session mode metadata", () => {
	it("defaults legacy metadata to chat", () => {
		writeFileSync(join(dir, "cowork-meta.json"), JSON.stringify({
			pinned: [],
			titles: {},
		}), "utf8");
		expect(getPiSessionMode(dir, "/p/a.jsonl")).toBe("chat");
	});

	it("round-trips chat and work by session file", () => {
		expect(setPiSessionMode(dir, "/p/a.jsonl", "work")).toBe(true);
		expect(getPiSessionMode(dir, "/p/a.jsonl")).toBe("work");
		expect(setPiSessionMode(dir, "/p/a.jsonl", "chat")).toBe(true);
		expect(getPiSessionMode(dir, "/p/a.jsonl")).toBe("chat");
	});

	it("drops corrupt mode values without losing valid entries", () => {
		writeFileSync(join(dir, "cowork-meta.json"), JSON.stringify({
			pinned: [],
			titles: {},
			modes: {
				"/p/a.jsonl": "work",
				"/p/b.jsonl": "project",
				"/p/c.jsonl": 7,
			},
		}), "utf8");
		expect(readMeta(dir).modes).toEqual({ "/p/a.jsonl": "work" });
		expect(getPiSessionMode(dir, "/p/b.jsonl")).toBe("chat");
	});

	it("includes mode in sidebar entries", () => {
		const entry = mapSessionInfoToEntry(info(), {
			pinned: [],
			titles: {},
			modes: { "/p/a.jsonl": "work" },
		});
		expect(entry.mode).toBe("work");
	});

	it("removes mode metadata when deleting a persisted session", () => {
		const sessionFile = join(dir, "a.jsonl");
		writeFileSync(sessionFile, "", "utf8");
		writeMeta(dir, {
			pinned: [sessionFile],
			titles: { [sessionFile]: "A" },
			modes: { [sessionFile]: "work" },
		});
		expect(deletePiSession(dir, sessionFile)).toBe(true);
		expect(readMeta(dir)).toEqual({ pinned: [], titles: {}, modes: {} });
	});
});
```

Add to `session-protocol.test.ts`:

```ts
it("accepts both durable session modes", () => {
	const modes: import("./session-protocol.js").SessionMode[] = ["chat", "work"];
	expect(modes).toEqual(["chat", "work"]);
});
```

- [ ] **Step 2: Run the sidecar tests and verify failure**

```bash
(cd agent-sidecar && pnpm test -- src/pi-session-store.test.ts src/session-protocol.test.ts)
```

Expected: TypeScript/test failures because `CoworkMeta.modes`, `SessionMode`, and mode helpers do not exist.

- [ ] **Step 3: Define the wire mode type**

In `session-protocol.ts` add:

```ts
export type SessionMode = "chat" | "work";
```

Change snapshot mode from:

```ts
mode: "chat";
```

to:

```ts
mode: SessionMode;
```

- [ ] **Step 4: Extend and validate Cowork metadata**

In `pi-session-store.ts`, import the type and extend the public shapes:

```ts
import type { SessionMode } from "./session-protocol.js";

// Add after CoworkSessionEntry.preview:
mode: SessionMode;

export interface CoworkMeta {
	pinned: string[];
	titles: Record<string, string>;
	/** Canonical absolute session path → durable product mode. */
	modes: Record<string, SessionMode>;
}

const EMPTY_META: CoworkMeta = { pinned: [], titles: {}, modes: {} };

function validModes(value: unknown): Record<string, SessionMode> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	return Object.fromEntries(
		Object.entries(value).filter(
			(entry): entry is [string, SessionMode] => entry[1] === "chat" || entry[1] === "work",
		),
	);
}
```

Return fresh copies from `readMeta()` and preserve valid mode entries:

```ts
if (!existsSync(p)) return { ...EMPTY_META, pinned: [], titles: {}, modes: {} };
// ...inside try:
return {
	pinned: Array.isArray(raw.pinned) ? raw.pinned : [],
	titles: raw.titles && typeof raw.titles === "object" ? raw.titles : {},
	modes: validModes(raw.modes),
};
// ...inside catch:
return { ...EMPTY_META, pinned: [], titles: {}, modes: {} };
```

Add:

```ts
export function getPiSessionMode(agentDir: string, path: string): SessionMode {
	return readMeta(agentDir).modes[path] ?? "chat";
}

export function setPiSessionMode(
	agentDir: string,
	path: string,
	mode: SessionMode,
): boolean {
	const meta = readMeta(agentDir);
	meta.modes[path] = mode;
	writeMeta(agentDir, meta);
	return true;
}
```

In `mapSessionInfoToEntry()` add:

```ts
mode: meta.modes[info.path] ?? "chat",
```

In `deletePiSession()`, prune mode beside titles and write the complete object:

```ts
const nextModes = { ...meta.modes };
delete nextModes[path];
writeMeta(agentDir, { pinned: nextPinned, titles: nextTitles, modes: nextModes });
```

Existing rename/pin functions already round-trip the complete `meta` object and need no parallel store.

- [ ] **Step 5: Run focused tests**

```bash
(cd agent-sidecar && pnpm test -- src/pi-session-store.test.ts src/session-protocol.test.ts)
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add agent-sidecar/src/session-protocol.ts \
  agent-sidecar/src/session-protocol.test.ts \
  agent-sidecar/src/pi-session-store.ts \
  agent-sidecar/src/pi-session-store.test.ts
git commit -m "feat(sidecar): persist chat and work session modes"
```

---

### Task 2: Guard Mode Mutation and Carry Mode Through Snapshots

**Files:**
- Modify: `agent-sidecar/src/session-protocol.ts`
- Modify: `agent-sidecar/src/session-protocol.test.ts`
- Modify: `agent-sidecar/src/session-runtime-manager.ts`
- Modify: `agent-sidecar/src/session-runtime-manager.test.ts`
- Modify: `agent-sidecar/src/commands/types.ts`
- Modify: `agent-sidecar/src/commands/handler-registry.ts`
- Modify: `agent-sidecar/src/commands/handlers/sessions.ts`
- Modify: `agent-sidecar/src/commands/handlers/sessions.test.ts`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add failing sidecar mode-handler tests**

In `sessions.test.ts`, add `getPiSessionMode`/`setPiSessionMode` mocks and import `handleSetSessionMode`:

```ts
// Add inside the existing hoisted mocks object:
getPiSessionMode: vi.fn(() => "chat" as "chat" | "work"),
setPiSessionMode: vi.fn(() => true),
```

Expose them from the `pi-session-store.js` mock, reset them in `beforeEach`, then add:

```ts
it("returns persisted mode in a loaded runtime snapshot", async () => {
	mocks.getPiSessionMode.mockReturnValue("work");
	await handleLoadSession(deps, {
		type: "load_session",
		id: "l-work",
		sessionFile: "/a.jsonl",
	});
	expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
		data: expect.objectContaining({ mode: "work" }),
	}));
});

it("changes mode while the runtime has no conversation", async () => {
	(runtimeManager as any).runtimes.set(runtimeA.sessionFile, runtimeA);
	await handleSetSessionMode(deps, {
		type: "set_session_mode",
		id: "sm-1",
		sessionFile: "/a.jsonl",
		mode: "work",
	});
	expect(mocks.setPiSessionMode).toHaveBeenCalledWith(
		expect.any(String),
		expect.stringContaining("a.jsonl"),
		"work",
	);
	expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
		type: "result",
		id: "sm-1",
		data: { success: true, mode: "work" },
	}));
});

it("rejects mode changes after the first user message", async () => {
	(runtimeManager as any).runtimes.set(runtimeA.sessionFile, runtimeA);
	(runtimeA.session.messages as unknown[]).push({ role: "user", content: "started" });
	await handleSetSessionMode(deps, {
		type: "set_session_mode",
		id: "sm-locked",
		sessionFile: "/a.jsonl",
		mode: "work",
	});
	expect(mocks.setPiSessionMode).not.toHaveBeenCalled();
	expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
		type: "error",
		code: "session_mode_locked",
		retryable: false,
	}));
});

it("rejects mode changes while first-prompt streaming has begun", async () => {
	(runtimeManager as any).runtimes.set(runtimeA.sessionFile, runtimeA);
	(runtimeA.session as unknown as { isStreaming: boolean }).isStreaming = true;
	await handleSetSessionMode(deps, {
		type: "set_session_mode",
		id: "sm-running",
		sessionFile: "/a.jsonl",
		mode: "work",
	});
	expect(mocks.setPiSessionMode).not.toHaveBeenCalled();
	expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
		code: "session_mode_locked",
	}));
});

it("rejects invalid mode input at the sidecar boundary", async () => {
	(runtimeManager as any).runtimes.set(runtimeA.sessionFile, runtimeA);
	await handleSetSessionMode(deps, {
		type: "set_session_mode",
		id: "sm-invalid",
		sessionFile: "/a.jsonl",
		mode: "project",
	} as never);
	expect(mocks.setPiSessionMode).not.toHaveBeenCalled();
	expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
		code: "invalid_session_mode",
		retryable: false,
	}));
});
```

In `session-runtime-manager.test.ts`, add `snapshotRuntime` to the existing import list, then add:

```ts
it("snapshots an explicit persisted mode without changing the default", () => {
	const runtime = fakeRuntime("/tmp/a.jsonl");
	expect(snapshotRuntime(runtime).mode).toBe("chat");
	expect(snapshotRuntime(runtime, "work").mode).toBe("work");
});
```

- [ ] **Step 2: Run focused tests and verify failure**

```bash
(cd agent-sidecar && pnpm test -- src/session-runtime-manager.test.ts src/commands/handlers/sessions.test.ts)
```

Expected: compilation/test failures because mode-aware snapshots and `handleSetSessionMode` do not exist.

- [ ] **Step 3: Add mode errors and explicit snapshot mode**

Extend `SessionErrorCode`:

```ts
| "invalid_session_mode"
| "session_mode_locked"
| "session_metadata_failed"
```

Freeze them in `session-protocol.test.ts`:

```ts
it.each([
	["invalid_session_mode", false],
	["session_mode_locked", false],
	["session_metadata_failed", true],
] as const)("serializes %s", (code, retryable) => {
	expect(makeSessionError("sm-1", "/a.jsonl", {
		code,
		message: code,
		retryable,
	})).toMatchObject({ code, retryable });
});
```

Import `SessionMode` beside existing protocol types. Change the function signature to:

```ts
export function snapshotRuntime(
	runtime: SessionRuntime,
	mode: SessionMode = "chat",
): SessionSnapshot {
```

Inside its existing returned object, replace `mode: "chat"` with:

```ts
mode,
```

Do not alter the existing cwd/messages/running/status/queue/model/error fields.

- [ ] **Step 4: Define and register `SetSessionModeCommand`**

In `commands/types.ts` add:

```ts
export interface SetSessionModeCommand extends SessionBoundCommand {
	type: "set_session_mode";
	id: string;
	mode: import("../session-protocol.js").SessionMode;
}
```

Add it to the `Command` union. In `handler-registry.ts`, import `handleSetSessionMode` and add:

```ts
case "set_session_mode":
	await handleSetSessionMode(deps, cmd as SetSessionModeCommand);
	break;
```

Import `SetSessionModeCommand` rather than casting to `any`.

- [ ] **Step 5: Implement guarded mode mutation and mode-aware loads**

In `sessions.ts`, import `getPiSessionMode`, `setPiSessionMode`, `SessionRuntimeError`, and `SetSessionModeCommand`.

Pass persisted mode only where a persisted session is loaded:

```ts
const mode = getPiSessionMode(piAgentDir(), runtime.sessionFile);
send(makeSessionResult(
	cmd.id,
	runtime.sessionFile,
	snapshotRuntime(runtime, mode),
));
```

New runtimes and the initial ready runtime keep the `snapshotRuntime(runtime)` Chat default. Add:

```ts
export async function handleSetSessionMode(
	deps: HandlerDependencies,
	cmd: SetSessionModeCommand,
): Promise<void> {
	if (cmd.mode !== "chat" && cmd.mode !== "work") {
		send(makeSessionError(cmd.id, cmd.sessionFile, {
			code: "invalid_session_mode",
			message: "Session mode must be chat or work",
			retryable: false,
		}));
		return;
	}

	let runtime: SessionRuntime;
	try {
		runtime = deps.runtimeManager.require(cmd.sessionFile);
	} catch (error) {
		const runtimeError = error as SessionRuntimeError;
		send(makeSessionError(cmd.id, cmd.sessionFile, {
			code: runtimeError.code ?? "session_not_loaded",
			message: runtimeError.message,
			retryable: runtimeError.retryable ?? true,
		}));
		return;
	}

	if (runtime.session.isStreaming || runtime.session.messages.length > 0) {
		send(makeSessionError(cmd.id, runtime.sessionFile, {
			code: "session_mode_locked",
			message: "Session mode is locked after the first prompt",
			retryable: false,
		}));
		return;
	}

	try {
		setPiSessionMode(piAgentDir(), runtime.sessionFile, cmd.mode);
		send(makeSessionResult(cmd.id, runtime.sessionFile, {
			success: true,
			mode: cmd.mode,
		}));
	} catch (error) {
		send(makeSessionError(cmd.id, runtime.sessionFile, {
			code: "session_metadata_failed",
			message: error instanceof Error ? error.message : String(error),
			retryable: true,
		}));
	}
}
```

Use explicit `SessionRuntime` type import. Keep the existing running-delete guard unchanged.

- [ ] **Step 6: Add a tested Tauri payload and command**

Add `build_set_session_mode_payload` to the Rust test module's existing `use super::{...}` list, then add:

```rust
#[test]
fn set_session_mode_payload_preserves_identity_and_mode() {
    assert_eq!(
        build_set_session_mode_payload("sm-1", "/sessions/a.jsonl", "work"),
        serde_json::json!({
            "type": "set_session_mode",
            "id": "sm-1",
            "sessionFile": "/sessions/a.jsonl",
            "mode": "work",
        })
    );
}
```

Run:

```bash
cargo test --workspace set_session_mode_payload -- --nocapture
```

Expected: compilation fails because the builder does not exist.

Add near the session command helpers:

```rust
fn build_set_session_mode_payload(id: &str, session_file: &str, mode: &str) -> Value {
    serde_json::json!({
        "type": "set_session_mode",
        "id": id,
        "sessionFile": session_file,
        "mode": mode,
    })
}

#[tauri::command]
async fn set_session_mode(
    session_file: String,
    mode: String,
    s: State<'_, AppState>,
) -> Result<Value, String> {
    let id = format!("sm-{}", uuid_v4());
    scmd_r(
        &s,
        &build_set_session_mode_payload(&id, &session_file, &mode),
        std::time::Duration::from_secs(10),
    )
    .await
}
```

Register `set_session_mode` beside `set_session_pinned` in `tauri::generate_handler!`.

- [ ] **Step 7: Run sidecar and relay gates**

```bash
(cd agent-sidecar && pnpm test -- src/pi-session-store.test.ts src/session-protocol.test.ts src/session-runtime-manager.test.ts src/commands/handlers/sessions.test.ts && pnpm build)
cargo fmt --check
cargo test --workspace set_session_mode_payload -- --nocapture
```

Expected: all commands pass.

- [ ] **Step 8: Commit**

```bash
git add agent-sidecar/src/session-protocol.ts \
  agent-sidecar/src/session-protocol.test.ts \
  agent-sidecar/src/session-runtime-manager.ts \
  agent-sidecar/src/session-runtime-manager.test.ts \
  agent-sidecar/src/commands/types.ts \
  agent-sidecar/src/commands/handler-registry.ts \
  agent-sidecar/src/commands/handlers/sessions.ts \
  agent-sidecar/src/commands/handlers/sessions.test.ts \
  src-tauri/src/lib.rs
git commit -m "feat: guard session mode before first prompt"
```

---

### Task 3: Store Mode in the Keyed Frontend Controller

**Files:**
- Modify: `src/types/session-runtime.ts`
- Modify: `src/hooks/usePiStream.ts`
- Modify: `src/hooks/usePiStream.test.ts`
- Modify: `src/hooks/usePiStream.session.test.ts`

- [ ] **Step 1: Add failing reducer tests**

In `src/types/session-runtime.ts`, tests will import `SessionMode` after implementation. In `usePiStream.session.test.ts`, generalize the snapshot helper:

```ts
function snapshot(
	sessionFile: string,
	content: string,
	mode: "chat" | "work" = "chat",
) {
	return {
		sessionFile,
		mode,
		cwd: `/work/${sessionFile.at(-6)}`,
		messages: [{ id: content, role: "assistant" as const, content, timestamp: 1 }],
		isRunning: false,
		status: "error" as const,
		queue: { steering: ["steer"], followUp: ["later"] },
		model: { provider: "test", id: "model", name: "Model" },
		error: { code: "provider_error", message: "failed", retryable: true },
	};
}
```

Add:

```ts
it("hydrates mode independently for each cached session", () => {
	const states = [
		{ type: "APPLY", sessionFile: "/a.jsonl", action: {
			type: "HYDRATE_SESSION",
			snapshot: snapshot("/a.jsonl", "A", "work"),
		} },
		{ type: "APPLY", sessionFile: "/b.jsonl", action: {
			type: "HYDRATE_SESSION",
			snapshot: snapshot("/b.jsonl", "B", "chat"),
		} },
	] satisfies SessionStreamsAction[];
	const result = states.reduce(sessionStreamsReducer, INITIAL_SESSION_STREAMS);
	expect(result.get("/a.jsonl")?.mode).toBe("work");
	expect(result.get("/b.jsonl")?.mode).toBe("chat");
});

it("changes mode only for the addressed cache entry", () => {
	const result = [
		{ type: "APPLY", sessionFile: "/a.jsonl", action: {
			type: "HYDRATE_SESSION",
			snapshot: snapshot("/a.jsonl", "", "chat"),
		} },
		{ type: "APPLY", sessionFile: "/b.jsonl", action: {
			type: "HYDRATE_SESSION",
			snapshot: snapshot("/b.jsonl", "", "chat"),
		} },
		{ type: "APPLY", sessionFile: "/a.jsonl", action: {
			type: "SET_SESSION_MODE",
			mode: "work",
		} },
	] satisfies SessionStreamsAction[];
	const states = result.reduce(sessionStreamsReducer, INITIAL_SESSION_STREAMS);
	expect(states.get("/a.jsonl")?.mode).toBe("work");
	expect(states.get("/b.jsonl")?.mode).toBe("chat");
});
```

- [ ] **Step 2: Run reducer tests and verify failure**

```bash
pnpm test -- src/hooks/usePiStream.session.test.ts
```

Expected: TypeScript fails because `StreamState.mode` and `SET_SESSION_MODE` do not exist.

- [ ] **Step 3: Add mode to frontend wire and reducer types**

In `src/types/session-runtime.ts` add:

```ts
export type SessionMode = "chat" | "work";
```

Change `SessionSnapshot.mode` to `SessionMode`.

In `usePiStream.ts`, import `SessionMode`, add this required field to `StreamState`:

```ts
/** Durable product mode; mutable only while the session is empty. */
mode: SessionMode;
```

Set `mode: "chat"` in `INITIAL_STATE`, add:

```ts
| { type: "SET_SESSION_MODE"; mode: SessionMode }
```

and reduce it with:

```ts
case "SET_SESSION_MODE":
	return { ...state, mode: action.mode };
```

In `HYDRATE_SESSION`, set:

```ts
mode: action.snapshot.mode,
```

No stream event changes mode. `SIDECAR_LOST` preserves it because that reducer already spreads existing keyed state.

- [ ] **Step 4: Add failing serialized-mutation hook tests**

Add to `usePiStream.session.test.ts`:

```ts
it("serializes rapid mode writes and keeps the latest selected mode", async () => {
	let releaseWork!: () => void;
	const workGate = new Promise<void>((resolve) => { releaseWork = resolve; });
	mocks.invoke.mockImplementation((command: string, args?: { mode?: string }) => {
		if (command === "set_session_mode" && args?.mode === "work") return workGate;
		return Promise.resolve(null);
	});
	const { result } = renderHook(() => usePiStream("/a.jsonl"));
	act(() => result.current.hydrateSession(snapshot("/a.jsonl", "", "chat")));

	let work!: Promise<void>;
	let chat!: Promise<void>;
	act(() => {
		work = result.current.setSessionMode("/a.jsonl", "work");
		chat = result.current.setSessionMode("/a.jsonl", "chat");
	});
	await waitFor(() => expect(result.current.states.get("/a.jsonl")?.mode).toBe("chat"));
	expect(mocks.invoke.mock.calls.filter(([name]) => name === "set_session_mode")).toHaveLength(1);
	releaseWork();
	await act(async () => Promise.all([work, chat]));
	const writes = mocks.invoke.mock.calls.filter(([name]) => name === "set_session_mode");
	expect(writes.map(([, args]) => args.mode)).toEqual(["work", "chat"]);
	expect(result.current.states.get("/a.jsonl")?.mode).toBe("chat");
});

it("rolls back the latest failed mode mutation", async () => {
	mocks.invoke.mockImplementation((command: string) =>
		command === "set_session_mode"
			? Promise.reject(new Error("metadata unavailable"))
			: Promise.resolve(null),
	);
	const { result } = renderHook(() => usePiStream("/a.jsonl"));
	act(() => result.current.hydrateSession(snapshot("/a.jsonl", "", "chat")));
	await act(async () => {
		await expect(result.current.setSessionMode("/a.jsonl", "work"))
			.rejects.toThrow("metadata unavailable");
	});
	expect(result.current.states.get("/a.jsonl")?.mode).toBe("chat");
});

it("reloads an interrupted empty runtime before persisting its mode", async () => {
	mocks.invoke.mockImplementation((command: string, args?: { sessionFile?: string }) =>
		command === "load_session"
			? Promise.resolve(snapshot(args?.sessionFile ?? "/a.jsonl", "", "chat"))
			: Promise.resolve(null),
	);
	const { result } = renderHook(() => usePiStream("/a.jsonl"));
	await waitFor(() => expect(mocks.listeners.has("sidecar_lost")).toBe(true));
	act(() => result.current.hydrateSession(snapshot("/a.jsonl", "", "chat")));
	act(() => mocks.listeners.get("sidecar_lost")?.({ payload: null }));
	await act(async () => result.current.setSessionMode("/a.jsonl", "work"));
	const loadOrder = mocks.invoke.mock.invocationCallOrder[
		mocks.invoke.mock.calls.findIndex(([name]) => name === "load_session")
	];
	const modeOrder = mocks.invoke.mock.invocationCallOrder[
		mocks.invoke.mock.calls.findIndex(([name]) => name === "set_session_mode")
	];
	expect(loadOrder).toBeLessThan(modeOrder);
});
```

- [ ] **Step 5: Implement serialized, rollback-safe mode writes**

Near existing refs in `usePiStream`, add:

```ts
const modeRef = useRef(new Map<string, SessionMode>());
const modeVersionRef = useRef(new Map<string, number>());
const modeSavesRef = useRef(new Map<string, Promise<void>>());
```

In `hydrateSession()` add before dispatch:

```ts
modeRef.current.set(snapshot.sessionFile, snapshot.mode);
```

Add after `setSessionModel`:

```ts
const setSessionMode = useCallback(async (
	sessionFile: string,
	mode: SessionMode,
): Promise<void> => {
	await ensureSession(sessionFile);
	if (deletedRef.current.has(sessionFile)) throw new Error("Session was deleted");

	const previous = modeRef.current.get(sessionFile) ?? "chat";
	const version = (modeVersionRef.current.get(sessionFile) ?? 0) + 1;
	modeVersionRef.current.set(sessionFile, version);
	modeRef.current.set(sessionFile, mode);
	dispatchTo(sessionFile, { type: "SET_SESSION_MODE", mode });

	const prior = modeSavesRef.current.get(sessionFile) ?? Promise.resolve();
	const save = prior
		.catch(() => undefined)
		.then(async () => {
			await invoke("set_session_mode", { sessionFile, mode });
		});
	modeSavesRef.current.set(sessionFile, save);

	try {
		await save;
	} catch (error) {
		// Ignore a deleted/superseded failure: the later mutation or tombstone
		// determines truth. Never let rollback recreate a removed cache entry.
		if (
			deletedRef.current.has(sessionFile) ||
			modeVersionRef.current.get(sessionFile) !== version
		) return;
		modeRef.current.set(sessionFile, previous);
		dispatchTo(sessionFile, { type: "SET_SESSION_MODE", mode: previous });
		throw error;
	} finally {
		if (modeSavesRef.current.get(sessionFile) === save) {
			modeSavesRef.current.delete(sessionFile);
		}
	}
}, [dispatchTo, ensureSession]);
```

In `removeSession()` clear all three mode maps for that file before dispatching removal. Add this hook test to freeze the tombstone rule:

```ts
it("a failed mode save cannot resurrect a deleted session", async () => {
	let rejectSave!: (error: Error) => void;
	mocks.invoke.mockImplementation((command: string) =>
		command === "set_session_mode"
			? new Promise<void>((_, reject) => { rejectSave = reject; })
			: Promise.resolve(null),
	);
	const { result } = renderHook(() => usePiStream("/a.jsonl"));
	act(() => result.current.hydrateSession(snapshot("/a.jsonl", "", "chat")));
	let saving!: Promise<void>;
	act(() => { saving = result.current.setSessionMode("/a.jsonl", "work"); });
	await waitFor(() => expect(result.current.states.get("/a.jsonl")?.mode).toBe("work"));
	act(() => result.current.removeSession("/a.jsonl"));
	rejectSave(new Error("late failure"));
	await act(async () => saving);
	expect(result.current.states.has("/a.jsonl")).toBe(false);
});
``` Return `setSessionMode` from the hook. Delete the unused compatibility `dispatch` return only after `rg "\.dispatch|dispatch:" src/App.tsx src/**/*.test.tsx` proves no production caller remains; update the two App test mocks accordingly.

- [ ] **Step 6: Run controller tests and typecheck**

```bash
pnpm test -- src/hooks/usePiStream.test.ts src/hooks/usePiStream.session.test.ts
pnpm run typecheck
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/types/session-runtime.ts src/hooks/usePiStream.ts \
  src/hooks/usePiStream.test.ts src/hooks/usePiStream.session.test.ts
git commit -m "feat(frontend): store durable mode per session"
```

---

### Task 4: Lock Mode in the First-Send Transaction

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.sessions.test.tsx`
- Modify: `src/App.telemetry.test.tsx`
- Modify: `src/chat/ChatView.tsx` (mode-shell prop contract only; Task 5 renders it)

- [ ] **Step 1: Extend the App test harness for mode**

Add `setSessionMode: vi.fn()` to the hoisted controller and mocked `usePiStream` return. Make `streamState` accept `mode?: "chat" | "work"`, default it to Chat, and include it in the returned object.

Replace the `ChatView` double with:

```tsx
vi.mock("@/chat/ChatView", () => ({
	ChatView: ({
		messages,
		currentModelId,
		mode,
		onModeChange,
		onSend,
		onStarterSelect,
		modeChangeDisabled,
		modeError,
		draft,
	}: {
		messages: Array<{ content: string }>;
		currentModelId?: string;
		mode: "chat" | "work";
		onModeChange: (mode: "chat" | "work") => void;
		onSend: (text: string) => void;
		onStarterSelect: (text: string) => void;
		modeChangeDisabled?: boolean;
		modeError?: string | null;
		draft?: { text: string; nonce: number };
	}) => (
		<div>
			{modeError && <div>{modeError}</div>}
			<div data-testid="chat-state">
				{messages.map((message) => message.content).join("|")}:{currentModelId}:{mode}
			</div>
			<div data-testid="composer-draft">{draft?.text ?? ""}</div>
			<button type="button" disabled={modeChangeDisabled} onClick={() => onModeChange("work")}>choose-work</button>
			<button type="button" onClick={() => onStarterSelect("Help me write")}>choose-starter</button>
			<button type="button" onClick={() => onSend("first task")}>send-first</button>
		</div>
	),
}));
```

Extend the Sidebar double props and body with:

```tsx
collapsed?: boolean;
onCollapsedChange?: (collapsed: boolean) => void;
```

```tsx
<span>{`sidebar:${collapsed ? "collapsed" : "expanded"}`}</span>
<button type="button" onClick={() => onCollapsedChange?.(false)}>expand-sidebar</button>
```

Keep its existing session/select/new/delete controls unchanged.

In `beforeEach`, reset `controller.setSessionMode` and implement it:

```ts
controller.setSessionMode.mockImplementation(async (file: string, mode: "chat" | "work") => {
	const current = controller.states.get(file);
	if (current) controller.states = new Map(controller.states).set(file, { ...current, mode });
});
```

- [ ] **Step 2: Add failing App behavior tests**

Add:

```ts
it("persists Work before dispatching the first prompt", async () => {
	controller.states = new Map([
		["/a.jsonl", { ...streamState("/a.jsonl", "", { mode: "work" }), messages: [] }],
	]);
	controller.entries = [
		{ file: "/a.jsonl", title: "A", messageCount: 0, createdAt: 1, lastActivity: 2, mode: "work" },
	];
	render(<App />);
	await screen.findByRole("button", { name: "select /a.jsonl" });
	fireEvent.click(screen.getByRole("button", { name: "select /a.jsonl" }));
	fireEvent.click(screen.getByText("send-first"));
	await waitFor(() => expect(controller.startStream).toHaveBeenCalledWith("/a.jsonl", "first task"));
	expect(controller.setSessionMode).toHaveBeenCalledWith("/a.jsonl", "work");
	expect(controller.setSessionMode.mock.invocationCallOrder[0]).toBeLessThan(
		controller.startStream.mock.invocationCallOrder[0],
	);
});

it("does not start the first prompt when mode persistence fails", async () => {
	controller.states = new Map([
		["/a.jsonl", { ...streamState("/a.jsonl", "", { mode: "work" }), messages: [] }],
	]);
	controller.entries = [
		{ file: "/a.jsonl", title: "A", messageCount: 0, createdAt: 1, lastActivity: 2, mode: "work" },
	];
	controller.setSessionMode.mockRejectedValueOnce(new Error("metadata unavailable"));
	render(<App />);
	await screen.findByRole("button", { name: "select /a.jsonl" });
	fireEvent.click(screen.getByRole("button", { name: "select /a.jsonl" }));
	fireEvent.click(screen.getByText("send-first"));
	await screen.findByText("Couldn’t save this session’s mode. Try again.");
	expect(controller.startStream).not.toHaveBeenCalled();
});

it("defaults legacy active sessions to chat", async () => {
	controller.states = new Map([
		["/legacy.jsonl", streamState("/legacy.jsonl", "history", { mode: "chat" })],
	]);
	controller.entries = [
		{ file: "/legacy.jsonl", title: "Legacy", messageCount: 1, createdAt: 1, lastActivity: 2 },
	];
	render(<App />);
	await screen.findByRole("button", { name: "select /legacy.jsonl" });
	fireEvent.click(screen.getByRole("button", { name: "select /legacy.jsonl" }));
	await waitFor(() => expect(screen.getByTestId("chat-state")).toHaveTextContent(":chat"));
});

it("carries an unbound Work choice into the canonical session created on send", async () => {
	controller.newSnapshot = {
		sessionFile: "/new.jsonl",
		mode: "chat",
		cwd: "/work/new",
		messages: [],
		isRunning: false,
		status: "idle",
		queue: { steering: [], followUp: [] },
	};
	render(<App />);
	fireEvent.click(screen.getByText("choose-work"));
	fireEvent.click(screen.getByText("send-first"));
	await waitFor(() => expect(controller.startStream).toHaveBeenCalledWith("/new.jsonl", "first task"));
	expect(controller.setSessionMode).toHaveBeenCalledWith("/new.jsonl", "work");
});

it("collapses only empty Chat by default and allows one-action expansion", async () => {
	controller.states = new Map([
		["/chat.jsonl", { ...streamState("/chat.jsonl", "", { mode: "chat" }), messages: [] }],
		["/work.jsonl", { ...streamState("/work.jsonl", "", { mode: "work" }), messages: [] }],
	]);
	controller.entries = [
		{ file: "/chat.jsonl", title: "Chat", messageCount: 0, createdAt: 1, lastActivity: 2, mode: "chat" },
		{ file: "/work.jsonl", title: "Work", messageCount: 0, createdAt: 1, lastActivity: 2, mode: "work" },
	];
	render(<App />);
	await screen.findByRole("button", { name: "select /chat.jsonl" });
	fireEvent.click(screen.getByRole("button", { name: "select /chat.jsonl" }));
	await screen.findByText("sidebar:collapsed");
	fireEvent.click(screen.getByText("expand-sidebar"));
	expect(screen.getByText("sidebar:expanded")).toBeInTheDocument();
	fireEvent.click(screen.getByRole("button", { name: "select /work.jsonl" }));
	await screen.findByText("sidebar:expanded");
});

it("targets starter drafts to one session so they do not bleed on switch", async () => {
	controller.states = new Map([
		["/a.jsonl", { ...streamState("/a.jsonl", "", { mode: "chat" }), messages: [] }],
		["/b.jsonl", { ...streamState("/b.jsonl", "", { mode: "chat" }), messages: [] }],
	]);
	controller.entries = [
		{ file: "/a.jsonl", title: "A", messageCount: 0, createdAt: 1, lastActivity: 2 },
		{ file: "/b.jsonl", title: "B", messageCount: 0, createdAt: 1, lastActivity: 2 },
	];
	render(<App />);
	await screen.findByRole("button", { name: "select /a.jsonl" });
	fireEvent.click(screen.getByRole("button", { name: "select /a.jsonl" }));
	fireEvent.click(screen.getByText("choose-starter"));
	expect(screen.getByTestId("composer-draft")).toHaveTextContent("Help me write");
	fireEvent.click(screen.getByRole("button", { name: "select /b.jsonl" }));
	expect(screen.getByTestId("composer-draft")).toBeEmptyDOMElement();
});
```

- [ ] **Step 3: Run App tests and verify failure**

```bash
pnpm test -- src/App.sessions.test.tsx src/App.telemetry.test.tsx
```

Expected: failures because App does not expose mode, order mode persistence, target drafts, or derive sidebar defaults.

- [ ] **Step 4: Add mode ownership and targeted draft state**

Import `SessionMode`. Extend `SessionEntry` with:

```ts
mode?: SessionMode;
```

Destructure `setSessionMode` from `usePiStream`. Replace composer draft with:

```ts
interface ComposerDraft {
	sessionFile: string;
	text: string;
	nonce: number;
}

const [composerDraft, setComposerDraft] = useState<ComposerDraft>();
const draftSessionKey = activeSessionFile ?? "__new__";
```

Both queue editing and starter selection write `sessionFile: draftSessionKey`. Pass a draft only to its owner:

```tsx
draft={composerDraft?.sessionFile === draftSessionKey ? composerDraft : undefined}
```

This fixes the existing cross-session draft remount leak while adding starters.

Keep one fallback only for the rare render before a canonical session snapshot exists (for example remote/browser startup), then derive loaded-session mode from keyed state:

```ts
const [unboundMode, setUnboundMode] = useState<SessionMode>("chat");
const activeMode: SessionMode = activeSessionFile ? streamState.mode : unboundMode;
const selectedModeRef = useRef<SessionMode>(activeMode);
useEffect(() => {
	selectedModeRef.current = activeMode;
}, [activeSessionFile, activeMode]);
const isEmptySession =
	streamState.messages.length === 0 &&
	streamState.streamingMessage === null &&
	!streamState.isRunning;
const [firstSendPending, setFirstSendPending] = useState(false);
const modeLocked = !isEmptySession || firstSendPending;
const [modeError, setModeError] = useState<string | null>(null);
```

Clear `modeError` when `activeSessionFile` changes. `unboundMode` is not a second store for loaded sessions: it exists only until `new_session` returns canonical identity.

- [ ] **Step 5: Implement mode change and first-send ordering**

Add:

```ts
const handleModeChange = useCallback(async (mode: SessionMode) => {
	if (modeLocked) return;
	// Synchronous ref closes the click→immediate-Enter gap before the keyed
	// reducer rerender lands. First send always uses the visibly chosen mode.
	selectedModeRef.current = mode;
	setModeError(null);
	if (!activeSessionFile) {
		setUnboundMode(mode);
		return;
	}
	try {
		await setSessionMode(activeSessionFile, mode);
	} catch (error) {
		log.error("[cowork] set_session_mode failed:", error);
		setModeError("Couldn’t save this session’s mode. Try again.");
	}
}, [activeSessionFile, modeLocked, setSessionMode]);
```

At the start of `handleSend`, capture the selected mode before creating any fallback session:

```ts
const selectedMode = selectedModeRef.current;
```

After a canonical `sessionFile` exists, but before sidebar optimistic metadata and before `startStream`, add:

```ts
const firstPrompt = isNewSession || streamState.messages.length === 0;
if (firstPrompt) {
	// Lock tabs + composer immediately. Otherwise a second mode click can queue
	// behind this save and race the prompt command that follows it.
	setFirstSendPending(true);
	setModeError(null);
	try {
		await setSessionMode(sessionFile, selectedMode);
	} catch (error) {
		log.error("[cowork] first-prompt mode save failed:", error);
		setModeError("Couldn’t save this session’s mode. Try again.");
		setFirstSendPending(false);
		return;
	}
}
```

Include `mode: selectedMode` on the optimistic `SessionEntry`. Keep `startStream(sessionFile, text)` after this block, then release the pending lock:

```ts
try {
	await startStream(sessionFile, text);
} catch (error) {
	log.error("[cowork] first prompt failed before stream start:", error);
	setModeError("Couldn’t start this session. Try again.");
} finally {
	if (firstPrompt) setFirstSendPending(false);
}
```

`startStream` dispatches its optimistic user message before its Tauri write resolves, so the normal next render hides the switch as permanently locked. The catch covers its pre-dispatch `ensureSession` rejection path and prevents a permanently disabled empty session. Update `handleSend` dependencies to include `setSessionMode` and `streamState.messages.length`; refs and state setters stay stable.

Add these App tests to freeze the click→immediate-send ref guard and pending-state release:

```ts
it("uses the clicked mode when send happens before its reducer rerender", async () => {
	controller.states = new Map([
		["/a.jsonl", { ...streamState("/a.jsonl", "", { mode: "chat" }), messages: [] }],
	]);
	controller.entries = [
		{ file: "/a.jsonl", title: "A", messageCount: 0, createdAt: 1, lastActivity: 2, mode: "chat" },
	];
	let release!: () => void;
	controller.setSessionMode
		.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }))
		.mockResolvedValueOnce(undefined);
	render(<App />);
	await screen.findByRole("button", { name: "select /a.jsonl" });
	fireEvent.click(screen.getByRole("button", { name: "select /a.jsonl" }));
	fireEvent.click(screen.getByText("choose-work"));
	fireEvent.click(screen.getByText("send-first"));
	expect(controller.setSessionMode.mock.calls.map(([, mode]) => mode)).toEqual(["work", "work"]);
	release();
	await waitFor(() => expect(controller.startStream).toHaveBeenCalledWith("/a.jsonl", "first task"));
});

it("re-enables empty mode controls when first stream startup rejects", async () => {
	controller.states = new Map([
		["/a.jsonl", { ...streamState("/a.jsonl", "", { mode: "work" }), messages: [] }],
	]);
	controller.entries = [
		{ file: "/a.jsonl", title: "A", messageCount: 0, createdAt: 1, lastActivity: 2, mode: "work" },
	];
	controller.startStream.mockRejectedValueOnce(new Error("runtime lost"));
	render(<App />);
	await screen.findByRole("button", { name: "select /a.jsonl" });
	fireEvent.click(screen.getByRole("button", { name: "select /a.jsonl" }));
	fireEvent.click(screen.getByText("send-first"));
	await screen.findByText("Couldn’t start this session. Try again.");
	expect(screen.getByText("choose-work")).toBeEnabled();
});
``` This ordering is the lock transaction: backend mode mutation sees an empty runtime; then `START_STREAM` adds the optimistic first user message and both frontend/backend reject later mode changes.

- [ ] **Step 6: Derive sidebar mode and empty defaults**

Add mode to each sidebar row:

```ts
mode: live?.mode ?? s.mode ?? "chat",
```

Add this effect:

```ts
useEffect(() => {
	// Default per entered view. A manual expand/collapse does not retrigger until
	// the user enters a different session/mode/empty state.
	setSidebarCollapsed(isEmptySession && activeMode === "chat");
}, [activeSessionFile, activeMode, isEmptySession]);
```

Empty Chat starts collapsed; Empty Work and every active transcript start expanded. Manual collapse/expand remains available afterward.

Pass these props to `ChatView` for Task 5:

```tsx
mode={activeMode}
modeChangeDisabled={firstSendPending}
modeError={modeError}
onModeChange={(mode) => void handleModeChange(mode)}
workspaceCwd={workspaceCwd}
onStarterSelect={(text) => {
	setComposerDraft((previous) => ({
		sessionFile: draftSessionKey,
		text,
		nonce: (previous?.nonce ?? 0) + 1,
	}));
}}
```

- [ ] **Step 7: Add the temporary-compatible ChatView mode contract and update mocks**

Before Task 5 renders the controls, import `SessionMode` from `@/types/session-runtime` and extend `ChatViewProps` with optional mode-shell fields so this App commit remains type-safe and the existing Chat view remains usable:

```ts
mode?: SessionMode;
modeChangeDisabled?: boolean;
modeError?: string | null;
onModeChange?: (mode: SessionMode) => void;
workspaceCwd?: string | null;
onStarterSelect?: (text: string) => void;
```

Task 5 defaults `mode` to Chat and supplies no-op-safe rendering for direct test/component callers; production App always passes all behavior-bearing fields. Then use:

```bash
rg -n "usePiStream|SessionSnapshot|mode: \"chat\"" src --glob '*.test.tsx' --glob '*.test.ts'
```

Update `App.telemetry.test.tsx` and every affected fixture with `mode: "chat"` and `setSessionMode: vi.fn()`. Do not weaken existing startup/telemetry assertions.

- [ ] **Step 8: Run App tests**

```bash
pnpm test -- src/App.sessions.test.tsx src/App.telemetry.test.tsx
pnpm run typecheck
```

Expected: tests pass. App owns correct mode and ordering now; Task 5 turns the optional-compatible ChatView fields into visible controls without duplicating state.

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx src/App.sessions.test.tsx src/App.telemetry.test.tsx src/chat/ChatView.tsx
git commit -m "feat(frontend): lock session mode on first send"
```

---

### Task 5: Add Accessible Chat and Work Empty States

**Files:**
- Create: `src/components/SessionModeSwitcher.tsx`
- Create: `src/components/SessionEmptyState.tsx`
- Create: `src/components/SessionEmptyState.test.tsx`
- Modify: `src/chat/ChatView.tsx`
- Modify: `src/chat/ChatView.test.tsx`
- Modify: `src/components/MessageInput.tsx`
- Modify: `src/components/MessageInput.test.tsx`

- [ ] **Step 1: Add failing empty-state component tests**

Create `SessionEmptyState.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionEmptyIntro, SessionStarterPrompts } from "./SessionEmptyState";

it("renders the conversational Chat hierarchy", () => {
	render(<SessionEmptyIntro mode="chat" onModeChange={vi.fn()} />);
	expect(screen.getByRole("heading", { name: "What’s on your mind today?" })).toBeInTheDocument();
	expect(screen.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
});

it("renders the task-oriented Work hierarchy and workspace", () => {
	render(
		<>
			<SessionEmptyIntro mode="work" onModeChange={vi.fn()} />
			<SessionStarterPrompts mode="work" workspaceCwd="/work/acme" onSelect={vi.fn()} />
		</>,
	);
	expect(screen.getByRole("heading", { name: "What should we work on?" })).toBeInTheDocument();
	expect(screen.getByText("/work/acme")).toBeInTheDocument();
	expect(screen.getByRole("tab", { name: "Work" })).toHaveAttribute("aria-selected", "true");
});

it("supports arrow-key tab selection", () => {
	const onModeChange = vi.fn();
	render(<SessionEmptyIntro mode="chat" onModeChange={onModeChange} />);
	fireEvent.keyDown(screen.getByRole("tab", { name: "Chat" }), { key: "ArrowRight" });
	expect(onModeChange).toHaveBeenCalledWith("work");
	expect(screen.getByRole("tab", { name: "Work" })).toHaveFocus();
});

it("starter prompts fill through onSelect and never send", () => {
	const onSelect = vi.fn();
	render(<SessionStarterPrompts mode="chat" onSelect={onSelect} />);
	fireEvent.click(screen.getByRole("button", { name: "Help me write" }));
	expect(onSelect).toHaveBeenCalledWith("Help me write");
});

it("disables mode tabs while first-send mode commit is pending", () => {
	render(<SessionEmptyIntro mode="work" onModeChange={vi.fn()} disabled />);
	expect(screen.getByRole("tab", { name: "Chat" })).toBeDisabled();
	expect(screen.getByRole("tab", { name: "Work" })).toBeDisabled();
});

it("shows an inline mode-save error", () => {
	render(
		<SessionEmptyIntro
			mode="chat"
			onModeChange={vi.fn()}
			error="Couldn’t save this session’s mode. Try again."
		/>,
	);
	expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t save this session’s mode");
});
```

- [ ] **Step 2: Add failing ChatView/MessageInput tests**

In `ChatView.test.tsx`, add:

```tsx
describe("ChatView mode-specific empty shell", () => {
	const emptyProps = {
		messages: [],
		streamingMessage: null,
		isRunning: false,
		error: null,
		onSend: vi.fn(),
		onAbort: vi.fn(),
	};

	it("shows only Empty Chat controls before the first prompt", () => {
		render(<ChatView sessionFile="/a.jsonl" {...emptyProps} mode="chat" onModeChange={vi.fn()} />);
		expect(screen.getByText("What’s on your mind today?")).toBeInTheDocument();
		expect(screen.queryByText("What should we work on?")).not.toBeInTheDocument();
		expect(screen.getByPlaceholderText("Ask Zosma…")).toBeInTheDocument();
	});

	it("shows Empty Work with a multiline task composer and workspace", () => {
		render(
			<ChatView
				sessionFile="/a.jsonl"
				{...emptyProps}
				mode="work"
				workspaceCwd="/work/acme"
				onModeChange={vi.fn()}
			/>,
		);
		expect(screen.getByText("What should we work on?")).toBeInTheDocument();
		const input = screen.getByPlaceholderText("Work on anything…");
		expect(input).toHaveAttribute("rows", "3");
		expect(screen.getByText("/work/acme")).toBeInTheDocument();
	});

	it("hides the mode switch and empty starters after conversation starts", () => {
		render(
			<ChatView
				sessionFile="/a.jsonl"
				{...emptyProps}
				mode="work"
				messages={[{ id: "u", role: "user", content: "Run it", timestamp: 1 }]}
				onModeChange={vi.fn()}
			/>,
		);
		expect(screen.queryByRole("tablist", { name: "Session mode" })).not.toBeInTheDocument();
		expect(screen.queryByText("Research and produce a report")).not.toBeInTheDocument();
	});
});
```

In `MessageInput.test.tsx`, add:

```tsx
it("uses the compact Chat empty composer", () => {
	render(<MessageInput sessionFile="/a.jsonl" onSend={vi.fn()} emptyMode="chat" />);
	expect(screen.getByPlaceholderText("Ask Zosma…")).toHaveAttribute("rows", "1");
});

it("uses the larger multiline Work empty composer", () => {
	render(<MessageInput sessionFile="/a.jsonl" onSend={vi.fn()} emptyMode="work" />);
	const input = screen.getByPlaceholderText("Work on anything…");
	expect(input).toHaveAttribute("rows", "3");
	expect(input.className).toContain("min-h-24");
});
```

- [ ] **Step 3: Run focused tests and verify failure**

```bash
pnpm test -- src/components/SessionEmptyState.test.tsx src/chat/ChatView.test.tsx src/components/MessageInput.test.tsx
```

Expected: module/prop/query failures because mode components and composer variants do not exist.

- [ ] **Step 4: Implement the accessible mode switcher**

Create `SessionModeSwitcher.tsx`:

```tsx
import type { SessionMode } from "@/types/session-runtime";
import type { KeyboardEvent } from "react";

interface Props {
	mode: SessionMode;
	onChange: (mode: SessionMode) => void;
	disabled?: boolean;
}

const MODES: SessionMode[] = ["chat", "work"];

export function SessionModeSwitcher({ mode, onChange, disabled }: Props) {
	function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
		if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
		event.preventDefault();
		const next = event.key === "ArrowRight"
			? MODES[(MODES.indexOf(mode) + 1) % MODES.length]
			: MODES[(MODES.indexOf(mode) - 1 + MODES.length) % MODES.length];
		onChange(next);
		event.currentTarget.parentElement
			?.querySelector<HTMLButtonElement>(`[data-session-mode="${next}"]`)
			?.focus();
	}

	return (
		<div
			role="tablist"
			aria-label="Session mode"
			className="inline-flex rounded-full border border-border bg-muted/60 p-1"
		>
			{MODES.map((item) => (
				<button
					key={item}
					type="button"
					role="tab"
					aria-selected={mode === item}
					data-session-mode={item}
					tabIndex={mode === item ? 0 : -1}
					disabled={disabled}
					onKeyDown={onKeyDown}
					onClick={() => onChange(item)}
					className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
						mode === item
							? "bg-background text-foreground shadow-sm"
							: "text-muted-foreground hover:text-foreground"
					}`}
				>
					{item === "chat" ? "Chat" : "Work"}
				</button>
			))}
		</div>
	);
}
```

- [ ] **Step 5: Implement deterministic empty-state content**

Create `SessionEmptyState.tsx`:

```tsx
import type { SessionMode } from "@/types/session-runtime";
import { FolderOpen, MessageCircle, PenLine, Search, Sparkles } from "lucide-react";
import { SessionModeSwitcher } from "./SessionModeSwitcher";

const STARTERS: Record<SessionMode, Array<{ label: string; icon: typeof Sparkles }>> = {
	chat: [
		{ label: "Explain or explore something", icon: MessageCircle },
		{ label: "Help me write", icon: PenLine },
	],
	work: [
		{ label: "Research and produce a report", icon: Search },
		{ label: "Create or improve a document", icon: PenLine },
	],
};

export function SessionEmptyIntro({
	mode,
	onModeChange,
	disabled,
	error,
}: {
	mode: SessionMode;
	onModeChange: (mode: SessionMode) => void;
	disabled?: boolean;
	error?: string | null;
}) {
	return (
		<div className="flex flex-col items-center gap-5 px-6 text-center">
			<SessionModeSwitcher mode={mode} onChange={onModeChange} disabled={disabled} />
			<h1 className="session-empty-heading font-semibold leading-tight tracking-[-0.02em] text-foreground">
				{mode === "chat" ? "What’s on your mind today?" : "What should we work on?"}
			</h1>
			{error && <p role="alert" className="text-[13px] text-destructive">{error}</p>}
		</div>
	);
}

export function SessionStarterPrompts({
	mode,
	workspaceCwd,
	onSelect,
}: {
	mode: SessionMode;
	workspaceCwd?: string | null;
	onSelect: (text: string) => void;
}) {
	return (
		<div className="flex w-full max-w-2xl flex-col items-center gap-3 px-6">
			<div className="flex flex-wrap justify-center gap-2">
				{STARTERS[mode].map(({ label, icon: Icon }) => (
					<button
						key={label}
						type="button"
						onClick={() => onSelect(label)}
						className="inline-flex items-center gap-2 rounded-full border border-border bg-background/60 px-4 py-2 text-sm text-foreground/80 transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<Icon className="h-4 w-4 text-primary" aria-hidden />
						{label}
					</button>
				))}
			</div>
			{mode === "work" && workspaceCwd && (
				<div className="flex max-w-full items-center gap-2 text-[13px] text-muted-foreground">
					<FolderOpen className="h-4 w-4 shrink-0" aria-hidden />
					<span>Workspace</span>
					<span className="truncate font-mono text-foreground/70" title={workspaceCwd}>{workspaceCwd}</span>
				</div>
			)}
		</div>
	);
}
```

Content is deterministic; do not call a model for empty-state copy.

- [ ] **Step 6: Add MessageInput empty variants without duplicating behavior**

Add:

```ts
emptyMode?: SessionMode;
```

Import `SessionMode`. Derive placeholders with existing streaming precedence:

```ts
const placeholder = disabled
	? "Not ready..."
	: streaming
		? queueCount > 0
			? `Steer with Enter · Alt+Enter for follow-up · ${queueCount} queued (Ctrl+↑ to edit)`
			: "Steer with Enter · Alt+Enter to queue follow-up"
		: emptyMode === "work"
			? "Work on anything…"
			: emptyMode === "chat"
				? "Ask Zosma…"
				: "Message (Enter to send, Shift+Enter for newline)";
```

Use:

```tsx
rows={emptyMode === "work" ? 3 : 1}
className={`session-composer w-full resize-none bg-transparent px-4 pt-3 pb-2 leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50 ${
	emptyMode === "work" ? "min-h-24" : ""
}`}
```

Change the form max width by class, not a second input:

```tsx
className={`px-4 pb-2 mx-auto w-full ${
	emptyMode === "chat" ? "max-w-[700px]" : emptyMode === "work" ? "max-w-[780px]" : "max-w-[852px]"
}`}
```

Remove the inline max-width style. All attachment, voice, mention, model, slash-command, steer, follow-up, queue, and paste code remains one shared path.

- [ ] **Step 7: Integrate empty regions around the persistent composer**

Complete the optional-compatible `ChatViewProps` contract introduced by Task 4:

```ts
mode?: SessionMode;
modeChangeDisabled?: boolean;
modeError?: string | null;
onModeChange?: (mode: SessionMode) => void;
workspaceCwd?: string | null;
onStarterSelect?: (text: string) => void;
```

Default `mode = "chat"`, `modeChangeDisabled = false`, and define one module-level `const NOOP_MODE_CHANGE = () => {};` for direct legacy/test renderers; production App always passes real mode and handler. Add `session-shell` and `data-session-mode={mode}` to the existing root.

Make the existing scroll container a flex column only while empty so its intro can occupy the upper balancing region:

```tsx
className={`flex-1 overflow-y-auto relative ${isEmpty ? "flex flex-col" : ""}`}
```

Then, before message rendering, add:

```tsx
{isEmpty && (
	<div className="flex flex-1 items-end justify-center pb-5">
		<SessionEmptyIntro
			mode={mode}
			onModeChange={onModeChange ?? NOOP_MODE_CHANGE}
			disabled={modeChangeDisabled}
			error={modeError}
		/>
	</div>
)}
```

Keep the existing `motion.div`/`MessageInput` at the same sibling position. Pass:

```tsx
emptyMode={isEmpty ? mode : undefined}
disabled={modeChangeDisabled}
```

Replace the old bare bottom spacer with:

```tsx
{isEmpty && (
	<div className="flex flex-1 justify-center pt-4" aria-label={`${mode} starters`}>
		<SessionStarterPrompts
			mode={mode}
			workspaceCwd={workspaceCwd}
			onSelect={(text) => onStarterSelect?.(text)}
		/>
	</div>
)}
```

The top and bottom flex regions center the composer while keeping exactly one mounted `MessageInput`. `isEmpty` is the only switch-visibility condition; active transcripts never receive a mode control.

- [ ] **Step 8: Run empty-state and composer regressions**

```bash
pnpm test -- src/components/SessionEmptyState.test.tsx \
  src/chat/ChatView.test.tsx \
  src/components/MessageInput.test.tsx \
  src/components/MessageInput.steering.test.tsx \
  src/components/MessageInput.queue.test.tsx \
  src/components/MessageInput.paste.test.tsx \
  src/components/CommandPalette.test.tsx
pnpm run typecheck
```

Expected: all pass; no existing input path regresses.

- [ ] **Step 9: Commit**

```bash
git add src/components/SessionModeSwitcher.tsx \
  src/components/SessionEmptyState.tsx \
  src/components/SessionEmptyState.test.tsx \
  src/chat/ChatView.tsx src/chat/ChatView.test.tsx \
  src/components/MessageInput.tsx src/components/MessageInput.test.tsx
git commit -m "feat(frontend): add chat and work empty states"
```

---

### Task 6: Apply Readable Typography and Sidebar Mode Labels

**Files:**
- Create: `src/test/chat-typography.test.ts`
- Modify: `src/App.css`
- Modify: `src/App.tsx`
- Modify: `src/test/theme-consistency.test.ts`
- Modify: `src/components/ChatMessage.tsx`
- Modify: `src/components/ActivityBlock.tsx`
- Modify: `src/components/ThinkingBlock.tsx`
- Modify: `src/components/ToolCallTimeline.tsx`
- Modify: `src/components/ArtifactPreview.tsx`
- Modify: `src/components/FileMentionPopup.tsx`
- Modify: `src/components/FilePreviewChip.tsx`
- Modify: `src/components/InThreadFind.tsx`
- Modify: `src/components/MessageInput.tsx`
- Modify: `src/components/ModelSelector.tsx`
- Modify: `src/components/CommandPalette.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/Sidebar.test.tsx`
- Modify: `src/components/ConversationSearch.tsx`
- Modify: `src/components/ConversationSearch.test.tsx`

- [ ] **Step 1: Add failing typography token tests**

Create `src/test/chat-typography.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..", "..");
const css = readFileSync(resolve(root, "src/App.css"), "utf8");
const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");

const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Chat and Work readability", () => {
	it("defines the approved 100% typography tokens", () => {
		for (const token of [
			"--font-response: 17px",
			"--font-user-message: 16px",
			"--font-composer: 16px",
			"--font-empty-heading: 26px",
			"--font-session-title: 14px",
			"--font-secondary: 13px",
			"--font-code: 14px",
			"--font-control: 14px",
		]) expect(css).toContain(token);
	});

	it("uses system reading type for Chat and Work surfaces", () => {
		expect(css).toMatch(/--font-reading:[^;]*-apple-system/);
		expect(css).toMatch(/\.session-shell[^}]*font-family:\s*var\(--font-reading\)/s);
	});

	it("applies 17px assistant and 16px user message classes", () => {
		expect(css).toMatch(/\.chat-markdown\s*\{[^}]*var\(--font-response\)/s);
		expect(css).toMatch(/\.chat-markdown-user\s*\{[^}]*var\(--font-user-message\)/s);
		expect(source("src/components/ChatMessage.tsx")).toContain("chat-markdown-user");
	});

	it("restores persisted font scaling on top of the new defaults", () => {
		expect(app).toContain("fontScaleClass");
		expect(app).toContain("getFontScale");
		expect(app).not.toContain('className="flex md:gap-2.5 md:p-2.5 [zoom:1] h-screen"');
	});

	it("removes sub-12px utilities from core Chat and navigation surfaces", () => {
		for (const file of [
			"src/components/ChatMessage.tsx",
			"src/components/MessageInput.tsx",
			"src/components/ModelSelector.tsx",
			"src/components/CommandPalette.tsx",
			"src/components/Sidebar.tsx",
			"src/components/ConversationSearch.tsx",
			"src/components/ActivityBlock.tsx",
			"src/components/ThinkingBlock.tsx",
			"src/components/ToolCallTimeline.tsx",
			"src/components/ArtifactPreview.tsx",
			"src/components/FileMentionPopup.tsx",
			"src/components/FilePreviewChip.tsx",
			"src/components/InThreadFind.tsx",
		]) {
			expect(source(file), file).not.toMatch(/text-\[(?:9|10|11)px\]/);
		}
	});
});
```

- [ ] **Step 2: Run the typography test and verify failure**

```bash
pnpm test -- src/test/chat-typography.test.ts src/test/theme-consistency.test.ts
```

Expected: failures for missing tokens, hard-coded zoom, 14px response text, and sub-12px utilities.

- [ ] **Step 3: Add semantic typography tokens and reading stack**

In the primary `:root` token block add:

```css
--font-reading: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
--font-response: 17px;
--font-user-message: 16px;
--font-composer: 16px;
--font-empty-heading: 26px;
--font-task-header: 16px;
--font-session-title: 14px;
--font-secondary: 13px;
--font-code: 14px;
--font-control: 14px;
```

Use the tokens in semantic shell classes:

```css
.session-empty-heading {
	font-size: var(--font-empty-heading);
}
.session-composer {
	font-size: var(--font-composer);
}
.session-row-title {
	font-size: var(--font-session-title);
}
.session-secondary {
	font-size: var(--font-secondary);
}
.session-control {
	font-size: var(--font-control);
}
```

Change body from `13px` to `14px`. Replace the existing `.chat-font` family rule with:

```css
.chat-font,
.session-shell {
	font-family: var(--font-reading);
}
```

Do not use `.chat-font *`; letting code retain `--font-mono` avoids a universal-selector override.

Update Markdown:

```css
.chat-markdown {
	font-size: var(--font-response);
	line-height: 1.65;
	color: inherit;
	word-break: break-word;
	overflow-wrap: anywhere;
}
.chat-markdown-user {
	font-size: var(--font-user-message);
}
.chat-markdown code,
.chat-markdown pre code,
.session-shell pre {
	font-size: var(--font-code);
}
```

Keep heading hierarchy in `em`; it now scales from 17px. Keep branding surfaces on Chakra Petch.

- [ ] **Step 4: Apply role-specific message and composer sizes**

In `ChatMessage.tsx`, add `chat-markdown-user` only for user content:

```tsx
className={`chat-markdown ${isUser ? "chat-markdown-user" : ""}`}
```

Apply these exact minimum replacements in Chat surfaces:

| File | Replace | With |
|---|---|---|
| `ChatMessage.tsx` | every `text-[10px]` | `text-[13px]` |
| `ChatMessage.tsx` | action `text-[11px]` | `text-sm` |
| `ChatMessage.tsx` | header name `text-xs` | `text-[13px]` |
| `ActivityBlock.tsx` | `text-[11px]` | `text-[13px]` |
| `ThinkingBlock.tsx` | `text-[10px]`/`text-[11px]` | `text-[13px]` |
| `ToolCallTimeline.tsx` | root `text-xs font-mono` | `text-sm font-mono` |
| `ToolCallTimeline.tsx` | `text-[10px]` | `text-[13px]` |
| `ToolCallTimeline.tsx` | `text-[11px]` | `text-sm` for `pre`, `text-[13px]` otherwise |
| `ArtifactPreview.tsx` | header/empty `text-[11px]` | `text-[13px]` |
| `ArtifactPreview.tsx` | code `pre text-[11px]` | `pre text-sm` |
| `FileMentionPopup.tsx` | breadcrumb `text-[10px]` | `text-[13px]` |
| `FilePreviewChip.tsx` | mention marker `text-[10px]` | `text-xs` |
| `InThreadFind.tsx` | counter `text-[11px]` | `text-[13px]` |
| `MessageInput.tsx` | queue/warning `text-[11px]` | `text-[13px]` |
| `MessageInput.tsx` | fallback model `text-xs` | `text-sm` |

The textarea already uses `session-composer` from Task 5; this task gives that class its 16px token. Keep icon-only control dimensions unchanged; accessible names already exist.

- [ ] **Step 5: Raise model and command menu text**

Apply these exact replacements:

| File | Replace | With |
|---|---|---|
| `ModelSelector.tsx` | trigger `text-xs` | `text-sm` |
| `ModelSelector.tsx` | provider badges/headings `text-[9px]` | `text-xs` |
| `ModelSelector.tsx` | search/model name `text-xs` | `text-sm` |
| `ModelSelector.tsx` | count/context `text-[10px]` | `text-xs` |
| `CommandPalette.tsx` | header `text-[11px]` | `text-sm` |
| `CommandPalette.tsx` | category/arg/footer `text-[10px]` | `text-xs` |
| `CommandPalette.tsx` | rows `text-[13px]` | `text-sm` |
| `CommandPalette.tsx` | description `text-[12px]` | `text-[13px]` |
| `CommandPalette.tsx` | key caps `text-[9px]` | `text-xs` |

Do not change command filtering, keyboard behavior, portal positioning, or model identity.

- [ ] **Step 6: Raise sidebar text and show durable mode labels**

Add `mode?: SessionMode` to the `Session` interfaces in `Sidebar.tsx` and `ConversationSearch.tsx`, then forward it unchanged.

In `ConversationSearch` row title, render after the title:

```tsx
<span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
	{session.mode === "work" ? "Work" : "Chat"}
</span>
```

Apply:

| File | Replace | With |
|---|---|---|
| `Sidebar.tsx` | count `text-[10px]` | `text-xs` |
| `Sidebar.tsx` | Settings `text-[11px]` | `text-sm` |
| `ConversationSearch.tsx` | session title `text-[12px]` | `session-row-title` |
| `ConversationSearch.tsx` | path/preview `text-[10px]`/`text-[11px]` | `text-[13px]` |
| `ConversationSearch.tsx` | timestamp/group/header `text-[9px]`/`text-[10px]` | `text-xs` |
| `ConversationSearch.tsx` | visible New/Open/folder controls `text-[11px]` | `text-sm` |
| `ConversationSearch.tsx` | empty state `text-[11px]` | `text-[13px]` |

Add to `ConversationSearch.test.tsx`:

```ts
it("shows each session's durable Chat or Work label", () => {
	render(
		<ConversationSearch
			sessions={[
				{ ...mockSessions[0], mode: "work" },
				{ ...mockSessions[1], mode: "chat" },
			]}
			onSelect={noop}
			onNewSession={noop}
			onOpenSession={noop}
			onDeleteSession={noop}
		/>,
	);
	expect(screen.getByRole("button", { name: /React project setup/ })).toHaveTextContent("Work");
	expect(screen.getByRole("button", { name: /API design patterns/ })).toHaveTextContent("Chat");
});
```

Existing rows without mode render Chat, matching legacy default.

- [ ] **Step 7: Restore persisted font scale on App root**

Import:

```ts
import { fontScaleClass, getFontScale } from "@/lib/font-scale";
```

Initialize once:

```ts
const [fontScale] = useState(getFontScale);
```

Replace the root class with:

```tsx
<div className={`flex md:gap-2.5 md:p-2.5 ${fontScaleClass(fontScale)}`}>
```

Update `theme-consistency.test.ts` to assert `fontScaleClass(fontScale)` and `getFontScale`, while retaining all zoom-compensated-height assertions. Do not add a font-size picker; this phase only honors already persisted choices.

- [ ] **Step 8: Run typography and component tests**

```bash
pnpm test -- src/test/chat-typography.test.ts \
  src/test/theme-consistency.test.ts \
  src/components/ChatMessage.test.tsx \
  src/components/ActivityBlock.test.tsx \
  src/components/ArtifactPreview.test.tsx \
  src/components/FileMentionPopup.test.tsx \
  src/components/MessageInput.test.tsx \
  src/components/ModelSelector.test.tsx \
  src/components/CommandPalette.test.tsx \
  src/components/Sidebar.test.tsx \
  src/components/ConversationSearch.test.tsx
pnpm run lint
pnpm run typecheck
```

Expected: all pass with no sub-12px utilities in the guarded Chat/navigation files.

- [ ] **Step 9: Commit**

```bash
git add src/App.css src/App.tsx \
  src/test/chat-typography.test.ts src/test/theme-consistency.test.ts \
  src/components/ChatMessage.tsx src/components/ActivityBlock.tsx \
  src/components/ThinkingBlock.tsx src/components/ToolCallTimeline.tsx \
  src/components/ArtifactPreview.tsx src/components/FileMentionPopup.tsx \
  src/components/FilePreviewChip.tsx src/components/InThreadFind.tsx \
  src/components/MessageInput.tsx src/components/ModelSelector.tsx \
  src/components/CommandPalette.tsx src/components/Sidebar.tsx \
  src/components/Sidebar.test.tsx src/components/ConversationSearch.tsx \
  src/components/ConversationSearch.test.tsx
git commit -m "style: apply readable chat and work typography"
```

---

### Task 7: Phase Boundary Regression and Acceptance

**Files:**
- Modify only files required by verified failures.
- Do not begin Phase 4.

- [ ] **Step 1: Run all automated project gates**

```bash
pnpm run validate
pnpm run build:frontend
(cd agent-sidecar && pnpm test && pnpm build)
cargo fmt --check
cargo clippy --workspace -- -D warnings
cargo test --workspace
git diff --check
```

Expected:

- frontend lint/style/typecheck and all tests pass with pristine output;
- production frontend build succeeds (record any pre-existing bundle warning separately);
- sidecar tests/build pass;
- Rust fmt/clippy/tests pass;
- no whitespace errors.

If a behavior failure appears, write the smallest failing regression first, confirm it fails for the observed reason, then fix it. Do not paper over failures with lint suppressions unless the construct is both necessary and documented.

- [ ] **Step 2: Verify mode identity and phase boundaries statically**

```bash
rg -n 'type SessionMode|mode: SessionMode|set_session_mode|session_mode_locked|modes:' \
  agent-sidecar/src src src-tauri/src/lib.rs
rg -n 'mode: "chat"' agent-sidecar/src/session-runtime-manager.ts src/types/session-runtime.ts
rg -n 'WorkSessionView|WorkPanel|Outputs|Sources|SelectionActions|Ask AI|Start writing' \
  src --glob '!**/*.test.*' || true
rg -n 'PendingPrompt|Channel<Value>|prompt_channel' src-tauri/src/lib.rs || true
rg -n 'text-\[(9|10|11)px\]' \
  src/components/ChatMessage.tsx \
  src/components/MessageInput.tsx \
  src/components/ModelSelector.tsx \
  src/components/CommandPalette.tsx \
  src/components/Sidebar.tsx \
  src/components/ConversationSearch.tsx \
  src/components/ActivityBlock.tsx \
  src/components/ThinkingBlock.tsx \
  src/components/ToolCallTimeline.tsx \
  src/components/ArtifactPreview.tsx \
  src/components/FileMentionPopup.tsx \
  src/components/FilePreviewChip.tsx \
  src/components/InThreadFind.tsx || true
```

Expected:

- mode exists in metadata, snapshot, keyed state, command, relay, and App;
- only default/fallback Chat literals remain, not a narrow snapshot type;
- no Phase 4–5 product UI appears;
- removed prompt-channel transport stays removed;
- guarded Chat/navigation files contain no sub-12px utilities.

- [ ] **Step 3: Run deterministic mode race checks**

```bash
pnpm test -- src/hooks/usePiStream.session.test.ts -t "mode"
pnpm test -- src/App.sessions.test.tsx -t "mode|first prompt|collapses|draft"
(cd agent-sidecar && pnpm test -- src/pi-session-store.test.ts src/commands/handlers/sessions.test.ts)
```

Confirm:

1. Work→Chat rapid changes persist in order and latest wins.
2. Failed latest mutation rolls back.
3. Interrupted empty session reloads before mode save.
4. Mode save finishes before `START_STREAM`.
5. Mode-save failure prevents first prompt.
6. User/assistant history and running state reject backend mutation.
7. Delete removes mode metadata.
8. Legacy/corrupt metadata defaults safely to Chat.

- [ ] **Step 4: Grep every shared component renderer after prop changes**

```bash
rg -n '<ChatView|ChatView:' src --glob '*.tsx'
rg -n '<MessageInput' src --glob '*.tsx'
rg -n '<Sidebar|Sidebar:' src --glob '*.tsx'
rg -n 'SessionSnapshot' src agent-sidecar/src --glob '*.{ts,tsx}'
```

Update every production/test renderer. The direct-render compatibility defaults remain Chat/no-op only; verify production App passes real mode and callbacks.

- [ ] **Step 5: Run manual desktop acceptance**

Start the desktop app with `pnpm run tauri dev` in an interactive GUI environment and verify:

1. New empty session defaults to Chat.
2. Empty Chat starts with collapsed rail; Expand works in one action.
3. Chat/Work tabs are keyboard reachable; Left/Right changes the selected tab.
4. Empty Chat shows `What’s on your mind today?`, compact `Ask Zosma…` composer, and two conversational starters.
5. Empty Work expands navigation, shows `What should we work on?`, larger multiline composer, Work starters, and exact workspace folder.
6. A starter fills/focuses the composer and does not send.
7. Attach file, paste image, voice, model picker, file mention/drop, slash command, and Shift+Enter still work in both empty modes.
8. Send first Work prompt; switcher disappears immediately and cannot be changed.
9. Reload the session; it remains Work.
10. Existing legacy session opens as Chat.
11. Active Chat and active Work both show current transcript behavior; no fake Work document canvas appears.
12. New assistant response text is 17px/1.65 at Normal scale; user text/composer are 16px; code is 14px; sidebar title is 14px; secondary text is at least 13px except explicitly tiny non-core diagnostics outside this phase.
13. Existing saved Small/Large/Extra Large preference still scales on top of the new defaults without clipping the New-session chrome.
14. Start session A, switch to B, change empty B to Work, send B, and confirm A continues with its mode/state unchanged.
15. Delete B and recreate/load sessions; deleted Work metadata does not resurrect.

Record environment limits rather than claiming unperformed GUI checks.

- [ ] **Step 6: Review final diff against selected phase**

Run `code_review` against `main` if configured. If unavailable, record the exact provider/config error and use direct diff inspection plus one independent `fusion` critique. Fix only verified Critical/Important findings, with a failing test first for behavior changes.

Review lenses:

- first-prompt persistence ordering;
- rapid mode mutation ordering/rollback;
- backend trust-boundary lock;
- legacy/corrupt metadata fallback;
- keyed-session isolation and restart behavior;
- one persistent composer and draft ownership;
- accessibility of tabs/starters/focus;
- typography minimums and zoom clipping;
- strict Phase 3 boundary.

- [ ] **Step 7: Commit any verified regression fixes**

If no fixes are needed, do not create an empty commit. Otherwise:

```bash
git add <only verified fix and regression-test files>
git commit -m "fix: harden chat and work mode rollout"
```

- [ ] **Step 8: Push while keeping PR #354 draft**

```bash
git status --short
git log --oneline 836759af2..HEAD
git push origin feat/chat-work-phase-1-runtime-identity
gh pr view 354 --json isDraft,state,mergedAt,headRefName,url
```

Expected: clean tree; Phase 3 commits pushed; PR #354 reports `isDraft: true`, `state: OPEN`, `mergedAt: null`.

Do not mark ready or merge. Existing npm/cargo security advisories remain final-release blockers unless resolved by a separately approved security task.

---

## Execution Checkpoints

1. **After Tasks 1–2:** inspect sidecar/relay diff; run mode metadata, handler, protocol, and Rust payload tests.
2. **After Tasks 3–4:** inspect keyed controller/App diff; run mode race, first-send ordering, legacy default, sidebar default, and draft ownership tests.
3. **After Tasks 5–6:** inspect product UI/typography diff; run empty-state, composer regression, sidebar, model/command menu, and typography tests.
4. **After Task 7:** full gates, static phase checks, available manual acceptance, independent review, push—PR remains draft.

## Phase 3 Completion Criteria

Phase 3 is complete only when:

- mode is stored in existing Cowork metadata by canonical session path;
- legacy/missing/corrupt mode metadata safely defaults to Chat;
- mode can change while empty and backend rejects invalid/started/running mutations;
- rapid mutations serialize and latest choice wins;
- the selected mode is durably saved before the optimistic first message starts;
- mode-save failure leaves the session empty and visibly retryable;
- mode survives load/restart and deletion removes its metadata;
- Empty Chat/Work match approved hierarchy, starter, composer, workspace, and sidebar defaults;
- starters fill but never auto-send;
- one shared composer retains attachments, voice, mentions/drop, paste, models, slash commands, steering, follow-up, and queue behavior;
- active Work remains the current transcript, clearly deferred to Phase 4;
- approved 17/16/16/26/14/13/14 typography defaults apply at 100%;
- persisted font scaling still layers on top without viewport clipping;
- concurrent sessions, hidden completion, abort/delete, and keyed errors remain green;
- all automated gates pass and PR #354 remains draft/unmerged.

## Deferred Phase 4 Contracts

- `StreamState.mode` is the sole chooser for active Chat versus active Work presentation.
- Phase 4 must introduce `WorkSessionView` without changing mode persistence or allowing active switching.
- Active Work must keep the same keyed messages/model/cwd/queue/error/settledVersion state and the same persistent composer behavior.
- Outputs/Sources remain pure projections of live/persisted messages; no new mode database or artifact store.
- Sidebar default behavior remains: active sessions visible/expanded on entry, manual collapse still available.
- Typography tokens added here are the baseline for Work result/header/rail; Phase 4 must not shrink below them.
