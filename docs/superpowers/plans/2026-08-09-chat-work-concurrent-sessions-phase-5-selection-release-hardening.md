# Selected-Text Actions and Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add accessible `Ask AI` and `Start writing` actions for text selected inside one assistant response, then close the remaining security, dependency, build, performance, and acceptance gaps for the complete Chat/Work release.

**Architecture:** Native browser `Selection`/`Range` APIs detect one non-empty selection inside a marked assistant Markdown response. One `SelectionActions` controller owned by the stable `ChatView` shell renders a fixed contextual toolbar, while the existing single `MessageInput` owns removable quote context and all send/steer/follow-up serialization. `Start writing` reuses the exact keyed `startStream` or `followUpStream` paths; no new transport exists. Release hardening replaces pathname-revalidated artifact reads with capability-scoped handle reads, applies patched transitive dependency resolutions, removes known build warnings, and validates the five-phase contracts without adding a state, editor, selection, or UI dependency.

**Tech Stack:** React 19, TypeScript, native DOM Selection/Range, React Testing Library, Vitest, Tailwind CSS v4, Tauri 2, Rust 2021, `cap-std` 4.0.2, pnpm, Cargo.

**Roadmap:** [`docs/superpowers/roadmaps/2026-08-09-chat-work-concurrent-sessions-roadmap.md`](../roadmaps/2026-08-09-chat-work-concurrent-sessions-roadmap.md)

**Phase:** Phase 5: Selected-text Actions and Release Hardening

---

## Phase Boundary

This is the final phase of the approved Chat/Work roadmap. It includes only:

- selection wholly inside one assistant response;
- `Ask AI` quote context;
- `Start writing` idle-send/running-follow-up routing;
- keyboard, focus, dismissal, reduced-motion, and responsive behavior for that interaction;
- the unresolved native artifact handle-binding fix;
- existing dependency vulnerability remediation without audit allowlists;
- warning-free release validation, loaded-session switching measurement, and full acceptance.

It does **not** include:

- rich quote editing;
- multiple excerpts;
- clipping persistence or a quote database;
- new selection actions;
- inline output editing or a document editor;
- Projects, plugins, integrations, Library, Agents, scheduling, or cloud sync;
- protocol sequence numbers, replay cursors, runtime UUIDs, or prompt idempotency;
- a new state-management, editor, selection, animation, or UI package;
- changes to the global `session_event` transport or Phase 1–4 completion semantics.

The phase is complete only after Tasks 1–8 pass. PR #354 must remain open, draft, and unmerged throughout execution.

## Existing Contracts That Must Remain True

1. `sessionFile` is the sole runtime and frontend cache identity.
2. `MessageInput` is mounted once per active session and remains the only owner of attachments, pasted images, voice state, model UI, file mentions, slash commands, steering, follow-up, queue editing, and submit clearing.
3. Enter while idle calls `onSend`; Enter while running calls `onSteer`; `Alt+Enter` while running calls `onFollowUp`; `Shift+Enter` inserts a newline; `Ctrl+↑` drains the selected session's queue for editing.
4. `Start writing` is the only selection action that bypasses the editable composer. Idle calls `onSend`; running calls `onFollowUp`, never `onSteer`.
5. `Ask AI` never sends on activation. It creates one removable quote card and focuses an empty custom-instruction field.
6. The persisted user message is ordinary Markdown: a block quote followed by the action/custom instruction. No quote metadata is added to the sidecar protocol or JSONL format.
7. Selection state is transient UI state. It clears on session change and is not persisted.
8. Only rendered assistant Markdown is selectable for actions. User messages, system messages, thinking, tool details, activity, attachments, sidebar, Work panel, composer, and selections crossing response roots are excluded.
9. Chat and Work share selection behavior through `ChatView`; their existing renderers remain visually distinct.
10. Native artifact bytes are returned only from a regular file opened through the selected workspace capability and read through that same handle with the existing 5 MiB cap.
11. No audit finding may be hidden, ignored, or allowlisted. Dependency changes must resolve findings and retain passing behavior.
12. The authoritative terminal signal remains normalized `done`; `settledVersion`, `awaitingDone`, abort quiescence, deletion tombstones, and stop-first deletion remain unchanged.

## File Map

### New files

- `src/lib/selection-actions.ts` — pure quote serialization and selection snapshot extraction.
- `src/lib/selection-actions.test.ts` — literal quote and DOM containment examples.
- `src/hooks/useSelectionActions.ts` — browser event lifecycle and transient selection state.
- `src/hooks/useSelectionActions.test.tsx` — selection, dismissal, session-reset, and position behavior.
- `src/components/SelectionActions.tsx` — fixed accessible two-button toolbar.
- `src/components/SelectionActions.test.tsx` — keyboard/focus-preserving activation behavior.
- `src/components/MessageInput.selection.test.tsx` — quote-card and existing submit-routing behavior.

### Modified files

- `src/components/ChatMessage.tsx` — mark only assistant Markdown as a valid response root.
- `src/work/WorkSessionView.tsx` — mark only Work assistant Markdown as a valid response root.
- `src/components/ChatMessage.test.tsx` or `src/chat/ChatView.test.tsx` — Chat selection boundary coverage.
- `src/work/WorkSessionView.test.tsx` — Work selection boundary coverage.
- `src/chat/ChatView.tsx` — own one selection controller, Ask AI context, and Start writing routing.
- `src/chat/ChatView.test.tsx` — end-to-end Chat/Work selection-action behavior and session reset.
- `src/components/MessageInput.tsx` — render removable quote card and prepend it during existing submit paths.
- `src/App.tsx` — no new routing function; continue passing the existing keyed `onSend`, `onSteer`, and `onFollowUp` callbacks unchanged.
- `src/App.sessions.test.tsx` — extend the existing `ChatView` mock to prove running `Start writing` targets only `followUpStream(activeSessionFile, text)` and idle targets only `startStream(activeSessionFile, text)`.
- `src/App.css` — selection toolbar/card styling, focus-visible state, viewport-safe sizing, and reduced-motion rule.
- `src-tauri/src/lib.rs` — capability-scoped artifact open/read and native regression tests.
- `src-tauri/Cargo.toml` — add `cap-std = "4.0.2"` and move `tauri-plugin-log` to 2.9.0, whose dependency graph removes the unused vulnerable `rkyv 0.7` line.
- `Cargo.lock` — generated lock update with `cap-std`; remove the obsolete `tauri-plugin-log 2.8 → byte-unit → rust_decimal → rkyv 0.7.46` resolution.
- `package.json`, `pnpm-lock.yaml` — patched frontend dependency resolutions.
- `agent-sidecar/package.json`, `agent-sidecar/pnpm-lock.yaml` — patched sidecar dependency resolutions.
- `vite.config.ts` — split existing large dependency families into release chunks.
- `src/hooks/useAppUpdate.ts`, `src/chat/ChatView.tsx`, `src/components/MessageInput.tsx`, `src/components/ChatMessage.tsx`, `src/components/settings/Workspace.tsx` — make Tauri core/dialog imports consistently static so Rollup emits no mixed-import warnings.
- `scripts/inline-token-style-baseline.json` — lower only if execution removes inline token styles; never increase it.

## Approved Test Seams

Tests exercise these public boundaries rather than internal implementation details:

1. `formatSelectionPrompt(excerpt, instruction)` returns persisted Markdown.
2. `readAssistantSelection(selection)` accepts or rejects a real DOM `Selection` based on marked rendered roots.
3. `useSelectionActions` reacts to native selection/dismissal/session events.
4. `SelectionActions` exposes a keyboard-reachable toolbar with two labeled buttons.
5. `MessageInput` displays/removes quote context and routes the final serialized prompt through its existing callbacks.
6. `ChatView` supplies one shared selection experience in Chat and Work and routes Start writing from `isRunning`.
7. Existing `App`/`usePiStream` mocks verify exact active `sessionFile` targeting; no new transport test double is introduced.
8. Rust tests call the capability-open/read seam and prove traversal, symlink escape, regular-file, size, and handle-stability behavior.
9. `pnpm audit`, Cargo dependency inspection/security CI, production build stderr, and desktop acceptance are release seams.

---

### Task 1: Define Selection and Quote Contracts as Pure Functions

**Files:**
- Create: `src/lib/selection-actions.ts`
- Create: `src/lib/selection-actions.test.ts`

- [ ] **Step 1: Write the failing quote-serialization tests**

Create `src/lib/selection-actions.test.ts` with one behavior per test:

```ts
import { describe, expect, it } from "vitest";
import { formatSelectionPrompt } from "./selection-actions";

describe("formatSelectionPrompt", () => {
	it("serializes every excerpt line as a readable Markdown quote", () => {
		expect(formatSelectionPrompt("First line\n\nSecond line", "Explain this")).toBe(
			"> First line\n>\n> Second line\n\nExplain this",
		);
	});

	it("normalizes CRLF and trims the excerpt and instruction edges", () => {
		expect(formatSelectionPrompt("  alpha\r\nbeta  ", "  Compare these claims  ")).toBe(
			"> alpha\n> beta\n\nCompare these claims",
		);
	});

	it("returns an empty string for an empty excerpt", () => {
		expect(formatSelectionPrompt(" \n ", "Explain this")).toBe("");
	});

	it("returns an empty string for an empty instruction", () => {
		expect(formatSelectionPrompt("Evidence", "  ")).toBe("");
	});
});
```

- [ ] **Step 2: Run the test and verify the expected red state**

Run:

```bash
pnpm exec vitest run src/lib/selection-actions.test.ts
```

Expected: FAIL because `./selection-actions` does not exist.

- [ ] **Step 3: Implement the minimal serializer**

Create `src/lib/selection-actions.ts`:

```ts
export const START_WRITING_INSTRUCTION = "Start writing from this excerpt.";

export function formatSelectionPrompt(excerpt: string, instruction: string): string {
	const selected = excerpt.replace(/\r\n?/g, "\n").trim();
	const intent = instruction.trim();
	if (!selected || !intent) return "";
	const quote = selected
		.split("\n")
		.map((line) => (line ? `> ${line}` : ">"))
		.join("\n");
	return `${quote}\n\n${intent}`;
}
```

Do not add a quote model to shared session types. This string is the persisted format.

- [ ] **Step 4: Run the serializer tests**

Run:

```bash
pnpm exec vitest run src/lib/selection-actions.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Write failing DOM containment tests**

Extend the test file:

```ts
import { readAssistantSelection } from "./selection-actions";

function select(start: Node, end: Node = start): Selection {
	const range = document.createRange();
	range.setStart(start, 0);
	range.setEnd(end, end.textContent?.length ?? 0);
	Object.defineProperty(range, "getBoundingClientRect", {
		value: () => ({
			x: 80,
			y: 120,
			left: 80,
			top: 120,
			right: 180,
			bottom: 140,
			width: 100,
			height: 20,
			toJSON: () => ({}),
		}),
	});
	const selection = window.getSelection();
	if (!selection) throw new Error("Selection unavailable");
	selection.removeAllRanges();
	selection.addRange(range);
	return selection;
}

describe("readAssistantSelection", () => {
	it("accepts text wholly inside one assistant response root", () => {
		document.body.innerHTML =
			'<div data-assistant-response="m1"><p id="one">Selected answer</p></div>';
		const selection = select(document.querySelector("#one")!.firstChild!);
		expect(readAssistantSelection(selection)).toEqual({
			excerpt: "Selected answer",
			messageId: "m1",
			anchor: { left: 130, top: 120, bottom: 140 },
		});
	});

	it("rejects a selection crossing assistant response roots", () => {
		document.body.innerHTML = [
			'<div data-assistant-response="m1"><p id="one">First</p></div>',
			'<div data-assistant-response="m2"><p id="two">Second</p></div>',
		].join("");
		const selection = select(
			document.querySelector("#one")!.firstChild!,
			document.querySelector("#two")!.firstChild!,
		);
		expect(readAssistantSelection(selection)).toBeNull();
	});

	it("rejects text outside an assistant response root", () => {
		document.body.innerHTML = '<div data-message-id="u1"><p id="user">User text</p></div>';
		expect(readAssistantSelection(select(document.querySelector("#user")!.firstChild!))).toBeNull();
	});

	it("rejects a collapsed or whitespace-only selection", () => {
		document.body.innerHTML =
			'<div data-assistant-response="m1"><p id="blank">   </p></div>';
		expect(readAssistantSelection(select(document.querySelector("#blank")!.firstChild!))).toBeNull();
	});
});
```

- [ ] **Step 6: Run the containment tests and verify red**

Run:

```bash
pnpm exec vitest run src/lib/selection-actions.test.ts -t "readAssistantSelection"
```

Expected: FAIL because `readAssistantSelection` is not exported.

- [ ] **Step 7: Implement strict one-root extraction**

Add these exported types and functions to `src/lib/selection-actions.ts`:

```ts
export interface SelectionAnchor {
	left: number;
	top: number;
	bottom: number;
}

export interface AssistantSelection {
	excerpt: string;
	messageId: string;
	anchor: SelectionAnchor;
}

function responseRoot(node: Node | null): HTMLElement | null {
	const element = node instanceof Element ? node : node?.parentElement;
	return element?.closest<HTMLElement>("[data-assistant-response]") ?? null;
}

export function readAssistantSelection(selection: Selection | null): AssistantSelection | null {
	if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
	const range = selection.getRangeAt(0);
	const start = responseRoot(range.startContainer);
	const end = responseRoot(range.endContainer);
	if (!start || start !== end) return null;
	const excerpt = selection.toString().replace(/\r\n?/g, "\n").trim();
	const messageId = start.dataset.assistantResponse;
	if (!excerpt || !messageId) return null;
	const rect = range.getBoundingClientRect();
	return {
		excerpt,
		messageId,
		anchor: {
			left: rect.left + rect.width / 2,
			top: rect.top,
			bottom: rect.bottom,
		},
	};
}
```

The root itself supplies the message ID. Do not infer message identity from active session state or neighboring DOM.

- [ ] **Step 8: Run all Task 1 tests and commit**

Run:

```bash
pnpm exec vitest run src/lib/selection-actions.test.ts
pnpm run typecheck
git diff --check
```

Expected: all tests and checks pass.

Commit:

```bash
git add src/lib/selection-actions.ts src/lib/selection-actions.test.ts
git commit -m "feat(frontend): define selected text prompt contracts"
```

---

### Task 2: Mark Exact Assistant Markdown Boundaries in Chat and Work

**Files:**
- Modify: `src/components/ChatMessage.tsx`
- Modify: `src/chat/ChatView.test.tsx`
- Modify: `src/work/WorkSessionView.tsx`
- Modify: `src/work/WorkSessionView.test.tsx`

- [ ] **Step 1: Add failing Chat boundary assertions**

In the existing active Chat renderer test in `src/chat/ChatView.test.tsx`, assert one valid root and exclude user content:

```ts
it("marks only assistant Markdown as a selection-action response root", () => {
	const { container } = render(
		<ChatView
			sessionFile="/chat.jsonl"
			messages={[
				{ id: "u", role: "user", content: "User direction", timestamp: 1 },
				{ id: "a", role: "assistant", content: "Assistant answer", timestamp: 2 },
			]}
			streamingMessage={null}
			isRunning={false}
			error={null}
			onSend={vi.fn()}
			onAbort={vi.fn()}
			mode="chat"
		/>,
	);
	expect(container.querySelectorAll("[data-assistant-response]")).toHaveLength(1);
	expect(container.querySelector("[data-assistant-response='a']")).toHaveTextContent(
		"Assistant answer",
	);
	expect(screen.getByText("User direction").closest("[data-assistant-response]")).toBeNull();
});
```

- [ ] **Step 2: Add failing Work boundary assertions**

Add to `src/work/WorkSessionView.test.tsx`:

```ts
it("marks only assistant Markdown and excludes directions and tool activity", () => {
	const { container } = render(
		<WorkSessionView
			messages={[
				{ id: "u", role: "user", content: "Direction", timestamp: 1 },
				{ id: "a", role: "assistant", content: "Result", timestamp: 2 },
			]}
			streamingMessage={null}
			isRunning={false}
			models={[]}
			detailsExpanded={false}
			workspaceCwd="/work"
		/>,
	);
	expect(container.querySelectorAll("[data-assistant-response]")).toHaveLength(1);
	expect(container.querySelector("[data-assistant-response='a']")).toHaveTextContent("Result");
	expect(screen.getByText("Direction").closest("[data-assistant-response]")).toBeNull();
});
```

- [ ] **Step 3: Run both focused files and verify red**

Run:

```bash
pnpm exec vitest run src/chat/ChatView.test.tsx src/work/WorkSessionView.test.tsx \
  -t "marks only assistant"
```

Expected: FAIL because no `data-assistant-response` attribute exists.

- [ ] **Step 4: Mark the Chat Markdown root only**

In `src/components/ChatMessage.tsx`, add the attribute to the existing content wrapper only for assistant messages:

```tsx
<div
	data-assistant-response={!isUser ? message.id : undefined}
	className={`chat-markdown ${isUser ? "chat-markdown-user" : ""}`}
	style={{
		color: isUser ? "hsl(var(--chat-user-fg))" : "hsl(var(--chat-assistant-fg))",
	}}
>
```

Do not mark the outer message, bubble, thinking block, tool timeline, attachment area, feedback buttons, or export controls.

- [ ] **Step 5: Give Work Markdown its own narrow root**

In `src/work/WorkSessionView.tsx`, wrap only assistant `message.content`:

```tsx
{message.content && (
	<div data-assistant-response={message.id}>
		<ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
			{message.content}
		</ReactMarkdown>
	</div>
)}
```

Keep `data-message-id` on the article for in-thread navigation. Do not mark the full article because it also contains thinking/activity/tool UI.

- [ ] **Step 6: Run renderer regressions and commit**

Run:

```bash
pnpm exec vitest run src/chat/ChatView.test.tsx src/work/WorkSessionView.test.tsx
pnpm run typecheck
git diff --check
```

Expected: PASS. Existing Chat bubble and Work document assertions remain green.

Commit:

```bash
git add src/components/ChatMessage.tsx src/chat/ChatView.test.tsx \
  src/work/WorkSessionView.tsx src/work/WorkSessionView.test.tsx
git commit -m "feat(frontend): mark selectable assistant responses"
```

---

### Task 3: Add One Native Selection Controller and Accessible Toolbar

**Files:**
- Create: `src/hooks/useSelectionActions.ts`
- Create: `src/hooks/useSelectionActions.test.tsx`
- Create: `src/components/SelectionActions.tsx`
- Create: `src/components/SelectionActions.test.tsx`
- Modify: `src/chat/ChatView.tsx`
- Modify: `src/chat/ChatView.test.tsx`
- Modify: `src/App.css`

- [ ] **Step 1: Write the failing hook lifecycle test**

Create `src/hooks/useSelectionActions.test.tsx`. Render the hook through a small public harness and use a real DOM range. Cover these behaviors as separate tests:

```tsx
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { describe, expect, it } from "vitest";
import { useSelectionActions } from "./useSelectionActions";

function Harness({ sessionKey = "/a.jsonl" }: { sessionKey?: string }) {
	const rootRef = useRef<HTMLDivElement>(null);
	const { selection } = useSelectionActions(rootRef, sessionKey);
	return (
		<div ref={rootRef} data-testid="scroll-root">
			<div data-assistant-response="a"><span>Selectable answer</span></div>
			<div data-message-id="u"><span>User text</span></div>
			<button type="button" data-selection-actions>Toolbar action</button>
			<output>{selection?.excerpt ?? "closed"}</output>
		</div>
	);
}

function selectText(element: Element) {
	const node = element.firstChild!;
	const range = document.createRange();
	range.selectNodeContents(node);
	Object.defineProperty(range, "getBoundingClientRect", {
		value: () => ({ left: 80, top: 120, right: 180, bottom: 140, width: 100, height: 20 }),
	});
	const selection = window.getSelection()!;
	selection.removeAllRanges();
	selection.addRange(range);
	act(() => document.dispatchEvent(new Event("selectionchange")));
}
```

Required test names and assertions:

```ts
it("opens for a valid keyboard or pointer selection", () => {
	render(<Harness />);
	selectText(screen.getByText("Selectable answer"));
	expect(screen.getByText("Selectable answer", { selector: "output" })).toBeInTheDocument();
});

it("closes when the selection collapses", () => {
	render(<Harness />);
	selectText(screen.getByText("Selectable answer"));
	window.getSelection()!.removeAllRanges();
	act(() => document.dispatchEvent(new Event("selectionchange")));
	expect(screen.getByText("closed", { selector: "output" })).toBeInTheDocument();
});

it("closes when its scroll container scrolls", () => {
	render(<Harness />);
	selectText(screen.getByText("Selectable answer"));
	fireEvent.scroll(screen.getByTestId("scroll-root"));
	expect(screen.getByText("closed", { selector: "output" })).toBeInTheDocument();
});

it("closes on Escape", () => {
	render(<Harness />);
	selectText(screen.getByText("Selectable answer"));
	fireEvent.keyDown(window, { key: "Escape" });
	expect(screen.getByText("closed", { selector: "output" })).toBeInTheDocument();
});

it("closes on pointer down outside the toolbar", () => {
	render(<Harness />);
	selectText(screen.getByText("Selectable answer"));
	fireEvent.pointerDown(document.body);
	expect(screen.getByText("closed", { selector: "output" })).toBeInTheDocument();
});

it("keeps the stored excerpt while focus or pointer is inside the toolbar", () => {
	render(<Harness />);
	selectText(screen.getByText("Selectable answer"));
	const action = screen.getByRole("button", { name: "Toolbar action" });
	action.focus();
	fireEvent.pointerDown(action);
	expect(screen.getByText("Selectable answer", { selector: "output" })).toBeInTheDocument();
});

it("never exposes a previous session selection during the session-change render", () => {
	const view = render(<Harness sessionKey="/a.jsonl" />);
	selectText(screen.getByText("Selectable answer"));
	view.rerender(<Harness sessionKey="/b.jsonl" />);
	expect(screen.getByText("closed", { selector: "output" })).toBeInTheDocument();
});

it("ignores selection outside the supplied scroll root", () => {
	render(<Harness />);
	const outside = document.createElement("span");
	outside.textContent = "Outside text";
	document.body.append(outside);
	selectText(outside);
	expect(screen.getByText("closed", { selector: "output" })).toBeInTheDocument();
	outside.remove();
});
```

- [ ] **Step 2: Run the hook tests and verify red**

Run:

```bash
pnpm exec vitest run src/hooks/useSelectionActions.test.tsx
```

Expected: FAIL because `useSelectionActions` does not exist.

- [ ] **Step 3: Implement the hook with native listeners**

Create `src/hooks/useSelectionActions.ts`:

```ts
import { readAssistantSelection, type AssistantSelection } from "@/lib/selection-actions";
import { type RefObject, useCallback, useEffect, useState } from "react";

type OwnedSelection = AssistantSelection & { sessionKey: string };

export function useSelectionActions(
	rootRef: RefObject<HTMLElement | null>,
	sessionKey: string,
) {
	const [stored, setStored] = useState<OwnedSelection | null>(null);
	const dismiss = useCallback(() => setStored(null), []);

	useEffect(() => {
		const update = () => {
			const browserSelection = window.getSelection();
			const next = readAssistantSelection(browserSelection);
			const root = rootRef.current;
			const range = browserSelection?.rangeCount ? browserSelection.getRangeAt(0) : null;
			const focusedToolbar = document.activeElement?.closest?.("[data-selection-actions]");
			if (!next || !root || !range || !root.contains(range.commonAncestorContainer)) {
				if (!focusedToolbar) setStored(null);
				return;
			}
			setStored({ ...next, sessionKey });
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") dismiss();
		};
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (target instanceof Element && target.closest("[data-selection-actions]")) return;
			dismiss();
		};
		document.addEventListener("selectionchange", update);
		document.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("keydown", onKeyDown);
		const root = rootRef.current;
		root?.addEventListener("scroll", dismiss, { passive: true });
		return () => {
			document.removeEventListener("selectionchange", update);
			document.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("keydown", onKeyDown);
			root?.removeEventListener("scroll", dismiss);
		};
	}, [rootRef, sessionKey, dismiss]);

	const selection = stored?.sessionKey === sessionKey ? stored : null;
	return { selection, dismiss };
}
```

If the hook test proves JSDOM's `commonAncestorContainer` can be a text node directly inside the root, use `root.contains(node)` as shown; do not replace this with global document containment.

- [ ] **Step 4: Run the hook tests**

Run:

```bash
pnpm exec vitest run src/hooks/useSelectionActions.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Write failing toolbar interaction tests**

Create `src/components/SelectionActions.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SelectionActions } from "./SelectionActions";

const selection = {
	excerpt: "Selected answer",
	messageId: "a",
	anchor: { left: 200, top: 160, bottom: 180 },
};

describe("SelectionActions", () => {
	it("renders one labeled toolbar with two keyboard-reachable actions", async () => {
		const user = userEvent.setup();
		render(<SelectionActions selection={selection} onAsk={vi.fn()} onStartWriting={vi.fn()} />);
		const toolbar = screen.getByRole("toolbar", { name: "Selection actions" });
		expect(toolbar).toBeInTheDocument();
		await user.tab();
		expect(screen.getByRole("button", { name: "Ask AI" })).toHaveFocus();
		await user.tab();
		expect(screen.getByRole("button", { name: "Start writing" })).toHaveFocus();
	});

	it("preserves the browser selection on pointer down and activates Ask AI", () => {
		const onAsk = vi.fn();
		const removeAllRanges = vi.spyOn(window.getSelection()!, "removeAllRanges");
		render(<SelectionActions selection={selection} onAsk={onAsk} onStartWriting={vi.fn()} />);
		const button = screen.getByRole("button", { name: "Ask AI" });
		const pointerDown = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
		button.dispatchEvent(pointerDown);
		expect(pointerDown.defaultPrevented).toBe(true);
		const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
		button.dispatchEvent(mouseDown);
		expect(mouseDown.defaultPrevented).toBe(true);
		fireEvent.click(button);
		expect(onAsk).toHaveBeenCalledWith("Selected answer");
		expect(removeAllRanges).not.toHaveBeenCalled();
	});
});
```

- [ ] **Step 6: Run the toolbar tests and verify red**

Run:

```bash
pnpm exec vitest run src/components/SelectionActions.test.tsx
```

Expected: FAIL because `SelectionActions` does not exist.

- [ ] **Step 7: Implement the fixed toolbar without a new dependency**

Create `src/components/SelectionActions.tsx`:

```tsx
import type { AssistantSelection } from "@/lib/selection-actions";
import { createPortal } from "react-dom";

interface SelectionActionsProps {
	selection: AssistantSelection;
	onAsk: (excerpt: string) => void;
	onStartWriting: (excerpt: string) => void;
}

export function SelectionActions({ selection, onAsk, onStartWriting }: SelectionActionsProps) {
	const left = Math.max(116, Math.min(window.innerWidth - 116, selection.anchor.left));
	const placeBelow = selection.anchor.top < 56;
	return createPortal(
		<div
			role="toolbar"
			aria-label="Selection actions"
			className="selection-actions"
			data-selection-actions
			data-placement={placeBelow ? "below" : "above"}
			style={{ left, top: placeBelow ? selection.anchor.bottom : selection.anchor.top }}
			onPointerDown={(event) => event.preventDefault()}
			onMouseDown={(event) => event.preventDefault()}
		>
			<button type="button" onClick={() => onAsk(selection.excerpt)}>Ask AI</button>
			<button type="button" onClick={() => onStartWriting(selection.excerpt)}>
				Start writing
			</button>
		</div>,
		document.body,
	);
}
```

Using `window.innerWidth` here is popover collision handling, not static responsive layout branching. No viewport-dependent component tree is created.

- [ ] **Step 8: Add minimal toolbar CSS**

Add to `src/App.css`:

```css
.selection-actions {
	position: fixed;
	z-index: 70;
	display: flex;
	align-items: center;
	padding: 0.25rem;
	border: 1px solid hsl(var(--border));
	border-radius: 0.75rem;
	background: hsl(var(--popover));
	box-shadow: 0 10px 30px hsl(var(--background) / 0.35);
	transform: translate(-50%, calc(-100% - 0.5rem));
}
.selection-actions[data-placement="below"] {
	transform: translate(-50%, 0.5rem);
}
.selection-actions button {
	min-height: 36px;
	padding: 0.4rem 0.7rem;
	border-radius: 0.5rem;
	font-size: 14px;
	color: hsl(var(--foreground));
}
.selection-actions button:hover,
.selection-actions button:focus-visible {
	background: hsl(var(--muted));
}
.selection-actions button:focus-visible {
	outline: 2px solid hsl(var(--ring));
	outline-offset: 1px;
}
```

No entrance animation is required. Native selection highlighting already supplies context; YAGNI avoids another motion path.

- [ ] **Step 9: Write the failing shared-shell integration test**

In `src/chat/ChatView.test.tsx`, add a `selectRenderedText` helper using `Range` and add two tests:

```ts
it.each(["chat", "work"] as const)(
	"shows one selection toolbar for assistant Markdown in %s",
	(mode) => {
		const { container } = render(
			<ChatView
				sessionFile={`/${mode}.jsonl`}
				messages={[{ id: "a", role: "assistant", content: "Selectable answer", timestamp: 1 }]}
				streamingMessage={null}
				isRunning={false}
				error={null}
				onSend={vi.fn()}
				onAbort={vi.fn()}
				mode={mode}
			/>,
		);
		selectRenderedText(container.querySelector("[data-assistant-response='a']")!);
		expect(screen.getByRole("toolbar", { name: "Selection actions" })).toBeInTheDocument();
	},
);

it("does not show selection actions for user text", () => {
	const { container } = render(
		<ChatView
			sessionFile="/chat.jsonl"
			messages={[{ id: "u", role: "user", content: "User direction", timestamp: 1 }]}
			streamingMessage={null}
			isRunning={false}
			error={null}
			onSend={vi.fn()}
			onAbort={vi.fn()}
			mode="chat"
		/>,
	);
	selectRenderedText(container.querySelector("[data-message-id='u'] .chat-markdown")!);
	expect(screen.queryByRole("toolbar", { name: "Selection actions" })).not.toBeInTheDocument();
});
```

- [ ] **Step 10: Run the integration test and verify red**

Run:

```bash
pnpm exec vitest run src/chat/ChatView.test.tsx -t "selection toolbar|selection actions"
```

Expected: FAIL because `ChatView` does not mount the hook or toolbar.

- [ ] **Step 11: Mount one controller in the stable ChatView shell**

In `src/chat/ChatView.tsx`:

1. import `SelectionActions` and `useSelectionActions`;
2. use `scrollContainerRef` as the constrained root;
3. key transient selection with `sessionKey ?? sessionFile`;
4. render one toolbar as a sibling of the scroll surface, never once per message;
5. add temporary callbacks that dismiss after activation; Task 4 and Task 5 replace their bodies.

```tsx
const { selection: selectedText, dismiss: dismissSelection } = useSelectionActions(
	scrollContainerRef,
	sessionKey ?? sessionFile,
);
```

Render near the end of `.session-center`:

```tsx
{selectedText && (
	<SelectionActions
		selection={selectedText}
		onAsk={() => dismissSelection()}
		onStartWriting={() => dismissSelection()}
	/>
)}
```

- [ ] **Step 12: Run Task 3 tests and commit**

Run:

```bash
pnpm exec vitest run src/lib/selection-actions.test.ts \
  src/hooks/useSelectionActions.test.tsx \
  src/components/SelectionActions.test.tsx \
  src/chat/ChatView.test.tsx \
  src/work/WorkSessionView.test.tsx
pnpm run typecheck
pnpm run lint
git diff --check
```

Expected: PASS.

Commit:

```bash
git add src/hooks/useSelectionActions.ts src/hooks/useSelectionActions.test.tsx \
  src/components/SelectionActions.tsx src/components/SelectionActions.test.tsx \
  src/chat/ChatView.tsx src/chat/ChatView.test.tsx src/App.css
git commit -m "feat(frontend): show accessible selection actions"
```

---

### Task 4: Add Removable Ask AI Quote Context to the Existing Composer

**Files:**
- Create: `src/components/MessageInput.selection.test.tsx`
- Modify: `src/components/MessageInput.tsx`
- Modify: `src/chat/ChatView.tsx`
- Modify: `src/chat/ChatView.test.tsx`
- Modify: `src/App.css`

- [ ] **Step 1: Write failing quote-card tests against MessageInput**

Create `src/components/MessageInput.selection.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MessageInput } from "./MessageInput";

const quoteContext = {
	excerpt: "Selected answer\nwith evidence",
	onRemove: vi.fn(),
};

describe("MessageInput selected quote context", () => {
	it("shows a removable quote card without inserting it into the editable field", () => {
		render(<MessageInput sessionFile="/a.jsonl" onSend={vi.fn()} quoteContext={quoteContext} />);
		expect(screen.getByRole("region", { name: "Quoted context" })).toHaveTextContent(
			"Selected answer with evidence",
		);
		expect(screen.getByRole("textbox")).toHaveValue("");
		expect(screen.getByRole("button", { name: "Remove quoted context" })).toBeInTheDocument();
	});

	it("does not enable sending for quote context alone", () => {
		render(<MessageInput sessionFile="/a.jsonl" onSend={vi.fn()} quoteContext={quoteContext} />);
		expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
	});

	it("requires a custom instruction while preserving files already attached", async () => {
		const user = userEvent.setup();
		const onSend = vi.fn();
		render(
			<MessageInput
				sessionFile="/a.jsonl"
				onSend={onSend}
				pendingDropFiles={[{
					path: "/work/reference.pdf",
					name: "reference.pdf",
					size: 12,
					mimeType: "application/pdf",
				}]}
				pendingDropNonce={1}
				quoteContext={{ excerpt: "Selected answer", onRemove: vi.fn() }}
			/>,
		);
		expect(await screen.findByText("reference.pdf")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
		await user.type(screen.getByRole("textbox"), "Compare this with the reference");
		await user.keyboard("{Enter}");
		expect(onSend).toHaveBeenCalledWith(
			"[File: /work/reference.pdf]\n\n> Selected answer\n\nCompare this with the reference",
		);
	});

	it("prepends the quote to a custom instruction and consumes it after send", async () => {
		const user = userEvent.setup();
		const onSend = vi.fn();
		const onRemove = vi.fn();
		render(
			<MessageInput
				sessionFile="/a.jsonl"
				onSend={onSend}
				quoteContext={{ excerpt: "Selected answer\nwith evidence", onRemove }}
			/>,
		);
		await user.type(screen.getByRole("textbox"), "Explain this");
		await user.keyboard("{Enter}");
		expect(onSend).toHaveBeenCalledWith(
			"> Selected answer\n> with evidence\n\nExplain this",
		);
		expect(onRemove).toHaveBeenCalledTimes(1);
	});

	it("removes the quote without clearing the typed instruction", async () => {
		const user = userEvent.setup();
		const onRemove = vi.fn();
		render(
			<MessageInput
				sessionFile="/a.jsonl"
				onSend={vi.fn()}
				quoteContext={{ excerpt: "Selected answer", onRemove }}
			/>,
		);
		await user.type(screen.getByRole("textbox"), "Keep this draft");
		await user.click(screen.getByRole("button", { name: "Remove quoted context" }));
		expect(onRemove).toHaveBeenCalledTimes(1);
		expect(screen.getByRole("textbox")).toHaveValue("Keep this draft");
	});
});
```

- [ ] **Step 2: Run the focused test and verify red**

Run:

```bash
pnpm exec vitest run src/components/MessageInput.selection.test.tsx
```

Expected: FAIL because `quoteContext` is not a `MessageInput` prop.

- [ ] **Step 3: Add the narrow quote prop and card**

In `src/components/MessageInput.tsx` add:

```ts
interface QuoteContext {
	excerpt: string;
	onRemove: () => void;
}

interface MessageInputProps {
	// existing props...
	quoteContext?: QuoteContext;
}
```

Destructure `quoteContext`. Render immediately above the textarea inside the existing composer shell:

```tsx
{quoteContext && (
	<div className="composer-quote" role="region" aria-label="Quoted context">
		<span aria-hidden="true">↪</span>
		<blockquote>{quoteContext.excerpt.replace(/\s+/g, " ").trim()}</blockquote>
		<button type="button" onClick={quoteContext.onRemove} aria-label="Remove quoted context">
			<X size={14} />
		</button>
	</div>
)}
```

The card is plain text. Do not render selected text as Markdown or HTML.

- [ ] **Step 4: Serialize through the existing submit transaction**

Import `formatSelectionPrompt`. In `handleSubmit`, keep attachments/images assembled as today, then transform only when both quote context and a non-empty custom instruction exist:

```ts
const instruction = trimmed;
const quotedPrompt = quoteContext
	? formatSelectionPrompt(quoteContext.excerpt, instruction)
	: instruction;

let finalPrompt = sections.join("\n");
if (quotedPrompt) {
	finalPrompt = finalPrompt ? `${finalPrompt}\n\n${quotedPrompt}` : quotedPrompt;
}
```

When `quoteContext` exists, require non-empty custom text before submission even if files/images were already attached; quote context alone is not an instruction. Without quote context, retain the current `text || files || images` rule:

```ts
const hasContent = quoteContext
	? !!text.trim()
	: !!(text.trim() || attachedFiles.length > 0 || pastedImages.length > 0);
```

Preserve all pending attachments/images and serialize their existing markers before the Markdown quote. After a handler is found and called, call `quoteContext?.onRemove()` with the existing clear/refocus operations. If the relevant handler is absent, do not clear text, attachments, images, or quote context.

This preserves existing idle/steer/follow-up behavior automatically for Ask AI.

- [ ] **Step 5: Add quote-card CSS**

Add to `src/App.css`:

```css
.composer-quote {
	display: grid;
	grid-template-columns: auto minmax(0, 1fr) auto;
	align-items: start;
	gap: 0.5rem;
	margin: 0.65rem 0.75rem 0;
	padding: 0.55rem 0.65rem;
	border-left: 2px solid hsl(var(--primary));
	border-radius: 0.5rem;
	background: hsl(var(--muted) / 0.55);
	color: hsl(var(--muted-foreground));
	font-size: 13px;
}
.composer-quote blockquote {
	display: -webkit-box;
	overflow: hidden;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 3;
}
.composer-quote button {
	border-radius: 0.35rem;
	padding: 0.2rem;
}
.composer-quote button:focus-visible {
	outline: 2px solid hsl(var(--ring));
	outline-offset: 1px;
}
```

- [ ] **Step 6: Run MessageInput tests**

Run:

```bash
pnpm exec vitest run src/components/MessageInput.selection.test.tsx \
  src/components/MessageInput.test.tsx \
  src/components/MessageInput.steering.test.tsx \
  src/components/MessageInput.queue.test.tsx \
  src/components/MessageInput.paste.test.tsx \
  src/components/CommandPalette.test.tsx
```

Expected: PASS. Existing attachment/image ordering, Enter routing, `Alt+Enter`, `Shift+Enter`, `Ctrl+↑`, and slash-command tests stay green.

- [ ] **Step 7: Write the failing Ask AI ChatView integration test**

Add to `src/chat/ChatView.test.tsx`:

```ts
it.each(["chat", "work"] as const)(
	"Ask AI creates one removable quote and focuses the composer in %s",
	async (mode) => {
		const user = userEvent.setup();
		const { container } = render(
			<ChatView
				sessionFile={`/${mode}.jsonl`}
				sessionKey={`/${mode}.jsonl`}
				messages={[{ id: "a", role: "assistant", content: "Selected answer", timestamp: 1 }]}
				streamingMessage={null}
				isRunning={false}
				error={null}
				onSend={vi.fn()}
				onAbort={vi.fn()}
				mode={mode}
			/>,
		);
		selectRenderedText(container.querySelector("[data-assistant-response='a']")!);
		await user.click(screen.getByRole("button", { name: "Ask AI" }));
		expect(screen.queryByRole("toolbar", { name: "Selection actions" })).not.toBeInTheDocument();
		expect(screen.getByRole("region", { name: "Quoted context" })).toHaveTextContent(
			"Selected answer",
		);
		expect(screen.getByRole("textbox")).toHaveFocus();
		expect(screen.getByRole("textbox")).toHaveValue("");
	},
);
```

Add the synchronous session-owner regression:

```ts
it("never renders quoted context in a different session", async () => {
	const user = userEvent.setup();
	const props = {
		messages: [{ id: "a", role: "assistant" as const, content: "Selected answer", timestamp: 1 }],
		streamingMessage: null,
		isRunning: false,
		error: null,
		onSend: vi.fn(),
		onAbort: vi.fn(),
	};
	const view = render(<ChatView {...props} sessionFile="/a.jsonl" sessionKey="/a.jsonl" />);
	selectRenderedText(view.container.querySelector("[data-assistant-response='a']")!);
	await user.click(screen.getByRole("button", { name: "Ask AI" }));
	expect(screen.getByRole("region", { name: "Quoted context" })).toBeInTheDocument();
	view.rerender(<ChatView {...props} sessionFile="/b.jsonl" sessionKey="/b.jsonl" />);
	expect(screen.queryByRole("region", { name: "Quoted context" })).not.toBeInTheDocument();
});
```

- [ ] **Step 8: Run the ChatView test and verify red**

Run:

```bash
pnpm exec vitest run src/chat/ChatView.test.tsx -t "Ask AI|clears quote"
```

Expected: FAIL because Task 3's Ask callback only dismisses.

- [ ] **Step 9: Own transient quote context in ChatView**

In `src/chat/ChatView.tsx` add:

```ts
const activeSessionKey = sessionKey ?? sessionFile;
const [storedQuote, setStoredQuote] = useState<{ excerpt: string; sessionKey: string } | null>(null);
const quoteContext = storedQuote?.sessionKey === activeSessionKey ? storedQuote.excerpt : null;

const handleAskSelection = useCallback((excerpt: string) => {
	setStoredQuote({ excerpt, sessionKey: activeSessionKey });
	dismissSelection();
	requestAnimationFrame(() => inputRef.current?.focus());
}, [activeSessionKey, dismissSelection]);
```

Wire toolbar `onAsk={handleAskSelection}`. Pass to the existing `MessageInput`:

```tsx
quoteContext={
	quoteContext
		? { excerpt: quoteContext, onRemove: () => setStoredQuote(null) }
		: undefined
}
```

Do not put quote state in `App`, keyed stream state, sidecar metadata, or session snapshots. Comparing the stored owner to `activeSessionKey` hides stale quote state during the session-change render itself; an effect-only cleanup is insufficient because effects run after paint.

- [ ] **Step 10: Run Task 4 checks and commit**

Run:

```bash
pnpm exec vitest run src/components/MessageInput.selection.test.tsx \
  src/components/MessageInput.test.tsx \
  src/components/MessageInput.steering.test.tsx \
  src/components/MessageInput.queue.test.tsx \
  src/components/MessageInput.paste.test.tsx \
  src/components/CommandPalette.test.tsx \
  src/chat/ChatView.test.tsx
pnpm run typecheck
pnpm run lint
git diff --check
```

Expected: PASS.

Commit:

```bash
git add src/components/MessageInput.tsx src/components/MessageInput.selection.test.tsx \
  src/chat/ChatView.tsx src/chat/ChatView.test.tsx src/App.css
git commit -m "feat(frontend): add Ask AI quoted composer context"
```

---

### Task 5: Route Start Writing Through Existing Keyed Send and Follow-Up Paths

**Files:**
- Modify: `src/chat/ChatView.tsx`
- Modify: `src/chat/ChatView.test.tsx`
- Modify: `src/App.sessions.test.tsx`

- [ ] **Step 1: Write failing idle and running routing tests**

Add separate tests to `src/chat/ChatView.test.tsx`:

```ts
it("Start writing immediately sends a quoted normal turn while idle", async () => {
	const user = userEvent.setup();
	const onSend = vi.fn();
	const onFollowUp = vi.fn();
	const { container } = render(
		<ChatView
			sessionFile="/a.jsonl"
			messages={[{ id: "a", role: "assistant", content: "Selected answer", timestamp: 1 }]}
			streamingMessage={null}
			isRunning={false}
			error={null}
			onSend={onSend}
			onAbort={vi.fn()}
			onFollowUp={onFollowUp}
		/>,
	);
	selectRenderedText(container.querySelector("[data-assistant-response='a']")!);
	await user.click(screen.getByRole("button", { name: "Start writing" }));
	expect(onSend).toHaveBeenCalledWith(
		"> Selected answer\n\nStart writing from this excerpt.",
	);
	expect(onFollowUp).not.toHaveBeenCalled();
});

it("Start writing queues a quoted follow-up while the selected session is running", async () => {
	const user = userEvent.setup();
	const onSend = vi.fn();
	const onFollowUp = vi.fn();
	const { container } = render(
		<ChatView
			sessionFile="/a.jsonl"
			messages={[{ id: "a", role: "assistant", content: "Selected answer", timestamp: 1 }]}
			streamingMessage={null}
			isRunning
			error={null}
			onSend={onSend}
			onAbort={vi.fn()}
			onFollowUp={onFollowUp}
		/>,
	);
	selectRenderedText(container.querySelector("[data-assistant-response='a']")!);
	await user.click(screen.getByRole("button", { name: "Start writing" }));
	expect(onFollowUp).toHaveBeenCalledWith(
		"> Selected answer\n\nStart writing from this excerpt.",
	);
	expect(onSend).not.toHaveBeenCalled();
});

it("Start writing does nothing when the required running follow-up handler is absent", async () => {
	const user = userEvent.setup();
	const onSend = vi.fn();
	const { container } = render(
		<ChatView
			sessionFile="/a.jsonl"
			messages={[{ id: "a", role: "assistant", content: "Selected answer", timestamp: 1 }]}
			streamingMessage={null}
			isRunning
			error={null}
			onSend={onSend}
			onAbort={vi.fn()}
		/>,
	);
	selectRenderedText(container.querySelector("[data-assistant-response='a']")!);
	await user.click(screen.getByRole("button", { name: "Start writing" }));
	expect(onSend).not.toHaveBeenCalled();
	expect(screen.getByRole("toolbar", { name: "Selection actions" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run focused tests and verify red**

Run:

```bash
pnpm exec vitest run src/chat/ChatView.test.tsx -t "Start writing"
```

Expected: FAIL because Task 3 only dismisses Start writing.

- [ ] **Step 3: Implement one explicit Start writing router in ChatView**

Import `formatSelectionPrompt` and `START_WRITING_INSTRUCTION` from `src/lib/selection-actions.ts` and add:

```ts
const handleStartWriting = useCallback((excerpt: string) => {
	const prompt = formatSelectionPrompt(excerpt, START_WRITING_INSTRUCTION);
	if (!prompt) return;
	if (isRunning) {
		if (!onFollowUp) return;
		onFollowUp(prompt);
	} else {
		onSend(prompt);
	}
	dismissSelection();
}, [dismissSelection, isRunning, onFollowUp, onSend]);
```

Wire `onStartWriting={handleStartWriting}`. Do not call `onSteer`; do not add `startWritingStream`; do not invoke Tauri directly.

- [ ] **Step 4: Run ChatView routing tests**

Run:

```bash
pnpm exec vitest run src/chat/ChatView.test.tsx -t "Start writing"
```

Expected: PASS.

- [ ] **Step 5: Prove active-session targeting at the App seam**

Extend the existing `ChatView` mock in `src/App.sessions.test.tsx` to destructure the already-public `onFollowUp` callback. Add two test-only buttons that call the existing `onSend` and `onFollowUp` props with the exact serialized Start writing payload. Do not add a production prop:

```tsx
<button type="button" onClick={() => onSend("> quote\n\nStart writing from this excerpt.")}>idle-start-writing</button>
<button type="button" onClick={() => onFollowUp?.("> quote\n\nStart writing from this excerpt.")}>running-start-writing</button>
```

Add tests:

```ts
it("targets idle Start writing to the active session only", async () => {
	controller.states = new Map([
		["/a.jsonl", streamState("/a.jsonl", "A history")],
		["/b.jsonl", streamState("/b.jsonl", "B history")],
	]);
	controller.entries = [
		{ file: "/a.jsonl", title: "A", messageCount: 1, createdAt: 1, lastActivity: 2 },
		{ file: "/b.jsonl", title: "B", messageCount: 1, createdAt: 1, lastActivity: 2 },
	];
	render(<App />);
	fireEvent.click(await screen.findByRole("button", { name: "select /b.jsonl" }));
	fireEvent.click(screen.getByText("idle-start-writing"));
	await waitFor(() => expect(controller.startStream).toHaveBeenCalledWith(
		"/b.jsonl",
		"> quote\n\nStart writing from this excerpt.",
	));
	expect(controller.startStream).not.toHaveBeenCalledWith("/a.jsonl", expect.anything());
});

it("targets running Start writing to the active session follow-up only", async () => {
	controller.states = new Map([
		["/a.jsonl", streamState("/a.jsonl", "A running", { running: true })],
	]);
	controller.entries = [
		{ file: "/a.jsonl", title: "A", messageCount: 1, createdAt: 1, lastActivity: 2 },
	];
	render(<App />);
	fireEvent.click(await screen.findByRole("button", { name: "select /a.jsonl" }));
	fireEvent.click(screen.getByText("running-start-writing"));
	expect(controller.followUpStream).toHaveBeenCalledWith(
		"/a.jsonl",
		"> quote\n\nStart writing from this excerpt.",
	);
	expect(controller.startStream).not.toHaveBeenCalled();
});
```

These tests verify existing App closures, not a new production action API.

- [ ] **Step 6: Run concurrency and queue regressions**

Run:

```bash
pnpm exec vitest run src/App.sessions.test.tsx \
  src/chat/ChatView.test.tsx \
  src/components/MessageInput.steering.test.tsx \
  src/components/MessageInput.queue.test.tsx \
  src/hooks/usePiStream.session.test.ts
```

Expected: PASS. No event transport, keyed reducer, or queue implementation changes.

- [ ] **Step 7: Commit Start writing**

```bash
git add src/chat/ChatView.tsx src/chat/ChatView.test.tsx src/App.sessions.test.tsx
git commit -m "feat(frontend): route Start writing by session status"
```

The `src/App.sessions.test.tsx` change is test-harness-only and must not add a production callback.

---

### Task 6: Close the Native Artifact Handle-Binding Gap

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `Cargo.lock`

This task intentionally adds one backend security dependency. The design non-goal forbids new state/UI dependencies, not a capability filesystem primitive required to close a trust-boundary race. Do not implement platform-specific unsafe FFI or a second artifact API.

- [ ] **Step 1: Add a failing handle-stability test**

In `src-tauri/src/lib.rs` tests, first define the desired seam through `open_authorized_artifact` and write a Unix test that opens the capability handle before replacing the visible path:

```rust
#[cfg(unix)]
#[test]
fn authorized_artifact_handle_stays_bound_after_path_replacement() {
    let base = std::env::temp_dir().join(format!(
        "cowork-artifact-handle-{}-{}",
        std::process::id(),
        rand::random::<u64>()
    ));
    let root = base.join("workspace");
    std::fs::create_dir_all(&root).unwrap();
    let file = root.join("report.md");
    std::fs::write(&file, "inside").unwrap();

    let mut handle = open_authorized_artifact(&root, &file).unwrap();
    std::fs::rename(&file, root.join("original.md")).unwrap();
    std::fs::write(&file, "replacement").unwrap();

    let mut content = String::new();
    use std::io::Read;
    handle.read_to_string(&mut content).unwrap();
    assert_eq!(content, "inside");
    std::fs::remove_dir_all(base).unwrap();
}
```

Also add/retain separate tests for:

- absolute parent escape;
- `..` relative escape;
- symlink final-component escape;
- symlink parent-directory escape;
- directory rejection;
- missing file;
- file larger than `MAX_ARTIFACT_BYTES`;
- ordinary in-workspace file and MIME result.

- [ ] **Step 2: Run the focused Rust test and verify red**

Run:

```bash
cargo test --workspace authorized_artifact_handle_stays_bound_after_path_replacement -- --exact
```

Expected: FAIL because `open_authorized_artifact` does not exist.

- [ ] **Step 3: Add the capability dependency**

Add the capability dependency and update the existing logging plugin to the release whose graph no longer includes unused `byte-unit → rust_decimal → rkyv 0.7` optional packages:

```toml
cap-std = "4.0.2"
tauri-plugin-log = "2.9.0"
```

Run:

```bash
cargo update -p tauri-plugin-log --precise 2.9.0
cargo check --workspace
```

Inspect `Cargo.lock`. `tauri-plugin-log 2.8.0` currently reaches `byte-unit 5.2.0`, whose `rust_decimal` package metadata locks unsupported vulnerable `rkyv 0.7.46` even though that feature is inactive. `tauri-plugin-log 2.9.0` removes the unused `byte-unit` dependency. The regenerated resolution must remove that chain. Do not add an audit ignore or force incompatible `rkyv 0.8` under a crate requesting 0.7.

- [ ] **Step 4: Implement lexical relative-path validation**

In `src-tauri/src/lib.rs`, import:

```rust
use cap_std::ambient_authority;
use cap_std::fs::{Dir, File as CapFile};
```

Replace the pathname-canonicalized file helper with:

```rust
fn workspace_relative_path(workspace: &Path, requested: &Path) -> Result<PathBuf, String> {
    let root = std::fs::canonicalize(workspace)
        .map_err(|_| "Workspace unavailable".to_string())?;
    let relative = if requested.is_absolute() {
        requested
            .strip_prefix(&root)
            .map_err(|_| "File unavailable".to_string())?
            .to_path_buf()
    } else {
        requested.to_path_buf()
    };
    if relative.as_os_str().is_empty()
        || relative.components().any(|component| {
            !matches!(component, std::path::Component::Normal(_))
        })
    {
        return Err("File unavailable".to_string());
    }
    Ok(relative)
}

fn open_authorized_artifact(workspace: &Path, requested: &Path) -> Result<CapFile, String> {
    let root = std::fs::canonicalize(workspace)
        .map_err(|_| "Workspace unavailable".to_string())?;
    let relative = workspace_relative_path(&root, requested)?;
    let directory = Dir::open_ambient_dir(&root, ambient_authority())
        .map_err(|_| "Workspace unavailable".to_string())?;
    let handle = directory
        .open(&relative)
        .map_err(|_| "File unavailable".to_string())?;
    if !handle
        .metadata()
        .map_err(|_| "File unavailable".to_string())?
        .is_file()
    {
        return Err("File unavailable".to_string());
    }
    Ok(handle)
}
```

`Dir::open` performs capability-relative resolution. It must reject absolute paths, `..`, and symlink escapes at the filesystem boundary. Do not canonicalize the requested pathname after opening and do not reopen it for reading.

- [ ] **Step 5: Read bytes through the same capability handle**

Rewrite `read_authorized_artifact` to call `open_authorized_artifact`, apply `take(MAX_ARTIFACT_BYTES + 1)` to that handle, reject oversized bytes, and derive MIME only from the requested display path:

```rust
fn read_authorized_artifact(workspace: &Path, requested: &Path) -> Result<ArtifactFile, String> {
    use std::io::Read;
    let mut handle = open_authorized_artifact(workspace, requested)?;
    let mut bytes = Vec::new();
    handle
        .by_ref()
        .take(MAX_ARTIFACT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "File unavailable".to_string())?;
    if bytes.len() as u64 > MAX_ARTIFACT_BYTES {
        return Err("File unavailable".to_string());
    }
    Ok(ArtifactFile {
        mime_type: mime_guess::from_path(requested)
            .first_or(mime_guess::mime::APPLICATION_OCTET_STREAM)
            .to_string(),
        bytes,
    })
}
```

Keep `read_workspace_artifact` on `spawn_blocking`. Keep `open_workspace_folder` separate because opening a parent in the OS file manager has different semantics and returns no file bytes.

- [ ] **Step 6: Run the Rust security tests**

Run:

```bash
cargo test --workspace workspace_artifact -- --nocapture
cargo test --workspace authorized_artifact -- --nocapture
cargo fmt --check
cargo clippy --workspace -- -D warnings
```

Expected: PASS. Symlink escapes and traversal fail as `File unavailable`; in-workspace regular files pass; the handle-stability test reads `inside`, not `replacement`.

- [ ] **Step 7: Verify dependency and lock scope**

Run:

```bash
cargo tree -p zosma-cowork | rg 'cap-std|tauri-plugin-log'
cargo tree --target all -i rkyv@0.7.46 || true
! rg -U -n 'name = "rkyv"\nversion = "0\.7\.46"' Cargo.lock
git diff -- src-tauri/Cargo.toml Cargo.lock
```

Expected:

- `cap-std v4.0.2` and `tauri-plugin-log v2.9.0` are present;
- `byte-unit`, `rust_decimal`, and `rkyv 0.7.46` are absent unless another active dependency independently requires them;
- no unrelated direct Rust dependency was added.

- [ ] **Step 8: Commit native hardening**

```bash
git add src-tauri/Cargo.toml src-tauri/src/lib.rs Cargo.lock
git commit -m "fix(security): bind artifact reads to workspace handles"
```

---

### Task 7: Remove Known Audit and Production-Build Warnings

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `agent-sidecar/package.json`
- Modify: `agent-sidecar/pnpm-lock.yaml`
- Modify: `src/chat/ChatView.tsx`
- Modify: `src/components/MessageInput.tsx`
- Modify: `src/components/ChatMessage.tsx`
- Modify: `src/components/settings/Workspace.tsx`
- Modify: `src/hooks/useAppUpdate.ts`
- Modify: `vite.config.ts`

#### 7A: Dependency findings

- [ ] **Step 1: Capture the current failing audits before edits**

Run:

```bash
pnpm audit --audit-level=moderate 2>&1 | tee /tmp/cowork-frontend-audit-before.txt
(cd agent-sidecar && pnpm audit --audit-level=moderate) \
  2>&1 | tee /tmp/cowork-sidecar-audit-before.txt
```

Expected before remediation: non-zero with current PostCSS/Nanoid, JSDOM/Undici, Workbox/Fast-URI/Brace-Expansion, and sidecar Pi/Vite transitive findings. This is the red release check.

- [ ] **Step 2: Add exact patched transitive resolutions**

In root `package.json`, update direct PostCSS and add pnpm overrides:

```json
"postcss": "^8.5.26"
```

```json
"pnpm": {
  "overrides": {
    "brace-expansion@2": "2.1.4",
    "brace-expansion@5": "5.0.9",
    "fast-uri@3": "3.1.5",
    "nanoid@3": "3.3.17",
    "undici@7": "7.29.0"
  }
}
```

In `agent-sidecar/package.json`, add:

```json
"pnpm": {
  "overrides": {
    "brace-expansion@5": "5.0.9",
    "nanoid@3": "3.3.17",
    "postcss@8": "8.5.26",
    "undici@8": "8.9.0"
  }
}
```

These are patched package substitutions, not audit ignores. Do not add `auditConfig`, `ignoreCves`, `allowedAdvisories`, or a severity downgrade.

- [ ] **Step 3: Regenerate both lockfiles**

Run:

```bash
pnpm install --lockfile-only
(cd agent-sidecar && pnpm install --lockfile-only)
```

Expected: only manifests/lockfiles change; no source changes.

- [ ] **Step 4: Run audits and behavior checks**

Run:

```bash
pnpm audit --audit-level=moderate
(cd agent-sidecar && pnpm audit --audit-level=moderate)
pnpm exec vitest run
(cd agent-sidecar && pnpm test && pnpm build)
```

Expected: both audits exit zero and all frontend/sidecar tests/build pass. If an override is incompatible, do not ignore the advisory; update the nearest direct dependency to a release whose declared range accepts the patched transitive, then rerun all checks.

#### 7B: Mixed dynamic/static Tauri imports

- [ ] **Step 5: Capture current build warnings**

Run:

```bash
pnpm run build:frontend 2>&1 | tee /tmp/cowork-build-before.txt
rg -n 'dynamically imported|larger than 500 kB' /tmp/cowork-build-before.txt
```

Expected before remediation: mixed `@tauri-apps/api/core` and dialog import warnings plus a chunk-size warning.

- [ ] **Step 6: Make imports consistent**

Use existing installed dependencies and static imports:

- `src/chat/ChatView.tsx`: add `import { invoke } from "@tauri-apps/api/core"`; remove the dynamic core import inside file-drop handling.
- `src/components/MessageInput.tsx`: add static `invoke` and `open`; remove both dynamic imports.
- `src/components/ChatMessage.tsx`: add `save` to a static `@tauri-apps/plugin-dialog` import; remove its dynamic import.
- `src/components/settings/Workspace.tsx`: statically import `open`; remove its dynamic import.
- `src/hooks/useAppUpdate.ts`: statically import `invoke`; keep updater/process dynamic because those optional heavy features are not statically imported by application code.

Do not change error handling or call signatures.

- [ ] **Step 7: Split existing large dependency families**

Add to `vite.config.ts`:

```ts
build: {
	rollupOptions: {
		output: {
			manualChunks(id) {
				if (!id.includes("node_modules")) return;
				if (id.includes("@uiw+") || id.includes("@uiw/")) return "editor";
				if (id.includes("@sentry+") || id.includes("@sentry/")) return "telemetry";
				if (
					id.includes("react-markdown") ||
					id.includes("remark-") ||
					id.includes("rehype-") ||
					id.includes("micromark") ||
					id.includes("/unified@")
				) return "markdown";
			},
		},
	},
},
```

Do not raise `chunkSizeWarningLimit`. The repository target is below 500 KiB gzip; splitting work must improve the bundle rather than suppress the warning.

- [ ] **Step 8: Run focused import and build checks**

Run:

```bash
rg -n 'await import\("@tauri-apps/api/core"\)|await import\("@tauri-apps/plugin-dialog"\)' \
  src --glob '*.{ts,tsx}'
pnpm run typecheck
pnpm run build:frontend 2>&1 | tee /tmp/cowork-build-after.txt
! rg -n 'dynamically imported|larger than 500 kB' /tmp/cowork-build-after.txt
```

Expected:

- no production dynamic core/dialog imports remain;
- build succeeds;
- no mixed-import warning;
- no chunk exceeds Rollup's 500 kB warning threshold;
- emitted gzip sizes are recorded in the execution report.

If the first chunk grouping still exceeds 500 kB, split only the reported existing dependency family (for example `qrcode` or syntax-highlighting packages) into another named chunk. Do not lazy-load or restructure unrelated product screens unless the build output proves dependency grouping cannot satisfy the threshold.

- [ ] **Step 9: Run full frontend/sidecar checks and commit**

Run:

```bash
pnpm run validate
pnpm run build:frontend
(cd agent-sidecar && pnpm test && pnpm build)
git diff --check
```

Expected: PASS without build warnings.

Commit:

```bash
git add package.json pnpm-lock.yaml agent-sidecar/package.json agent-sidecar/pnpm-lock.yaml \
  src/chat/ChatView.tsx src/components/MessageInput.tsx src/components/ChatMessage.tsx \
  src/components/settings/Workspace.tsx src/hooks/useAppUpdate.ts vite.config.ts
git commit -m "chore: clear release dependency and build warnings"
```

---

### Task 8: Validate the Complete Five-Phase Release Boundary

**Files:**
- Modify only files required by a newly reproduced failing regression.
- Do not create a release checklist component, new E2E framework, audit allowlist, or implementation summary file.

- [ ] **Step 1: Run selection-action regression matrix**

```bash
pnpm exec vitest run \
  src/lib/selection-actions.test.ts \
  src/hooks/useSelectionActions.test.tsx \
  src/components/SelectionActions.test.tsx \
  src/components/MessageInput.selection.test.tsx \
  src/components/MessageInput.test.tsx \
  src/components/MessageInput.steering.test.tsx \
  src/components/MessageInput.queue.test.tsx \
  src/components/MessageInput.paste.test.tsx \
  src/components/CommandPalette.test.tsx \
  src/chat/ChatView.test.tsx \
  src/work/WorkSessionView.test.tsx \
  src/App.sessions.test.tsx
```

Expected:

- valid Chat/Work assistant selections show one toolbar;
- invalid/cross-root/user selections do not;
- Ask AI quotes without sending;
- Start writing sends idle or follows up running;
- Enter/Alt+Enter/Shift+Enter/Ctrl+↑ remain unchanged;
- session changes clear transient action/quote state.

- [ ] **Step 2: Run all automated project gates**

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

- frontend lint/styles/typecheck and all tests pass;
- frontend production build succeeds without warnings;
- sidecar tests/build pass;
- Rust fmt/clippy/tests pass;
- no whitespace errors.

Any behavior fix requires one smallest failing regression test first. Config/lockfile-only remediation may use the command failure itself as the red check.

- [ ] **Step 3: Run security gates without exceptions**

```bash
pnpm audit --audit-level=moderate
(cd agent-sidecar && pnpm audit --audit-level=moderate)
cargo tree --target all -i rkyv@0.7.46 || true
rg -n 'auditConfig|ignoreCves|allowedAdvisories|allowlist' \
  package.json agent-sidecar/package.json .github src-tauri || true
rg -n 'cap_std|open_authorized_artifact|MAX_ARTIFACT_BYTES|read_workspace_artifact' \
  src-tauri/src/lib.rs src-tauri/Cargo.toml
```

Expected:

- both npm audits exit zero;
- vulnerable stale `rkyv 0.7.46` has no lock entry/reverse dependency;
- no audit exception was added;
- capability-scoped handle read and byte cap are present.

If `cargo-audit` is available, run:

```bash
cargo audit
```

If unavailable, record `cargo-audit: not installed` and require the existing GitHub security job to pass before Phase 5 is accepted. Do not install a global tool without explicit user permission.

- [ ] **Step 4: Verify scope and architecture statically**

```bash
rg -n 'SelectionActions|Ask AI|Start writing|data-assistant-response|quoteContext' \
  src --glob '*.{ts,tsx}'
rg -n 'session_event|settledVersion|awaitingDone|removeSession|abortStream' \
  src/hooks/usePiStream.ts src/App.tsx
rg -n 'contentEditable|document editor|clipping|artifact database|runtime UUID|replay cursor|sequence' \
  src agent-sidecar/src src-tauri/src --glob '!**/*.test.*' || true
rg -n '<MessageInput' src --glob '*.tsx'
rg -n 'innerWidth|matchMedia|ResizeObserver' \
  src/App.tsx src/chat/ChatView.tsx src/work src/components/WorkPanel.tsx
```

Confirm:

1. One selection controller exists in `ChatView`, not per message.
2. One `MessageInput` remains under one stable parent.
3. No selection persistence or protocol type exists.
4. Start writing calls only passed send/follow-up callbacks.
5. The only `innerWidth` use added by Phase 5 clamps fixed popover position and does not branch the component layout.
6. Outputs/Sources remain message projections.
7. No excluded product surface or editor exists.

- [ ] **Step 5: Measure cached switching against 100 ms**

First run deterministic no-I/O tests:

```bash
pnpm exec vitest run src/App.sessions.test.tsx -t "switches to a cached session"
pnpm exec vitest run src/hooks/usePiStream.session.test.ts -t "cached|hidden|switch"
```

Expected: switching loaded sessions sends no `load_session`, no abort, and renders the cached target.

During desktop acceptance, measure 20 loaded-session switches using browser Performance marks around the sidebar click and next painted active message (`requestAnimationFrame`). Record median and maximum. Acceptance requires every measured loaded switch under 100 ms on the current machine and zero backend load calls. Do not add permanent runtime instrumentation solely for this measurement.

- [ ] **Step 6: Run complete interactive desktop acceptance when GUI inspection is available**

Start:

```bash
pnpm run dev
```

Verify in order:

1. Create Empty Work, type a draft, switch Chat/Work, and confirm draft/files/focus survive.
2. Send first Work prompt; mode persists before prompt and locks afterward.
3. Start Work A, switch to Chat B, start B; both sidebar running indicators remain accurate.
4. Return to A from cache under 100 ms; steer A; B continues unchanged.
5. Work document, task title, compact directions, quiet activity, composer, Outputs, and Sources remain correct live and after reload.
6. Select text wholly inside one Chat assistant Markdown response; toolbar appears above/below selection without clipping.
7. Select user text, sidebar text, composer text, tool detail text, and a range crossing two assistant responses; no toolbar appears.
8. Create a keyboard selection inside assistant Markdown; Tab reaches Ask AI then Start writing; visible focus ring appears.
9. Press Escape, click elsewhere, collapse selection, and scroll the message container; toolbar closes each time.
10. Activate Ask AI; selected highlight survives button activation long enough to capture the excerpt, toolbar closes, quote card appears, textarea is empty and focused, and no prompt is sent.
11. Remove quote card; typed instruction remains. Select again, type a custom question, send, and confirm persisted user text is a Markdown quote plus the question.
12. While running, Ask AI + Enter steers; Ask AI + `Alt+Enter` queues follow-up; `Shift+Enter` inserts newline; `Ctrl+↑` queue editing remains scoped.
13. Activate Start writing while idle; one normal prompt starts immediately with the quote plus `Start writing from this excerpt.`
14. Activate Start writing while running; one follow-up is queued in that session, current work is not interrupted, and no steering entry is created.
15. Repeat Ask AI and Start writing in Active Work; behavior matches Chat.
16. Switch sessions with an open toolbar or quote card; neither leaks into the next session.
17. Verify attachments, paste, voice, file mention/drop, model selection, slash commands, abort, retry, and in-thread find still work.
18. Preview allowed output files; moved/missing/outside/symlink-escape/oversized files remain unavailable. HTML and SVG previews remain inert.
19. Wide/medium/narrow Work layouts retain docked/drawer behavior; mobile sidebar and Work panel remain mutually exclusive; drawer focus returns correctly.
20. At narrow width, selection toolbar remains inside viewport. At 100%, all font scales, and 200% zoom, toolbar/card controls remain readable and reachable.
21. Enable reduced motion; drawers and existing animations stop, and the non-animated selection toolbar remains usable.
22. Restart/reload sessions; modes, messages, outputs, and sources persist, while transient selection/quote UI does not.

Record environment/tool limitations rather than claiming any unperformed step.

- [ ] **Step 7: Verify release build output and PR checks**

```bash
pnpm run build:frontend 2>&1 | tee /tmp/cowork-final-build.txt
! rg -n 'warning|dynamically imported|larger than 500 kB' /tmp/cowork-final-build.txt
```

After pushing in Step 10, inspect GitHub checks:

```bash
gh pr checks 354
```

Required before acceptance: frontend, sidecar, Rust, and security jobs pass. Existing workflow infrastructure failures may be retried, but product/security failures must be fixed test-first.

- [ ] **Step 8: Inspect the complete Phase 5 diff directly**

`code_review` is intentionally not required. Run direct checks:

```bash
git diff 42f5c07f2 --stat
git diff 42f5c07f2 -- \
  src/lib/selection-actions.ts \
  src/hooks/useSelectionActions.ts \
  src/components/SelectionActions.tsx \
  src/components/MessageInput.tsx \
  src/chat/ChatView.tsx \
  src/components/ChatMessage.tsx \
  src/work/WorkSessionView.tsx \
  src-tauri/src/lib.rs \
  package.json agent-sidecar/package.json vite.config.ts
```

Review specifically:

- exact one-root selection containment;
- no user/tool/sidebar/composer selection path;
- snapshot captured before focus changes;
- Ask AI does not send;
- Start writing idle/running route;
- quote formatting and plain-text card rendering;
- handler-absent no-op does not clear user state;
- session switch cleanup;
- capability-relative native open and same-handle read;
- no audit exceptions;
- stable composer, keyed stream, and Phase 1–4 contracts.

Use one active-session `fusion` critique only if a second security/accessibility perspective is useful. Treat findings as hypotheses and verify each against repository code/tests before changing anything.

- [ ] **Step 9: Commit only newly verified final fixes**

If Steps 1–8 expose a regression, add one failing test, verify red, apply the minimum fix, rerun relevant/full gates, then commit:

```bash
git add <failing regression test and minimum fix files>
git commit -m "fix: harden selected text actions"
```

If no fix is needed, create no empty commit.

- [ ] **Step 10: Push while preserving draft PR state**

```bash
git status --short
git log --oneline 42f5c07f2..HEAD
git push origin feat/chat-work-phase-1-runtime-identity
test "$(git rev-parse HEAD)" = \
  "$(git rev-parse origin/feat/chat-work-phase-1-runtime-identity)"
gh pr view 354 --json isDraft,state,mergedAt,headRefName,url
gh pr checks 354
```

Expected:

- clean worktree;
- origin matches HEAD;
- PR #354 remains `OPEN`, `isDraft: true`, `mergedAt: null`;
- all required checks, including security, pass.

Do not mark ready, rebase onto `main`, close, merge, or alter the PR's draft state.

---

## Execution Checkpoints

1. **After Task 1:** quote serialization is literal Markdown and invalid selections return null through a pure seam.
2. **After Task 2:** only assistant Markdown roots are marked in Chat and Work.
3. **After Task 3:** one stable-shell controller shows an accessible native-selection toolbar and dismisses correctly.
4. **After Task 4:** Ask AI produces one removable plain-text quote card, focuses an empty field, and sends only after custom input.
5. **After Task 5:** Start writing routes idle to send and running to follow-up for the active keyed session only.
6. **After Task 6:** artifact bytes come from a workspace capability and the same opened handle, with traversal/symlink/size tests.
7. **After Task 7:** npm audits exit zero and frontend build emits no mixed-import or oversized-chunk warnings.
8. **After Task 8:** full automated/security/desktop acceptance passes and PR #354 stays draft/unmerged.

## Phase 5 Completion Criteria

Phase 5 and the five-phase Chat/Work roadmap are complete only when:

- selecting non-empty text wholly inside one assistant Markdown response shows one contextual toolbar;
- selections across roots or inside user/system/tool/sidebar/panel/composer UI never show actions;
- toolbar buttons are keyboard reachable, visibly focused, and activation captures the excerpt without premature selection loss;
- selection collapse, Escape, outside interaction, scrolling, and session change dismiss transient UI;
- Ask AI creates one removable plain-text quote card, focuses an empty composer field, and sends nothing until the user submits content;
- Ask AI's eventual persisted message is a Markdown quote followed by the custom instruction;
- existing idle send, running steer, running follow-up, queue editing, attachments, images, voice, files, models, and slash commands remain unchanged;
- Start writing persists a Markdown quote plus `Start writing from this excerpt.`;
- Start writing starts a normal turn while idle and queues only a follow-up while running;
- both actions target the active canonical `sessionFile` and cannot leak across cached sessions;
- Chat and Work share behavior while retaining their existing visual renderers;
- one stable `MessageInput` remains mounted and no quote/selection protocol or persistence format is introduced;
- artifact reads are capability-relative, regular-file-only, size-capped, and read through the authorized opened handle;
- frontend and sidecar npm audits have zero moderate-or-higher findings without ignores;
- Cargo security CI passes and stale vulnerable `rkyv 0.7.46` is absent from the active lock resolution;
- production frontend build succeeds without mixed-import or oversized-chunk warnings;
- loaded-session switching remains under 100 ms with no reload or abort;
- all automated gates and the 22-step desktop acceptance pass or unperformed environment limits remain explicit blockers;
- no excluded product area, editor, clipping store, state/UI dependency, or transport redesign appears;
- PR #354 remains draft/open/unmerged pending explicit final release approval.

## Known Execution Risks

- **Selection collapse on focus:** Preserve the excerpt in React state before toolbar focus/click and prevent pointer-down default. Action callbacks use the stored string, never re-read `window.getSelection()`.
- **Tool text accidentally eligible:** Mark only the Markdown wrapper, not the message/article root.
- **Quote-only accidental send:** while quote context exists, `hasContent` requires typed custom instruction even if files/images are already pending.
- **Wrong running route:** Start writing explicitly uses `onFollowUp`; Ask AI continues through MessageInput's established Enter/Alt+Enter semantics.
- **Session leakage:** Hook and quote state reset on canonical session identity changes. Existing App callbacks capture the active `sessionFile`.
- **Popover clipping:** Render through a body portal with fixed coordinates and clamp horizontally; static application layout stays CSS-driven.
- **Artifact race:** Capability-relative open plus same-handle read replaces pathname recanonicalization. No manual unsafe platform FFI is added.
- **Override incompatibility:** Patched overrides must pass all tests/builds. If not, upgrade the nearest direct package instead of suppressing audits.
- **Bundle split churn:** Split only existing large dependency families and keep application architecture unchanged.
- **Manual acceptance availability:** Never convert an unavailable GUI inspection into a claimed pass.
