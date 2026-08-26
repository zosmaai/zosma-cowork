# Active Work Canvas, Outputs, and Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render every Work session through a task-oriented document surface with a durable, secure Outputs/Sources rail that is identical for live and reloaded history.

**Architecture:** Keep `ChatView` as the stable session shell so its single mounted `MessageInput` survives Empty Work → Active Work. Add `WorkSessionView` only as the active message surface, and derive rail records with pure functions from the active keyed messages, streaming message, and canonical workspace. Preserve raw tool arguments while the sidecar emits a separate canonical output-path record; authorize every file read/open again in Rust before exposing bytes or folders.

**Tech Stack:** React 19, TypeScript strict mode, Vitest + React Testing Library, `react-markdown`, already-installed `unified`/`remark-parse` + `remark-gfm`, Tailwind CSS v4, CSS named container queries, Tauri 2/Rust, Node sidecar

**Roadmap:** `docs/superpowers/roadmaps/2026-08-09-chat-work-concurrent-sessions-roadmap.md`

**Phase:** Phase 4: Active Work Canvas, Outputs, and Sources

---

## Starting State and Phase Boundary

Start from `d991a1ed8` on `feat/chat-work-phase-1-runtime-identity`. PR #354 must remain draft, open, and unmerged.

Preserve these contracts:

- `sessionFile` remains canonical runtime/frontend identity.
- `StreamState.mode` is the sole active Chat/Work presentation chooser.
- One global `session_event` bus remains authoritative; no replay cursor or second event path.
- `awaitingDone`/`settledVersion`, listener readiness, process epochs, deletion tombstones, cold-load dedupe, and stale-list tokens remain unchanged.
- Abort remains a quiescence barrier; deletion remains stop-first.
- Outputs/Sources are projections, never persisted entities or a second artifact database.
- One `MessageInput` stays mounted through Empty Work → Active Work. Its model, attachments, paste/drop, voice, slash commands, steering, follow-up, queue editing, and abort behavior remain shared with Chat.
- Active Chat rendering and tool-detail behavior remain unchanged.

This phase intentionally excludes selected-text actions, a document editor, direct output editing, Projects, plugins, scheduling, cloud sync, runtime eviction, new state libraries, dependency/lockfile changes, and Phase 5 release work.

## File Responsibility Map

- `agent-sidecar/src/session-output-path.ts`: derive an immutable canonical output-path record from write/edit calls plus that runtime's cwd.
- `agent-sidecar/src/extract-chat-messages.ts`, `prompt-runner.ts`, `pi-session-store.ts`, `session-runtime-manager.ts`: preserve canonical output paths and structured tool-result details in both live events and snapshots.
- `src/lib/work-projections.ts`: pure URL/path normalization, Markdown-link extraction, output/source derivation, deduplication, and stable ordering.
- `src/lib/artifacts.ts`: artifact classification plus pure SVG/HTML preview hardening helpers.
- `src/hooks/useArtifactLoader.ts`: keyed async loader state with stale-result and object-URL cleanup.
- `src-tauri/src/lib.rs`: authorize workspace-contained artifact reads and folder opens at the native trust boundary.
- `src/components/WorkPanel.tsx`: persistent Outputs/Sources sections and selected-output preview.
- `src/work/WorkSessionView.tsx`: document-style active Work messages, compact directions, and quiet activity.
- `src/work/WorkHeader.tsx`: task title, Work label, and drawer controls.
- `src/chat/QueuedMessages.tsx`: existing queue presentation shared by Chat and Work.
- `src/chat/ChatView.tsx`: stable shell that swaps only the active message surface, not the composer.
- `src/App.tsx`: task title and one mutually exclusive drawer state for mobile sidebar/Work panel.
- `src/App.css`: readable Work center, 304px wide rail, max-320px drawer, narrow overlays, and reduced motion.
- Delete `src/components/RightPanel.tsx` and `src/components/DocumentsPanel.tsx` after their useful presentation responsibilities are replaced.

---

### Task 1: Make Live and Reloaded Tool Records Equivalent

**Files:**
- Create: `agent-sidecar/src/session-output-path.ts`
- Create: `agent-sidecar/src/session-output-path.test.ts`
- Modify: `agent-sidecar/src/extract-chat-messages.ts`
- Modify: `agent-sidecar/src/extractChatMessages.test.ts`
- Modify: `agent-sidecar/src/pi-session-store.ts`
- Modify: `agent-sidecar/src/pi-session-store.test.ts`
- Modify: `agent-sidecar/src/prompt-runner.ts`
- Modify: `agent-sidecar/src/subscribe-session.test.ts`
- Modify: `agent-sidecar/src/session-runtime-manager.ts`
- Modify: `agent-sidecar/src/session-runtime-manager.test.ts`
- Modify: `src/types/index.ts`
- Modify: `src/hooks/usePiStream.ts`
- Modify: `src/hooks/usePiStream.test.ts`

- [ ] **Step 1: Add failing canonical output-path tests**

Create `agent-sidecar/src/session-output-path.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeSessionToolEvent, outputPathForToolCall } from "./session-output-path.js";

describe("outputPathForToolCall", () => {
	it("resolves a relative completed write against its session cwd", () => {
		expect(
			outputPathForToolCall("write", { path: "reports/final.md" }, "/work/acme"),
		).toEqual({ path: "/work/acme/reports/final.md", displayPath: "reports/final.md" });
	});

	it("preserves an absolute path and original display spelling", () => {
		expect(
			outputPathForToolCall("edit", { file_path: "/work/acme/Final.md" }, "/work/acme"),
		).toEqual({ path: "/work/acme/Final.md", displayPath: "/work/acme/Final.md" });
	});

	it("ignores non-output tools and blank paths", () => {
		expect(outputPathForToolCall("read", { path: "a.md" }, "/work")).toBeUndefined();
		expect(outputPathForToolCall("write", { path: "  " }, "/work")).toBeUndefined();
	});
});

describe("normalizeSessionToolEvent", () => {
	it("adds a derived path without mutating raw tool arguments", () => {
		const event = {
			type: "message_update",
			assistantMessageEvent: {
				type: "toolcall_end",
				toolCall: { id: "w1", name: "write", arguments: { path: "out.md", content: "x" } },
			},
		};
		const normalized = normalizeSessionToolEvent(event, "/work/a") as typeof event & {
			assistantMessageEvent: { toolCall: { outputPath: { path: string; displayPath: string } } };
		};
		expect(normalized.assistantMessageEvent.toolCall.outputPath).toEqual({
			path: "/work/a/out.md",
			displayPath: "out.md",
		});
		expect(event.assistantMessageEvent.toolCall.arguments.path).toBe("out.md");
	});

	it("returns unrelated events by identity", () => {
		const event = { type: "agent_start" };
		expect(normalizeSessionToolEvent(event, "/work/a")).toBe(event);
	});
});
```

- [ ] **Step 2: Add failing persisted-details tests**

In `agent-sidecar/src/extractChatMessages.test.ts`, add a write call and result with structured details:

```ts
it("preserves canonical output path and result details on reload", () => {
	const result = extractChatMessages(
		[
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "w1", name: "write", arguments: { path: "out/report.md" } }],
				timestamp: 1,
			},
			{
				role: "toolResult",
				toolCallId: "w1",
				content: [{ type: "text", text: "Written to out/report.md" }],
				details: { tool: "write", bytes: 12 },
				isError: false,
			},
		],
		"/work/acme",
	);
	const call = (result[0].toolCalls as Array<Record<string, unknown>>)[0];
	expect(call.outputPath).toEqual({
		path: "/work/acme/out/report.md",
		displayPath: "out/report.md",
	});
	expect(call.details).toEqual({ tool: "write", bytes: 12 });
});
```

Update existing calls only where TypeScript requires it; the new cwd parameter remains optional for legacy tests.

In `agent-sidecar/src/session-runtime-manager.test.ts`, extend the explicit snapshot test with a relative completed write and assert the snapshot contains the same absolute `outputPath` as the live normalizer.

In `agent-sidecar/src/subscribe-session.test.ts`, add `cwd` to the fake runtime and emit a `message_update/toolcall_end` from A with `arguments.path = "out.md"`. Assert the sent envelope contains `/work/a/out.md`, then emit the same relative call from B and assert `/work/b/out.md`. This proves the subscription uses the emitting runtime cwd rather than active/global state.

- [ ] **Step 3: Add failing frontend ingestion test**

In `src/hooks/usePiStream.test.ts`, extend the `toolcall_end` event fixture with:

```ts
outputPath: { path: "/work/acme/out.md", displayPath: "out.md" },
```

Then assert:

```ts
expect(state.streamingMessage?.toolCalls?.[0].outputPath).toEqual({
	path: "/work/acme/out.md",
	displayPath: "out.md",
});
```

- [ ] **Step 4: Run tests and verify expected failures**

```bash
(cd agent-sidecar && pnpm test -- src/session-output-path.test.ts src/extractChatMessages.test.ts src/session-runtime-manager.test.ts)
pnpm test -- src/hooks/usePiStream.test.ts -t "outputPath"
```

Expected: FAIL because the new module, optional cwd conversion, detail preservation, and frontend field do not exist.

- [ ] **Step 5: Implement immutable sidecar path derivation**

Create `agent-sidecar/src/session-output-path.ts`:

```ts
import { isAbsolute, normalize, resolve } from "node:path";

export interface SessionOutputPath {
	path: string;
	displayPath: string;
}

function stringPath(args: Record<string, unknown>): string | undefined {
	const value = typeof args.path === "string" ? args.path : args.file_path;
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function outputPathForToolCall(
	name: string,
	args: Record<string, unknown>,
	cwd: string,
): SessionOutputPath | undefined {
	if (name !== "write" && name !== "edit") return undefined;
	const displayPath = stringPath(args);
	if (!displayPath) return undefined;
	return {
		path: normalize(isAbsolute(displayPath) ? displayPath : resolve(cwd, displayPath)),
		displayPath,
	};
}

export function normalizeSessionToolEvent(event: unknown, cwd: string): unknown {
	if (!event || typeof event !== "object") return event;
	const source = event as Record<string, unknown>;
	if (source.type !== "message_update") return event;
	const assistant = source.assistantMessageEvent;
	if (!assistant || typeof assistant !== "object") return event;
	const update = assistant as Record<string, unknown>;
	if (update.type !== "toolcall_end") return event;
	const rawTool = update.toolCall;
	if (!rawTool || typeof rawTool !== "object") return event;
	const tool = rawTool as Record<string, unknown>;
	const name = typeof tool.name === "string" ? tool.name : "";
	const args =
		tool.arguments && typeof tool.arguments === "object"
			? (tool.arguments as Record<string, unknown>)
			: {};
	const outputPath = outputPathForToolCall(name, args, cwd);
	if (!outputPath) return event;
	return {
		...source,
		assistantMessageEvent: {
			...update,
			toolCall: { ...tool, outputPath },
		},
	};
}
```

This derives presentation metadata without changing SDK `arguments` or another consumer's raw values.

- [ ] **Step 6: Preserve path/details in snapshots and live events**

Change `extractChatMessages` to accept `cwd = ""`. When mapping a tool call, compute `outputPathForToolCall(name, args, cwd)` only when cwd is non-empty and spread it onto that tool-call record. When pairing a `toolResult`, copy `msg.details` when it is a non-null object:

```ts
if (msg.details && typeof msg.details === "object") {
	tc.details = msg.details;
}
```

Change `convertAgentMessagesToChat(agentMessages, cwd = "")` and pass cwd from both load paths:

```ts
const header = manager.getHeader();
const messages = convertAgentMessagesToChat(ctx.messages as unknown[], header?.cwd ?? "");
```

```ts
messages: convertAgentMessagesToChat(runtime.session.messages as unknown[], runtime.cwd),
```

In `prompt-runner.ts`, include `cwd` in `PromptRuntime` and send a normalized clone:

```ts
const normalizedEvent = normalizeSessionToolEvent(event, runtime.cwd);
send(makeSessionEvent(runtime.sessionFile, normalizedEvent));
```

Keep watchdog/status decisions based on the original event.

- [ ] **Step 7: Preserve the derived field in frontend state**

Add to `ToolCallInfo` in `src/types/index.ts`:

```ts
outputPath?: { path: string; displayPath: string };
```

Extend `extractToolCallInfo`'s accepted input and returned record:

```ts
outputPath?: { path: string; displayPath: string };
```

```ts
outputPath: tc.outputPath,
```

Do not rewrite `args` in the reducer.

- [ ] **Step 8: Run focused and boundary tests**

```bash
(cd agent-sidecar && pnpm test -- src/session-output-path.test.ts src/extractChatMessages.test.ts src/pi-session-store.test.ts src/session-runtime-manager.test.ts src/subscribe-session.test.ts)
pnpm test -- src/hooks/usePiStream.test.ts
(cd agent-sidecar && pnpm build)
pnpm run typecheck
```

Expected: PASS. Confirm live and snapshot records expose the same derived path/details while raw args remain unchanged.

- [ ] **Step 9: Commit**

```bash
git add agent-sidecar/src/session-output-path.ts agent-sidecar/src/session-output-path.test.ts \
  agent-sidecar/src/extract-chat-messages.ts agent-sidecar/src/extractChatMessages.test.ts \
  agent-sidecar/src/pi-session-store.ts agent-sidecar/src/pi-session-store.test.ts \
  agent-sidecar/src/prompt-runner.ts agent-sidecar/src/subscribe-session.test.ts \
  agent-sidecar/src/session-runtime-manager.ts agent-sidecar/src/session-runtime-manager.test.ts \
  src/types/index.ts src/hooks/usePiStream.ts src/hooks/usePiStream.test.ts
git commit -m "feat(sidecar): preserve durable work output records"
```

---

### Task 2: Derive Normalized Outputs and Sources with Pure Functions

**Files:**
- Create: `src/lib/work-projections.ts`
- Create: `src/lib/work-projections.test.ts`

- [ ] **Step 1: Add failing URL and path normalization tests**

Create `src/lib/work-projections.test.ts` with one behavior per test:

```ts
import { describe, expect, it } from "vitest";
import type { ChatMessage, ToolCallInfo } from "@/types";
import {
	deriveWorkProjection,
	extractMarkdownLinks,
	normalizeFileIdentity,
	normalizeSourceUrl,
} from "./work-projections";

describe("normalizeSourceUrl", () => {
	it("normalizes host, default port, fragment, and a non-root trailing slash", () => {
		expect(normalizeSourceUrl("HTTPS://Example.COM:443/Docs/?q=One#part")).toBe(
			"https://example.com/Docs?q=One",
		);
	});

	it("keeps a root slash", () => {
		expect(normalizeSourceUrl("https://example.com/"))
			.toBe("https://example.com/");
	});

	it.each(["javascript:alert(1)", "data:text/html,x", "file:///tmp/a", "not a url"])(
		"rejects %s",
		(value) => expect(normalizeSourceUrl(value)).toBeNull(),
	);
});

describe("normalizeFileIdentity", () => {
	it("resolves a relative path against cwd", () => {
		expect(normalizeFileIdentity("reports/../final.md", "/work/acme")).toBe(
			"/work/acme/final.md",
		);
	});

	it("normalizes Windows separators and drive letter without lowercasing path case", () => {
		expect(normalizeFileIdentity("c:\\Work\\Reports\\Final.md\\", "C:/Work")).toBe(
			"C:/Work/Reports/Final.md",
		);
	});

	it("preserves a UNC prefix and share root", () => {
		expect(normalizeFileIdentity("\\\\server\\share\\", "C:/Work")).toBe("//server/share");
	});
});
```

The Windows test follows the approved contract: uppercase only the drive; do not case-fold remaining components because workspace case sensitivity varies.

- [ ] **Step 2: Add failing Markdown parser tests**

Use the same `remark-parse` + `remark-gfm` semantics as rendering:

```ts
describe("extractMarkdownLinks", () => {
	it("extracts inline, reference, and GFM autolinks", () => {
		const markdown = "[Docs](https://example.com/docs) [Guide][g]\n\n[g]: https://example.com/guide\n<https://example.com/angle>";
		expect(extractMarkdownLinks(markdown).map((link) => link.url)).toEqual([
			"https://example.com/docs",
			"https://example.com/guide",
			"https://example.com/angle",
		]);
	});

	it("does not treat URLs inside inline or fenced code as links", () => {
		const markdown = "`https://inline.invalid`\n```txt\n[bad](https://fenced.invalid)\n```";
		expect(extractMarkdownLinks(markdown)).toEqual([]);
	});

	it("drops unsafe link schemes", () => {
		expect(extractMarkdownLinks("[bad](javascript:alert(1))")).toEqual([]);
	});
});
```

- [ ] **Step 3: Add failing output/source projection tests**

Add helpers:

```ts
const tc = (overrides: Partial<ToolCallInfo>): ToolCallInfo => ({
	id: "t1",
	name: "write",
	args: { path: "out.md" },
	status: "completed",
	result: "Written to out.md",
	...overrides,
});

const message = (overrides: Partial<ChatMessage>): ChatMessage => ({
	id: "m1",
	role: "assistant",
	content: "",
	timestamp: 1,
	...overrides,
});
```

Add tests:

```ts
it("derives only successful completed write/edit outputs", () => {
	const messages = [
		message({ toolCalls: [tc({ id: "ok" }), tc({ id: "running", status: "running" }), tc({ id: "error", status: "error" }), tc({ id: "read", name: "read" })] }),
	];
	expect(deriveWorkProjection(messages, "/work/acme").outputs.map((o) => o.toolCallId)).toEqual(["ok"]);
});

it("deduplicates output paths with first position and newest display metadata", () => {
	const messages = [
		message({ id: "m1", toolCalls: [tc({ id: "w1", outputPath: { path: "/work/acme/a.md", displayPath: "a.md" } })] }),
		message({ id: "m2", timestamp: 2, toolCalls: [tc({ id: "w2", name: "edit", outputPath: { path: "/work/acme/a.md", displayPath: "./a.md" } })] }),
	];
	const outputs = deriveWorkProjection(messages, "/work/acme").outputs;
	expect(outputs).toHaveLength(1);
	expect(outputs[0]).toMatchObject({ toolCallId: "w2", displayValue: "./a.md" });
});

it("derives URL sources from assistant Markdown but not user prose", () => {
	const projection = deriveWorkProjection([
		message({ role: "user", content: "[ignore](https://user.example)" }),
		message({ id: "a", content: "Read [the report](https://EXAMPLE.com/report/#x)." }),
	], "/work");
	expect(projection.sources).toEqual([
		expect.objectContaining({ kind: "url", identity: "https://example.com/report", title: "the report" }),
	]);
});

it("reads anchored URL records only from allowlisted browse/search tools", () => {
	const allowed = tc({ id: "s1", name: "web_search_exa", result: "Title: Example\nURL: https://example.com/a\nText: body" });
	const denied = tc({ id: "b1", name: "bash", result: "URL: https://shell.invalid" });
	const sources = deriveWorkProjection([message({ toolCalls: [allowed, denied] })], "/work").sources;
	expect(sources.map((s) => s.identity)).toEqual(["https://example.com/a"]);
});

it("derives file sources from structured attachments and the existing File marker", () => {
	const sources = deriveWorkProjection([
		message({
			role: "user",
			attachments: [{ path: "/refs/a.pdf", name: "a.pdf", size: 1, mimeType: "application/pdf" }],
			content: "[File: /refs/b.txt] b.txt 2 text/plain",
		}),
	], "/work").sources;
	expect(sources.map((s) => [s.kind, s.displayValue])).toEqual([
		["file", "/refs/a.pdf"],
		["file", "/refs/b.txt"],
	]);
});

it("keeps first source order while newest duplicate owns title", () => {
	const sources = deriveWorkProjection([
		message({ id: "a", content: "[Old](https://example.com/doc/#one)" }),
		message({ id: "b", timestamp: 2, content: "[New](https://EXAMPLE.com/doc)\n[Other](https://other.example/)" }),
	], "/work").sources;
	expect(sources.map((s) => s.title)).toEqual(["New", "Other"]);
});

it("returns empty sections rather than throwing on malformed records", () => {
	expect(() => deriveWorkProjection([message({ toolCalls: [{ broken: true } as never] })], "/work"))
		.not.toThrow();
});
```

- [ ] **Step 4: Run the pure tests and verify failure**

```bash
pnpm test -- src/lib/work-projections.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 5: Implement projection types and normalizers**

Create `src/lib/work-projections.ts` with these exported contracts:

```ts
import type { ChatMessage, ToolCallInfo } from "@/types";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

export interface WorkOutput {
	kind: "file";
	identity: string;
	displayValue: string;
	path: string;
	title: string;
	messageId: string;
	toolCallId: string;
}

export type WorkSource =
	| { kind: "url"; identity: string; displayValue: string; title: string; messageId: string }
	| { kind: "file"; identity: string; displayValue: string; title: string; messageId: string };

export interface WorkProjection {
	outputs: WorkOutput[];
	sources: WorkSource[];
}

export function normalizeSourceUrl(value: string): string | null {
	try {
		const url = new URL(value.trim());
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
		url.hash = "";
		url.hostname = url.hostname.toLowerCase();
		if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) {
			url.port = "";
		}
		if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/$/, "");
		return url.toString();
	} catch {
		return null;
	}
}
```

Implement `normalizeFileIdentity` as a lexical display/identity normalizer, not an authorization check:

```ts
export function normalizeFileIdentity(value: string, cwd: string): string | null {
	let raw = value.trim().replace(/\\/g, "/");
	if (!raw) return null;
	const drive = raw.match(/^([a-zA-Z]):(?:\/|$)/)?.[1];
	const unc = raw.startsWith("//");
	const posix = raw.startsWith("/") && !unc;
	const absolute = Boolean(drive || unc || posix);
	if (!absolute) {
		const base = cwd.trim().replace(/\\/g, "/").replace(/\/+$/, "");
		if (!base) return null;
		raw = `${base}/${raw}`;
	}

	const driveAfterJoin = raw.match(/^([a-zA-Z]):(?:\/|$)/)?.[1];
	const uncAfterJoin = raw.startsWith("//");
	const prefix = driveAfterJoin ? `${driveAfterJoin.toUpperCase()}:/` : uncAfterJoin ? "//" : "/";
	const body = driveAfterJoin ? raw.slice(3) : uncAfterJoin ? raw.slice(2) : raw.slice(1);
	const segments: string[] = [];
	for (const segment of body.split(/\/+/)) {
		if (!segment || segment === ".") continue;
		if (segment === "..") {
			if (segments.length > 0) segments.pop();
			continue;
		}
		segments.push(segment);
	}
	if (driveAfterJoin && segments.length === 0) return prefix;
	if (!driveAfterJoin && !uncAfterJoin && segments.length === 0) return "/";
	return `${prefix}${segments.join("/")}`;
}
```

Do not lowercase Windows/UNC path components; that would violate the approved cross-filesystem contract.

- [ ] **Step 6: Parse links with the renderer's Markdown parser**

Add:

```ts
interface MarkdownNode {
	type?: string;
	url?: string;
	identifier?: string;
	value?: string;
	children?: MarkdownNode[];
}

function textOf(node: MarkdownNode): string {
	if (typeof node.value === "string") return node.value;
	return (node.children ?? []).map(textOf).join("");
}

export function extractMarkdownLinks(markdown: string): Array<{ url: string; title: string }> {
	const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as MarkdownNode;
	const definitions = new Map<string, string>();
	const collectDefinitions = (node: MarkdownNode) => {
		if (node.type === "definition" && node.identifier && node.url) {
			definitions.set(node.identifier.toLowerCase(), node.url);
		}
		for (const child of node.children ?? []) collectDefinitions(child);
	};
	collectDefinitions(tree);

	const links: Array<{ url: string; title: string }> = [];
	const visit = (node: MarkdownNode) => {
		const rawUrl =
			node.type === "link"
				? node.url
				: node.type === "linkReference" && node.identifier
					? definitions.get(node.identifier.toLowerCase())
					: undefined;
		if (rawUrl) {
			const identity = normalizeSourceUrl(rawUrl);
			if (identity) links.push({ url: rawUrl, title: textOf(node).trim() || identity });
		}
		for (const child of node.children ?? []) visit(child);
	};
	visit(tree);
	return links;
}
```

This naturally excludes code nodes and supports inline, reference, angle, and GFM autolinks. Do not add or modify dependencies/lockfiles: these parser packages are already installed by the current direct Markdown stack.

- [ ] **Step 7: Implement defensive derivation and stable dedupe**

Use an explicit web-tool allowlist:

```ts
const SOURCE_TOOLS = new Set([
	"web_search",
	"code_search",
	"fetch_content",
	"web_search_exa",
	"web_search_advanced_exa",
	"web_fetch_exa",
	"web_answer_exa",
	"web_research_exa",
	"web_find_similar_exa",
]);
```

For tool sources, inspect only completed, non-error calls in this allowlist. Parse exact `url`/`href`/`link` string fields recursively from `details`, JSON results, and anchored `^URL:\s*(\S+)\s*$` result lines. Associate a `Title:` line immediately preceding a `URL:` line; never scan arbitrary bare URLs.

For outputs, require `status === "completed"`, `isError !== true`, and `name === "write" || name === "edit"`. Prefer `tool.outputPath`; otherwise resolve `args.path`/`args.file_path` against cwd. Use existing `Written ... to ...` parsing only when a legacy call has neither field and the result matches that strict success format.

Use one ordered upsert helper per kind:

```ts
function upsertLatest<T extends { identity: string }>(
	items: T[],
	positions: Map<string, number>,
	item: T,
): void {
	const position = positions.get(item.identity);
	if (position === undefined) {
		positions.set(item.identity, items.length);
		items.push(item);
	} else {
		items[position] = item;
	}
}
```

Walk messages and tool calls in array order. Add structured user attachments and the existing `[File: path] name size mime` marker as `kind: "file"` sources. Compare URL and file identities in separate maps. Wrap no broad `try/catch` around the whole projection; every parser narrows unknown values locally so one malformed record cannot erase valid siblings.

- [ ] **Step 8: Run pure tests, typecheck, and dependency guard**

```bash
pnpm test -- src/lib/work-projections.test.ts
pnpm run typecheck
git diff -- package.json pnpm-lock.yaml
```

Expected: tests/typecheck pass; dependency diff is empty.

- [ ] **Step 9: Commit**

```bash
git add src/lib/work-projections.ts src/lib/work-projections.test.ts
git commit -m "feat(frontend): derive work outputs and sources"
```

---

### Task 3: Harden Artifact and Link Trust Boundaries

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/hooks/useArtifactLoader.ts`
- Create: `src/hooks/useArtifactLoader.test.ts`
- Modify: `src/lib/artifacts.ts`
- Modify: `src/lib/artifacts.test.ts`
- Modify: `src/components/ArtifactPreview.tsx`
- Modify: `src/components/ArtifactPreview.test.tsx`
- Modify: `src/components/MarkdownComponents.tsx`
- Create: `src/components/MarkdownComponents.test.tsx`

- [ ] **Step 1: Add failing Rust workspace-boundary tests**

Inside the Rust test module, add `canonical_workspace_file` to its current `use super` import list and add:

```rust
#[test]
fn workspace_artifact_guard_accepts_a_file_inside_root() {
    let base = std::env::temp_dir().join(format!("cowork-artifact-{}", std::process::id()));
    let root = base.join("workspace");
    std::fs::create_dir_all(&root).unwrap();
    let file = root.join("report.md");
    std::fs::write(&file, "ok").unwrap();
    assert_eq!(canonical_workspace_file(&root, &file).unwrap(), std::fs::canonicalize(&file).unwrap());
    std::fs::remove_dir_all(base).unwrap();
}

#[test]
fn workspace_artifact_guard_rejects_parent_escape() {
    let base = std::env::temp_dir().join(format!("cowork-artifact-escape-{}", std::process::id()));
    let root = base.join("workspace");
    std::fs::create_dir_all(&root).unwrap();
    let outside = base.join("secret.txt");
    std::fs::write(&outside, "no").unwrap();
    assert!(canonical_workspace_file(&root, &outside).is_err());
    std::fs::remove_dir_all(base).unwrap();
}

#[cfg(unix)]
#[test]
fn workspace_artifact_guard_rejects_symlink_escape() {
    use std::os::unix::fs::symlink;
    let base = std::env::temp_dir().join(format!("cowork-artifact-symlink-{}", std::process::id()));
    let root = base.join("workspace");
    std::fs::create_dir_all(&root).unwrap();
    let outside = base.join("secret.txt");
    std::fs::write(&outside, "no").unwrap();
    let link = root.join("linked.txt");
    symlink(&outside, &link).unwrap();
    assert!(canonical_workspace_file(&root, &link).is_err());
    std::fs::remove_dir_all(base).unwrap();
}
```

Use distinct temp names already containing process id; tests run serially safely because names differ by test prefix.

- [ ] **Step 2: Add failing loader-state tests**

Create `src/hooks/useArtifactLoader.test.ts` and mock `invoke`:

```ts
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useArtifactLoader } from "./useArtifactLoader";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("useArtifactLoader", () => {
	beforeEach(() => invoke.mockReset());

	it("distinguishes loading, loaded, and unavailable", async () => {
		invoke.mockResolvedValueOnce({ bytes: [104, 105], mimeType: "text/plain" });
		const { result, rerender } = renderHook(
			({ path }) => useArtifactLoader(path, "/work"),
			{ initialProps: { path: "/work/a.txt" as string | null } },
		);
		expect(result.current.status).toBe("loading");
		await waitFor(() => expect(result.current.status).toBe("loaded"));
		expect(result.current.artifact?.fileContent).toBe("hi");
		invoke.mockRejectedValueOnce(new Error("outside workspace"));
		rerender({ path: "/outside/no.txt" });
		await waitFor(() => expect(result.current.status).toBe("unavailable"));
	});

	it("ignores a late result for the previously selected path", async () => {
		let release!: (value: unknown) => void;
		invoke.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
		invoke.mockResolvedValueOnce({ bytes: [98], mimeType: "text/plain" });
		const { result, rerender } = renderHook(
			({ path }) => useArtifactLoader(path, "/work"),
			{ initialProps: { path: "/work/a.txt" } },
		);
		rerender({ path: "/work/b.txt" });
		await waitFor(() => expect(result.current.artifact?.fileContent).toBe("b"));
		act(() => release({ bytes: [97], mimeType: "text/plain" }));
		await Promise.resolve();
		expect(result.current.artifact?.filePath).toBe("/work/b.txt");
	});
});
```

- [ ] **Step 3: Add failing HTML/SVG/Markdown security tests**

Change ArtifactPreview expectations:

```ts
it("blocks scripts and remote loading in HTML previews", () => {
	const { container } = render(
		<ArtifactPreview filePath="/work/a.html" fileContent='<meta http-equiv="refresh" content="0;url=https://tracker.invalid"><script>window.pwned=1</script><a href="https://tracker.invalid/x">go</a><img src="https://tracker.invalid/x">' artifactType="html" />,
	);
	const iframe = container.querySelector("iframe");
	expect(iframe).toHaveAttribute("sandbox", "");
	const srcdoc = iframe?.getAttribute("srcdoc") ?? "";
	expect(srcdoc).toContain("default-src 'none'");
	expect(srcdoc).not.toContain("tracker.invalid");
	expect(srcdoc).not.toContain("<script");
	expect(srcdoc).not.toContain("onload=");
});

it("renders sanitized SVG as an image rather than executable inline markup", () => {
	const { container } = render(
		<ArtifactPreview filePath="/work/a.svg" fileContent='<svg onload="window.pwned=1"><script>alert(1)</script><circle/></svg>' artifactType="svg" />,
	);
	expect(container.querySelector("svg")).toBeNull();
	expect(container.querySelector("script")).toBeNull();
	const image = screen.getByRole("img", { name: "a.svg" });
	expect(decodeURIComponent(image.getAttribute("src") ?? "")).not.toContain("script");
	expect(decodeURIComponent(image.getAttribute("src") ?? "")).not.toContain("onload");
});
```

Create `src/components/MarkdownComponents.test.tsx`:

```ts
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ReactMarkdown from "react-markdown";
import { markdownComponents } from "./MarkdownComponents";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("markdownComponents", () => {
	it("renders unsafe schemes as non-navigable text", () => {
		render(<ReactMarkdown components={markdownComponents}>{"[bad](javascript:alert(1))"}</ReactMarkdown>);
		expect(screen.queryByRole("link", { name: "bad" })).toBeNull();
		expect(screen.getByText("bad")).toBeInTheDocument();
	});

	it("opens an https link through the validated external path", () => {
		render(<ReactMarkdown components={markdownComponents}>{"[safe](https://example.com)"}</ReactMarkdown>);
		fireEvent.click(screen.getByRole("link", { name: "safe" }));
		expect(invoke).toHaveBeenCalledWith("open_url", { url: "https://example.com" });
	});
});
```

- [ ] **Step 4: Run security tests and verify failure**

```bash
cargo test --workspace workspace_artifact_guard -- --nocapture
pnpm test -- src/hooks/useArtifactLoader.test.ts src/components/ArtifactPreview.test.tsx src/components/MarkdownComponents.test.tsx
```

Expected: FAIL because native authorization, explicit loader status, CSP, SVG sanitization, and unsafe-link rendering are absent.

- [ ] **Step 5: Add native workspace authorization and bounded reads**

In `src-tauri/src/lib.rs`, add:

```rust
const MAX_ARTIFACT_BYTES: u64 = 5 * 1024 * 1024;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactFile {
    bytes: Vec<u8>,
    mime_type: String,
}

fn canonical_workspace_file(workspace: &Path, path: &Path) -> Result<PathBuf, String> {
    let root = std::fs::canonicalize(workspace).map_err(|_| "Workspace unavailable".to_string())?;
    let file = std::fs::canonicalize(path).map_err(|_| "File unavailable".to_string())?;
    if !file.starts_with(&root) || !file.is_file() {
        return Err("File unavailable".to_string());
    }
    Ok(file)
}

fn read_authorized_artifact(workspace: &Path, requested: &Path) -> Result<ArtifactFile, String> {
    use std::io::Read;
    let canonical = canonical_workspace_file(workspace, requested)?;
    let mut handle = std::fs::File::open(&canonical).map_err(|_| "File unavailable".to_string())?;
    if !handle.metadata().map_err(|_| "File unavailable".to_string())?.is_file() {
        return Err("File unavailable".to_string());
    }
    let mut bytes = Vec::new();
    handle
        .by_ref()
        .take(MAX_ARTIFACT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "File unavailable".to_string())?;
    if bytes.len() as u64 > MAX_ARTIFACT_BYTES {
        return Err("File unavailable".to_string());
    }
    // Bind validation to the opened handle as far as std permits without a
    // platform dependency: do not return bytes if the requested path changed
    // after open/read. canonical_workspace_file also resolves symlink parents.
    if canonical_workspace_file(workspace, requested)? != canonical {
        return Err("File unavailable".to_string());
    }
    Ok(ArtifactFile {
        mime_type: mime_guess::from_path(&canonical)
            .first_or(mime_guess::mime::APPLICATION_OCTET_STREAM)
            .to_string(),
        bytes,
    })
}

#[tauri::command]
async fn read_workspace_artifact(path: String, workspace: String) -> Result<ArtifactFile, String> {
    tauri::async_runtime::spawn_blocking(move || {
        read_authorized_artifact(Path::new(&workspace), Path::new(&path))
    })
    .await
    .map_err(|_| "File unavailable".to_string())?
}
```

For folder opening, refactor existing platform-specific `open_url` process launching into `fn open_target(target: &str) -> Result<(), String>`. Keep `open_url` calling it unchanged. Add a parent guard so a missing file may still expose its safe existing workspace folder:

```rust
fn canonical_workspace_parent(workspace: &Path, path: &Path) -> Result<PathBuf, String> {
    let root = std::fs::canonicalize(workspace).map_err(|_| "Workspace unavailable".to_string())?;
    let requested_parent = path.parent().ok_or_else(|| "Folder unavailable".to_string())?;
    let parent = std::fs::canonicalize(requested_parent).map_err(|_| "Folder unavailable".to_string())?;
    if !parent.starts_with(&root) || !parent.is_dir() {
        return Err("Folder unavailable".to_string());
    }
    Ok(parent)
}

#[tauri::command]
async fn open_workspace_folder(path: String, workspace: String) -> Result<(), String> {
    let parent = canonical_workspace_parent(Path::new(&workspace), Path::new(&path))?;
    open_target(parent.to_string_lossy().as_ref())
}
```

Add a Rust test where `/workspace/missing.md` does not exist but `canonical_workspace_parent` returns `/workspace`, plus a parent-escape rejection.

Register both commands in `tauri::generate_handler!`. Add `read_authorized_artifact` to the Rust test import list and test that a `MAX_ARTIFACT_BYTES + 1` file returns `File unavailable`; this proves the cap is enforced during the handle read rather than only from pre-read metadata. Canonicalization resolves symlinks before containment, bytes come from one opened handle, and a post-read canonical check rejects a changed requested path before bytes cross IPC. Paths outside the session workspace remain listed/copyable but cannot be read or opened. Do not add a native dependency for this command.

- [ ] **Step 6: Implement keyed artifact loading**

Change `useArtifactLoader` to:

```ts
export type ArtifactLoadState =
	| { status: "idle"; artifact: null }
	| { status: "loading"; artifact: null }
	| { status: "loaded"; artifact: ArtifactData }
	| { status: "unavailable"; artifact: null };

export function useArtifactLoader(filePath: string | null, workspace: string): ArtifactLoadState {
	const [state, setState] = useState<ArtifactLoadState>({ status: "idle", artifact: null });

	useEffect(() => {
		if (!filePath) {
			setState({ status: "idle", artifact: null });
			return;
		}
		let current = true;
		let objectUrl: string | undefined;
		setState({ status: "loading", artifact: null });
		invoke<{ bytes: number[]; mimeType: string }>("read_workspace_artifact", {
			path: filePath,
			workspace,
		})
			.then(({ bytes, mimeType }) => {
				if (!current) return;
				const artifactType = detectArtifactType(filePath);
				let fileContent: string;
				if (artifactType === "image") {
					objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeType }));
					fileContent = objectUrl;
				} else {
					fileContent = new TextDecoder().decode(new Uint8Array(bytes));
				}
				setState({ status: "loaded", artifact: { filePath, fileContent, artifactType } });
			})
			.catch(() => {
				if (current) setState({ status: "unavailable", artifact: null });
			});
		return () => {
			current = false;
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	}, [filePath, workspace]);

	return state;
}
```

Update `ToolCallTimeline` to use `load.artifact` and pass the current workspace into it. Add optional `workspaceCwd` to `ToolCallTimeline`/`ChatMessageItem` and thread the active cwd from `ChatView`. Call `useArtifactLoader(artifactPath && workspaceCwd ? artifactPath : null, workspaceCwd ?? "")`; direct legacy renderers therefore issue no native read. Chat's detail surface remains otherwise unchanged.

- [ ] **Step 7: Harden HTML, SVG, and unsafe Markdown**

In `src/lib/artifacts.ts`, add `sanitizeSvg` using native `DOMParser`: reject parser errors; remove `script`, `foreignObject`, `iframe`, and `style` elements; remove every attribute beginning with `on`; remove `style` attributes containing `url(`; remove `href`/`xlink:href` unless it starts with `#` or `data:image/`; serialize the remaining root. Return `null` on malformed input.

Add:

```ts
export function sandboxedHtml(content: string): string {
	const document = new DOMParser().parseFromString(content, "text/html");
	for (const element of document.querySelectorAll("script, base, iframe, object, embed, form")) {
		element.remove();
	}
	for (const meta of document.querySelectorAll("meta[http-equiv]")) {
		if (meta.getAttribute("http-equiv")?.toLowerCase() === "refresh") meta.remove();
	}
	for (const element of document.querySelectorAll("a[href], area[href]")) {
		element.removeAttribute("href");
	}
	for (const element of document.querySelectorAll("[src]")) {
		const src = element.getAttribute("src")?.trim() ?? "";
		if (!src.startsWith("data:image/")) element.removeAttribute("src");
	}
	for (const element of document.querySelectorAll("*")) {
		for (const attribute of [...element.attributes]) {
			if (attribute.name.toLowerCase().startsWith("on")) element.removeAttribute(attribute.name);
		}
	}
	const policy = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; navigate-to 'none';";
	return `<meta http-equiv="Content-Security-Policy" content="${policy}">${document.documentElement.outerHTML}`;
}
```

In `ArtifactPreview`:

```tsx
<iframe srcDoc={sandboxedHtml(fileContent)} title={fileName} sandbox="" />
```

For SVG, compute sanitized text with `useMemo`; render it only as:

```tsx
<img
	src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(safeSvg)}`}
	alt={fileName}
	className="max-w-full max-h-[350px] object-contain"
/>
```

If sanitization returns null, render `File unavailable`.

In `MarkdownComponents.tsx`, allow fragment links and `isExternalUrl` links only. For every other href, return `<span>{children}</span>` so the webview never receives a navigable unsafe/relative anchor.

- [ ] **Step 8: Run all security and existing artifact regressions**

```bash
cargo fmt --check
cargo test --workspace workspace_artifact_guard -- --nocapture
pnpm test -- src/hooks/useArtifactLoader.test.ts src/lib/artifacts.test.ts \
  src/components/ArtifactPreview.test.tsx src/components/MarkdownComponents.test.tsx \
  src/components/ChatMessage.test.tsx
pnpm run typecheck
```

Expected: PASS. No script-bearing SVG is inserted into the DOM; HTML has empty sandbox plus restrictive CSP; missing/out-of-workspace files are unavailable.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/lib.rs src/hooks/useArtifactLoader.ts src/hooks/useArtifactLoader.test.ts \
  src/lib/artifacts.ts src/lib/artifacts.test.ts src/components/ArtifactPreview.tsx \
  src/components/ArtifactPreview.test.tsx src/components/MarkdownComponents.tsx \
  src/components/MarkdownComponents.test.tsx src/components/ToolCallTimeline.tsx \
  src/components/ChatMessage.tsx
git commit -m "fix: secure work artifact previews"
```

---

### Task 4: Build the Outputs and Sources Rail

**Files:**
- Create: `src/components/WorkPanel.tsx`
- Create: `src/components/WorkPanel.test.tsx`

- [ ] **Step 1: Add failing persistent-section and dedupe-presentation tests**

Create `src/components/WorkPanel.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkOutput, WorkSource } from "@/lib/work-projections";
import { WorkPanel } from "./WorkPanel";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const output: WorkOutput = {
	kind: "file",
	identity: "/work/report.md",
	displayValue: "report.md",
	path: "/work/report.md",
	title: "report.md",
	messageId: "m1",
	toolCallId: "w1",
};
const urlSource: WorkSource = {
	kind: "url",
	identity: "https://example.com/report",
	displayValue: "https://Example.com/report#part",
	title: "Reference report",
	messageId: "m2",
};

describe("WorkPanel", () => {
	beforeEach(() => invoke.mockReset());

	it("keeps restrained Outputs and Sources empty states visible", () => {
		render(<WorkPanel outputs={[]} sources={[]} workspace="/work" open onClose={vi.fn()} />);
		expect(screen.getByRole("heading", { name: "Outputs" })).toBeInTheDocument();
		expect(screen.getByText("No outputs yet")).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "Sources" })).toBeInTheDocument();
		expect(screen.getByText("No sources yet")).toBeInTheDocument();
	});

	it("renders output and discriminated URL/file sources", () => {
		const fileSource: WorkSource = { kind: "file", identity: "/refs/a.pdf", displayValue: "/refs/a.pdf", title: "a.pdf", messageId: "u1" };
		render(<WorkPanel outputs={[output]} sources={[urlSource, fileSource]} workspace="/work" open onClose={vi.fn()} />);
		expect(screen.getByRole("button", { name: /report.md/i })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /Reference report/i })).toBeInTheDocument();
		expect(screen.getByText("a.pdf")).toBeInTheDocument();
	});

	it("loads a selected output and opens only its authorized folder", async () => {
		invoke.mockResolvedValueOnce({ bytes: [35, 32, 82], mimeType: "text/markdown" });
		render(<WorkPanel outputs={[output]} sources={[]} workspace="/work" open onClose={vi.fn()} />);
		fireEvent.click(screen.getByRole("button", { name: /report.md/i }));
		await screen.findByText("# R");
		fireEvent.click(screen.getByRole("button", { name: "Open output folder" }));
		expect(invoke).toHaveBeenCalledWith("open_workspace_folder", {
			path: "/work/report.md",
			workspace: "/work",
		});
	});

	it("retains an unavailable output row and reports failure inline", async () => {
		invoke.mockRejectedValueOnce(new Error("File unavailable"));
		render(<WorkPanel outputs={[output]} sources={[]} workspace="/work" open onClose={vi.fn()} />);
		fireEvent.click(screen.getByRole("button", { name: /report.md/i }));
		await screen.findByText("File unavailable");
		expect(screen.getByRole("button", { name: /report.md/i })).toBeInTheDocument();
	});

	it("clears selected preview when that identity disappears", async () => {
		invoke.mockResolvedValueOnce({ bytes: [120], mimeType: "text/plain" });
		const { rerender } = render(<WorkPanel outputs={[output]} sources={[]} workspace="/work" open onClose={vi.fn()} />);
		fireEvent.click(screen.getByRole("button", { name: /report.md/i }));
		await waitFor(() => expect(screen.getByTestId("artifact-filename")).toBeInTheDocument());
		rerender(<WorkPanel outputs={[]} sources={[]} workspace="/work" open onClose={vi.fn()} />);
		expect(screen.queryByTestId("artifact-filename")).toBeNull();
	});
});
```

Mock `openExternalUrl` in a separate test and assert a URL row opens `source.identity`, never its unnormalized display value.

- [ ] **Step 2: Run the component test and verify failure**

```bash
pnpm test -- src/components/WorkPanel.test.tsx
```

Expected: FAIL because `WorkPanel` does not exist.

- [ ] **Step 3: Implement one panel with two persistent sections**

Create `src/components/WorkPanel.tsx` with this contract:

```ts
interface WorkPanelProps {
	outputs: readonly WorkOutput[];
	sources: readonly WorkSource[];
	workspace: string;
	open: boolean;
	onClose: () => void;
}
```

Keep `selectedIdentity` local and create `const panelRef = useRef<HTMLElement>(null);`. Derive the selected output from current props and clear it in an effect when absent:

```ts
const selected = outputs.find((output) => output.identity === selectedIdentity) ?? null;
useEffect(() => {
	if (selectedIdentity && !outputs.some((output) => output.identity === selectedIdentity)) {
		setSelectedIdentity(null);
	}
}, [outputs, selectedIdentity]);
const load = useArtifactLoader(selected?.path ?? null, workspace);
```

Render:

```tsx
<aside
	ref={panelRef}
	className="work-panel"
	data-open={open ? "true" : "false"}
	role={open ? "dialog" : "region"}
	aria-modal={open ? true : undefined}
	aria-label="Work outputs and sources"
>
```

Task 6 uses this single panel node at every breakpoint. Medium/narrow closed state uses CSS `visibility: hidden` plus `pointer-events: none`; the wide container query restores static visible placement regardless of `data-open`. No duplicate panel/preview tree is created.

Outputs rows are buttons with filename/title and original `displayValue`. Selection renders loading text, `File unavailable`, or `ArtifactPreview`. Pass copy through `navigator.clipboard.writeText(selected.path)` and folder open through:

```ts
invoke("open_workspace_folder", { path: selected.path, workspace })
```

Sources:

- URL source: button calls `openExternalUrl(source.identity)`.
- File source: non-navigable row plus a `Copy reference path` button. Do not preview/open arbitrary attached files outside the workspace.
- Empty sections remain present with `No outputs yet` and `No sources yet`.
- Close button has `aria-label="Close Work panel"`.

Catch copy/open errors locally and leave the panel usable; do not remove records.

- [ ] **Step 4: Run focused tests and typecheck**

```bash
pnpm test -- src/components/WorkPanel.test.tsx src/components/ArtifactPreview.test.tsx
pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/WorkPanel.tsx src/components/WorkPanel.test.tsx
git commit -m "feat(frontend): add work outputs and sources rail"
```

---

### Task 5: Render Active Work as a Document Without Remounting the Composer

**Files:**
- Create: `src/work/WorkHeader.tsx`
- Create: `src/work/WorkHeader.test.tsx`
- Create: `src/work/WorkSessionView.tsx`
- Create: `src/work/WorkSessionView.test.tsx`
- Create: `src/chat/QueuedMessages.tsx`
- Create: `src/chat/QueuedMessages.test.tsx`
- Modify: `src/chat/ChatView.tsx`
- Modify: `src/chat/ChatView.test.tsx`
- Modify: `src/components/ChatMessage.tsx`
- Modify: `src/App.css`

- [ ] **Step 1: Add failing Work header and result tests**

Create `src/work/WorkHeader.test.tsx`:

```tsx
it("shows task title, Work label, and accessible drawer controls", () => {
	const onOpenSidebar = vi.fn();
	const onOpenPanel = vi.fn();
	render(<WorkHeader title="Research GPU deployment" onOpenSidebar={onOpenSidebar} onOpenPanel={onOpenPanel} />);
	expect(screen.getByRole("heading", { name: "Research GPU deployment" })).toBeInTheDocument();
	expect(screen.getByText("Work")).toBeInTheDocument();
	fireEvent.click(screen.getByRole("button", { name: "Open session sidebar" }));
	fireEvent.click(screen.getByRole("button", { name: "Open Outputs and Sources" }));
	expect(onOpenSidebar).toHaveBeenCalled();
	expect(onOpenPanel).toHaveBeenCalled();
});
```

Create `src/work/WorkSessionView.test.tsx`:

```tsx
it("renders user directions compactly and assistant content as a document", () => {
	const { container } = render(
		<WorkSessionView
			messages={[
				{ id: "u", role: "user", content: "Research this market", timestamp: 1 },
				{ id: "a", role: "assistant", content: "# Findings\nEvidence", timestamp: 2 },
			]}
			streamingMessage={null}
			isRunning={false}
			models={[]}
			detailsExpanded={false}
			workspaceCwd="/work"
		/,
	);
	expect(screen.getByText("Research this market").closest("blockquote")).toBeInTheDocument();
	expect(screen.getByRole("heading", { name: "Findings" })).toBeInTheDocument();
	expect(container.querySelector(".work-result-document")).toBeInTheDocument();
	expect(container.querySelector(".chat-bubble")).toBeNull();
});

it("shows quiet live activity and keeps detailed tools behind Ctrl+O state", () => {
	const running = {
		id: "a",
		role: "assistant" as const,
		content: "",
		timestamp: 2,
		isStreaming: true,
		toolCalls: [{ id: "t", name: "web_search_exa", args: {}, status: "running" as const }],
	};
	const { rerender } = render(
		<WorkSessionView messages={[]} streamingMessage={running} isRunning models={[]} detailsExpanded={false} workspaceCwd="/work" />,
	);
	expect(screen.getByText(/Searching the web/i)).toBeInTheDocument();
	rerender(<WorkSessionView messages={[]} streamingMessage={running} isRunning models={[]} detailsExpanded workspaceCwd="/work" />);
	expect(screen.getByText(/web_search_exa/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Extract the existing queue presentation under tests**

Create `src/chat/QueuedMessages.test.tsx` by moving the queue-only assertions from `ChatView.test.tsx`. Render:

```tsx
<QueuedMessages queue={{ steering: ["Change tone"], followUp: ["Add sources"] }} />
```

Assert order, `Steering`, `Follow-up`, one `Ctrl+↑` hint, threaded border class, and null output for empty queues.

- [ ] **Step 3: Add failing stable-composer test**

Add `fireEvent` to the existing Testing Library import in `src/chat/ChatView.test.tsx`, then use the real MessageInput node identity:

```tsx
it("keeps one composer node from Empty Work into Active Work", () => {
	const props = {
		sessionFile: "/work.jsonl",
		streamingMessage: null,
		isRunning: false,
		error: null,
		onSend: vi.fn(),
		onAbort: vi.fn(),
		mode: "work" as const,
		taskTitle: "Task title",
	};
	const { rerender } = render(<ChatView {...props} messages={[]} />);
	const before = screen.getByRole("textbox") as HTMLTextAreaElement;
	fireEvent.change(before, { target: { value: "draft survives" } });
	rerender(
		<ChatView
			{...props}
			messages={[
				{ id: "u", role: "user", content: "Start", timestamp: 1 },
				{ id: "a", role: "assistant", content: "Result", timestamp: 2 },
			]}
		/>,
	);
	const after = screen.getByRole("textbox") as HTMLTextAreaElement;
	expect(after).toBe(before);
	expect(after.value).toBe("draft survives");
	expect(screen.getByRole("heading", { name: "Task title" })).toBeInTheDocument();
});
```

Also add:

```ts
it("keeps active Chat on the existing bubble renderer", () => {
	const { container } = render(
		<ChatView
			sessionFile="/chat.jsonl"
			messages={[{ id: "a", role: "assistant", content: "Hello", timestamp: 1 }]}
			streamingMessage={null}
			isRunning={false}
			error={null}
			onSend={vi.fn()}
			onAbort={vi.fn()}
			mode="chat"
			taskTitle="Chat title"
		/>,
	);
	expect(container.querySelector(".chat-bubble")).toBeInTheDocument();
	expect(container.querySelector(".work-result-document")).toBeNull();
});
```

- [ ] **Step 4: Run focused tests and verify failure**

```bash
pnpm test -- src/work/WorkHeader.test.tsx src/work/WorkSessionView.test.tsx \
  src/chat/QueuedMessages.test.tsx src/chat/ChatView.test.tsx -t "Work|composer|queued|active Chat"
```

Expected: FAIL because Work components and the stable active-work branch do not exist.

- [ ] **Step 5: Implement the task header**

Create `src/work/WorkHeader.tsx`:

```tsx
import { Menu, PanelRightOpen } from "lucide-react";
import type { RefObject } from "react";

export function WorkHeader({
	title,
	onOpenSidebar,
	onOpenPanel,
	sidebarButtonRef,
	panelButtonRef,
}: {
	title: string;
	onOpenSidebar?: () => void;
	onOpenPanel?: () => void;
	sidebarButtonRef?: RefObject<HTMLButtonElement | null>;
	panelButtonRef?: RefObject<HTMLButtonElement | null>;
}) {
	return (
		<header className="work-header">
			{onOpenSidebar && (
				<button ref={sidebarButtonRef} type="button" className="work-sidebar-toggle" onClick={onOpenSidebar} aria-label="Open session sidebar">
					<Menu className="h-4 w-4" />
				</button>
			)}
			<div className="min-w-0 flex-1">
				<h1 className="truncate text-[length:var(--font-task-header)] font-semibold">{title || "Untitled task"}</h1>
				<span className="text-[length:var(--font-secondary)] text-muted-foreground">Work</span>
			</div>
			{onOpenPanel && (
				<button ref={panelButtonRef} type="button" className="work-panel-toggle" onClick={onOpenPanel} aria-label="Open Outputs and Sources">
					<PanelRightOpen className="h-4 w-4" />
				</button>
			)}
		</header>
	);
}
```

Both buttons retain visible `focus-visible:ring-2 focus-visible:ring-ring` classes in the implementation.

- [ ] **Step 6: Implement the document-style message surface**

Create `src/work/WorkSessionView.tsx`. It receives:

```ts
interface WorkSessionViewProps {
	messages: ChatMessage[];
	streamingMessage: ChatMessage | null;
	isRunning: boolean;
	models?: ModelInfo[];
	detailsExpanded: boolean;
	workspaceCwd: string;
}
```

For every user message, render a compact `<blockquote className="work-direction-row">` with its content and structured attachments. For assistant messages:

- render `ThinkingBlock` only when details are expanded;
- render `ActivityBlock` while streaming, `ActivityRecap` when complete, or `ToolCallTimeline` when details are expanded;
- render content with `ReactMarkdown`, `remarkGfm`, and the existing `markdownComponents` inside `<article className="work-result-document chat-markdown">`;
- keep `data-message-id` on each message root for Phase 5 selection boundaries;
- render no avatar, chat bubble, feedback/export strip, or duplicated composer.

System messages remain a quiet centered status line. Use current model-label behavior only if already available without copying private `ChatMessage` helpers; otherwise omit model chrome from Work result because the session header and model selector remain visible.

- [ ] **Step 7: Extract and reuse queued rendering**

Move the current `queuedItems` JSX from `ChatView` unchanged into `QueuedMessages`. Export:

```ts
export function QueuedMessages({
	queue,
}: {
	queue?: { steering: readonly string[]; followUp: readonly string[] };
})
```

Render it below either Chat or Work active messages. Do not duplicate queue editing state.

- [ ] **Step 8: Refactor ChatView into one stable center shell**

Add the optional task-title prop:

```ts
taskTitle?: string;
```

Compute:

```ts
const activeWork = mode === "work" && !isEmpty;
```

Keep one root, one stable `.session-center`, one keyed scroll region, one error slot, and the existing `motion.div key="composer"` as siblings for every empty/active/mode state. Change classes, not parent identity. Render:

- `WorkHeader` only when `activeWork`, with drawer callbacks omitted until Task 6;
- `WorkSessionView` inside the existing scroll region when `activeWork`;
- current `ChatMessageItem` mapping otherwise;
- `QueuedMessages` after either active surface;
- the exact existing `MessageInput` once, outside the scroll region.

Do not mount `WorkPanel` yet; Task 6 adds it together with complete responsive/drawer behavior, avoiding a broken unstyled intermediate rail.

Pass `workspaceCwd` to Chat tool details. Do not branch at App into two composer owners.

Add this explicit invariant comment beside the composer:

```tsx
// One keyed composer under one stable parent. Empty Work -> Active Work changes
// only the scroll surface; draft/files/focus/voice/model/queue state do not remount.
```

- [ ] **Step 9: Add document styles without responsive behavior yet**

In `src/App.css`, add:

```css
.session-work-container {
	container-name: work-session;
	container-type: inline-size;
}
.session-layout,
.session-center {
	min-width: 0;
	min-height: 0;
}
.session-layout {
	display: grid;
	grid-template-columns: minmax(0, 1fr);
	height: 100%;
}
.session-center {
	display: flex;
	flex-direction: column;
}
.work-header {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	min-height: 56px;
	padding: 0.65rem 1rem;
	border-bottom: 1px solid hsl(var(--border) / 0.65);
}
.work-result-stack {
	width: min(100%, 760px);
	margin-inline: auto;
	padding: 1.5rem 1.25rem 3rem;
}
.work-result-document {
	border: 0;
	background: transparent;
	padding: 0;
}
.work-direction-row {
	margin: 1rem 0;
	padding: 0.55rem 0.8rem;
	border-left: 2px solid hsl(var(--border));
	color: hsl(var(--muted-foreground));
	font-size: var(--font-user-message);
}
```

No panel breakpoint rules enter until Task 6.

- [ ] **Step 10: Run active Chat/Work regressions**

```bash
pnpm test -- src/work/WorkHeader.test.tsx src/work/WorkSessionView.test.tsx \
  src/chat/QueuedMessages.test.tsx src/chat/ChatView.test.tsx \
  src/components/MessageInput.test.tsx src/components/MessageInput.queue.test.tsx \
  src/components/MessageInput.steering.test.tsx src/components/MessageInput.paste.test.tsx
pnpm run typecheck
```

Expected: PASS. Empty Work → Active Work mount count remains one; active Chat tests remain unchanged.

- [ ] **Step 11: Commit**

```bash
git add src/work/WorkHeader.tsx src/work/WorkHeader.test.tsx \
  src/work/WorkSessionView.tsx src/work/WorkSessionView.test.tsx \
  src/chat/QueuedMessages.tsx src/chat/QueuedMessages.test.tsx \
  src/chat/ChatView.tsx src/chat/ChatView.test.tsx src/components/ChatMessage.tsx src/App.css
git commit -m "feat(frontend): add active work document canvas"
```

---

### Task 6: Integrate Task Identity and Responsive Drawers

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.sessions.test.tsx`
- Modify: `src/App.telemetry.test.tsx`
- Modify: `src/chat/ChatView.tsx`
- Modify: `src/chat/ChatView.test.tsx`
- Modify: `src/components/WorkPanel.tsx`
- Modify: `src/components/WorkPanel.test.tsx`
- Modify: `src/App.css`
- Create: `src/test/work-layout.test.ts`

- [ ] **Step 1: Add failing App ownership tests**

Extend the `ChatView` test double in `App.sessions.test.tsx` to render `taskTitle`, `drawer`, and buttons invoking `onDrawerChange("sidebar")` / `onDrawerChange("work-panel")` / `onDrawerChange(null)`. Accept `sidebarButtonRef` and `panelButtonRef` and attach them to the corresponding open buttons so focus-return tests exercise the real ref contract.

Add:

```ts
it("passes the active Work title and keyed projection state to the session shell", async () => {
	controller.states = new Map([["/w.jsonl", streamState("/w.jsonl", "Result", { mode: "work" })]]);
	controller.entries = [{ file: "/w.jsonl", title: "Market report", messageCount: 2, createdAt: 1, lastActivity: 2, mode: "work" }];
	render(<App />);
	fireEvent.click(await screen.findByRole("button", { name: "select /w.jsonl" }));
	expect(screen.getByTestId("task-title")).toHaveTextContent("Market report");
});

it("uses one mutually exclusive sidebar or Work-panel drawer state", async () => {
	controller.states = new Map([["/w.jsonl", streamState("/w.jsonl", "Result", { mode: "work" })]]);
	controller.entries = [{ file: "/w.jsonl", title: "Work", messageCount: 2, createdAt: 1, lastActivity: 2, mode: "work" }];
	render(<App />);
	fireEvent.click(await screen.findByRole("button", { name: "select /w.jsonl" }));
	fireEvent.click(screen.getByText("open-sidebar-drawer"));
	expect(screen.getByTestId("drawer-state")).toHaveTextContent("sidebar");
	fireEvent.click(screen.getByText("open-work-panel"));
	expect(screen.getByTestId("drawer-state")).toHaveTextContent("work-panel");
});

it("closes drawers when switching sessions", async () => {
	controller.states = new Map([
		["/a.jsonl", streamState("/a.jsonl", "A", { mode: "work" })],
		["/b.jsonl", streamState("/b.jsonl", "B", { mode: "chat" })],
	]);
	controller.entries = [
		{ file: "/a.jsonl", title: "A", messageCount: 2, createdAt: 1, lastActivity: 2, mode: "work" },
		{ file: "/b.jsonl", title: "B", messageCount: 2, createdAt: 1, lastActivity: 2, mode: "chat" },
	];
	render(<App />);
	fireEvent.click(await screen.findByRole("button", { name: "select /a.jsonl" }));
	fireEvent.click(screen.getByText("open-work-panel"));
	fireEvent.click(screen.getByRole("button", { name: "select /b.jsonl" }));
	expect(screen.getByTestId("drawer-state")).toHaveTextContent("closed");
});
```

- [ ] **Step 2: Add failing drawer accessibility tests**

In `WorkPanel.test.tsx`, assert closed drawer content is hidden by the CSS contract, open state uses `role="dialog"`/`aria-modal="true"`, initial focus lands on Close, Tab/Shift+Tab stay within the panel, and Escape/backdrop invoke `onClose`.

In `App.sessions.test.tsx`, focus the mocked Work-panel trigger, open then close the drawer, and assert focus returns to that trigger. Repeat for the sidebar trigger. Also assert the mounted mobile sidebar wrapper uses `role="dialog"`, `aria-modal="true"`, and `aria-label="Sessions"`. Keep existing `Sidebar.test.tsx` navigation/collapse tests green.

- [ ] **Step 3: Add failing static CSS contract test**

Create `src/test/work-layout.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../App.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

describe("Work responsive layout contract", () => {
	it("uses a named content container and exact wide rail dimensions", () => {
		expect(css).toContain("container-name: work-session");
		expect(css).toContain("@container work-session (min-width: 1280px)");
		expect(css).toContain("304px");
	});

	it("caps the drawer and defines narrow overlay behavior", () => {
		expect(css).toContain("max-width: 320px");
		expect(css).toContain("@media (max-width: 767px)");
	});

	it("does not branch layout from JavaScript viewport APIs", () => {
		expect(app).not.toMatch(/innerWidth|matchMedia|ResizeObserver/);
	});

	it("removes transitions under reduced motion", () => {
		expect(css).toMatch(/prefers-reduced-motion[\s\S]*work-panel/);
	});
});
```

- [ ] **Step 4: Run tests and verify failure**

```bash
pnpm test -- src/App.sessions.test.tsx src/components/WorkPanel.test.tsx \
  src/components/Sidebar.test.tsx src/test/work-layout.test.ts
```

Expected: FAIL because App drawer ownership and responsive CSS do not exist.

- [ ] **Step 5: Add task title and one drawer union in App**

Add:

```ts
type OpenDrawer = null | "sidebar" | "work-panel";
const [openDrawer, setOpenDrawer] = useState<OpenDrawer>(null);
const sidebarDrawerTriggerRef = useRef<HTMLButtonElement>(null);
const workPanelTriggerRef = useRef<HTMLButtonElement>(null);
const closeDrawer = useCallback(() => {
	const trigger = openDrawer === "sidebar" ? sidebarDrawerTriggerRef : workPanelTriggerRef;
	setOpenDrawer(null);
	queueMicrotask(() => trigger.current?.focus());
}, [openDrawer]);
const activeSessionTitle =
	sessionEntries.find((entry) => entry.file === activeSessionFile)?.title ?? "Untitled task";
```

Reset on session identity:

```ts
useEffect(() => {
	setOpenDrawer(null);
}, [activeSessionFile]);
```

Pass to `ChatView`:

```tsx
taskTitle={activeSessionTitle}
drawer={openDrawer}
onDrawerChange={(drawer) => drawer === null ? closeDrawer() : setOpenDrawer(drawer)}
sidebarButtonRef={sidebarDrawerTriggerRef}
panelButtonRef={workPanelTriggerRef}
```

Close before selecting/new/open/delete. The union guarantees opening one drawer closes the other without another synchronization effect. Set `inert={openDrawer === "work-panel" ? true : undefined}` on the desktop sidebar wrapper and `inert={openDrawer === "sidebar" ? true : undefined}` on the main content wrapper. In ChatView, set `inert={drawer === "work-panel" ? true : undefined}` on `.session-center`; the WorkPanel remains its non-inert sibling.

Render a mobile Sidebar only when `openDrawer === "sidebar"`:

```tsx
{openDrawer === "sidebar" && (
	<div className="mobile-sidebar-layer md:hidden">
		<button type="button" className="drawer-backdrop" aria-label="Close session sidebar" onClick={closeDrawer} />
		<div role="dialog" aria-modal="true" aria-label="Sessions" className="mobile-sidebar-drawer">
			<Sidebar {...sidebarProps} collapsed={false} onCollapsedChange={closeDrawer} />
		</div>
	</div>
)}
```

Avoid duplicating the long Sidebar prop list by assigning one typed `sidebarProps` object and spreading it into desktop/mobile renderers. Add an Escape effect only while `openDrawer` is non-null; restore focus to the initiating header button through refs passed by `ChatView`/`WorkHeader`.

- [ ] **Step 6: Make closed drawers behaviorally closed**

In `ChatView`, add `RefObject` to the existing React type imports and add:

```ts
drawer?: null | "sidebar" | "work-panel";
onDrawerChange?: (drawer: null | "sidebar" | "work-panel") => void;
sidebarButtonRef?: RefObject<HTMLButtonElement | null>;
panelButtonRef?: RefObject<HTMLButtonElement | null>;
```

Pass callbacks/refs to `WorkHeader`. Derive the active projection only for the Work rail:

```ts
const projection = useMemo(
	() => deriveWorkProjection(streamingMessage ? [...messages, streamingMessage] : messages, workspaceCwd ?? ""),
	[messages, streamingMessage, workspaceCwd],
);
```

Render exactly one `WorkPanel` node for active Work. ChatView adds a backdrop only while the medium/narrow drawer state is open:

```tsx
{drawer === "work-panel" && (
	<button
		type="button"
		className="drawer-backdrop work-panel-backdrop"
		aria-label="Close Work panel"
		onClick={() => onDrawerChange?.(null)}
	/>
)}
<WorkPanel
	outputs={projection.outputs}
	sources={projection.sources}
	workspace={workspaceCwd ?? ""}
	open={drawer === "work-panel"}
	onClose={() => onDrawerChange?.(null)}
/>
```

The panel itself remains one DOM/React subtree with one selected identity and one artifact loader. CSS repositions that node from an absolute drawer to the static grid rail at the named-container breakpoint. Closed medium/narrow state uses `visibility: hidden`, `pointer-events: none`, and a translated transform, which removes descendants from focus/accessibility navigation without an `aria-hidden` attribute that would remain wrong at wide size. Wide CSS forces `visibility: visible`, `pointer-events: auto`, and `transform: none` regardless of `data-open`.

While `open` is true, WorkPanel focuses its close button in an effect, handles Escape, and cycles Tab/Shift+Tab across focusable descendants using `panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')`. App marks the desktop sidebar wrapper inert while `openDrawer === "work-panel"`; ChatView marks `.session-center` inert for that same state. When the mobile sidebar is open, App marks the main content wrapper inert. Thus the overlay has modal containment without a new dialog dependency. App's close callback restores focus to the WorkHeader trigger. If a user resizes an open drawer to wide, the conditional close button remains visible until they close it; no inaccessible stale state is created.

- [ ] **Step 7: Add exact CSS container and drawer rules**

Add:

```css
.mobile-sidebar-layer {
	position: absolute;
	inset: 0;
	z-index: 40;
}
.drawer-backdrop {
	position: absolute;
	inset: 0;
	background: hsl(var(--background) / 0.52);
	backdrop-filter: blur(2px);
}
.work-panel,
.mobile-sidebar-drawer {
	position: absolute;
	top: 0;
	right: 0;
	bottom: 0;
	width: min(320px, calc(100% - 2rem));
	max-width: 320px;
	background: hsl(var(--sidebar-background));
	border-left: 1px solid hsl(var(--border));
	overflow-y: auto;
	transition: transform 180ms ease, opacity 180ms ease;
}
.work-panel {
	z-index: 41;
	visibility: hidden;
	pointer-events: none;
	opacity: 0;
	transform: translateX(100%);
}
.work-panel[data-open="true"] {
	visibility: visible;
	pointer-events: auto;
	opacity: 1;
	transform: translateX(0);
}

@container work-session (min-width: 1280px) {
	.session-layout[data-active-work="true"] {
		grid-template-columns: minmax(0, 1fr) 304px;
	}
	.work-panel {
		position: static;
		width: 304px;
		min-width: 304px;
		max-width: none;
		visibility: visible;
		pointer-events: auto;
		opacity: 1;
		transform: none;
	}
	.work-panel-backdrop,
	.work-panel-toggle {
		display: none;
	}
}

@media (min-width: 768px) {
	.work-sidebar-toggle {
		display: none;
	}
}

@media (max-width: 767px) {
	.mobile-sidebar-drawer {
		left: 0;
		right: auto;
		width: min(288px, calc(100% - 2rem));
	}
}

@media (prefers-reduced-motion: reduce) {
	.work-panel,
	.mobile-sidebar-drawer,
	.drawer-backdrop {
		transition: none;
	}
}
```

Ensure `.panel-raised` and `.session-work-container` are positioned so absolute layers cover only the content panel, not native window chrome.

- [ ] **Step 8: Run App, drawer, layout, and concurrency regressions**

```bash
pnpm test -- src/App.sessions.test.tsx src/App.telemetry.test.tsx \
  src/chat/ChatView.test.tsx src/components/WorkPanel.test.tsx \
  src/components/Sidebar.test.tsx src/test/work-layout.test.ts \
  src/hooks/usePiStream.session.test.ts
pnpm run validate
pnpm run build:frontend
```

Expected: PASS. Hidden sessions continue updating because drawer state never changes keyed stream ownership.

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx src/App.sessions.test.tsx src/App.telemetry.test.tsx \
  src/chat/ChatView.tsx src/chat/ChatView.test.tsx \
  src/components/WorkPanel.tsx src/components/WorkPanel.test.tsx \
  src/App.css src/test/work-layout.test.ts
git commit -m "feat(frontend): add responsive work panel drawers"
```

---

### Task 7: Remove Placeholders and Validate the Phase Boundary

**Files:**
- Delete: `src/components/RightPanel.tsx`
- Delete: `src/components/DocumentsPanel.tsx`
- Modify only files required by verified failing regressions.

- [ ] **Step 1: Prove placeholders are unused, then delete them**

```bash
rg -n 'RightPanel|DocumentsPanel' src --glob '*.{ts,tsx}'
```

Expected before deletion: definitions only in their own files. Delete both files. Run the grep again; expected: no matches.

- [ ] **Step 2: Run live/reload projection equivalence tests**

Add one integration fixture to `src/lib/work-projections.test.ts` that represents the same Work turn twice:

1. live `ToolCallInfo` with `outputPath`, `details`, and result;
2. snapshot-shaped `ToolCallInfo` produced by the sidecar converter.

Assert:

```ts
expect(deriveWorkProjection(liveMessages, "/work/acme"))
	.toEqual(deriveWorkProjection(reloadedMessages, "/work/acme"));
```

Run:

```bash
pnpm test -- src/lib/work-projections.test.ts -t "live and reloaded"
(cd agent-sidecar && pnpm test -- src/session-output-path.test.ts src/extractChatMessages.test.ts)
```

Expected: PASS.

- [ ] **Step 3: Run all automated project gates**

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
- frontend production build succeeds; record pre-existing bundle/dynamic-import warnings separately;
- sidecar tests/build pass;
- Rust fmt/clippy/tests pass;
- no whitespace errors.

For any behavior regression, first add the smallest test reproducing that observed failure, verify red for the expected reason, then fix it. Do not alter dependencies or audit allowlists.

- [ ] **Step 4: Verify security and scope statically**

```bash
rg -n 'allow-scripts|innerHTML' src/components/ArtifactPreview.tsx src/components/WorkPanel.tsx || true
rg -n 'javascript:|data:|file:' src/lib/work-projections.ts src/components/MarkdownComponents.tsx
rg -n 'read_workspace_artifact|open_workspace_folder|canonical_workspace_file|MAX_ARTIFACT_BYTES' src-tauri/src/lib.rs
rg -n 'RightPanel|DocumentsPanel' src --glob '*.{ts,tsx}' || true
rg -n 'SelectionActions|Ask AI|Start writing|contentEditable|document editor|artifact database' src --glob '!**/*.test.*' || true
rg -n 'innerWidth|matchMedia|ResizeObserver' src/App.tsx src/chat/ChatView.tsx src/work src/components/WorkPanel.tsx || true
git diff d991a1ed8 -- package.json pnpm-lock.yaml agent-sidecar/package.json agent-sidecar/pnpm-lock.yaml
```

Expected:

- no executable HTML sandbox token or raw SVG insertion;
- URL/path trust-boundary code and byte cap present;
- placeholders gone;
- no Phase 5/editor/database UI;
- no JS viewport branching;
- no dependency/lockfile changes.

- [ ] **Step 5: Verify shared renderers and keyed ownership**

```bash
rg -n '<ChatView|ChatView:' src --glob '*.tsx'
rg -n '<MessageInput' src --glob '*.tsx'
rg -n 'deriveWorkProjection' src --glob '*.{ts,tsx}'
rg -n 'outputPath' agent-sidecar/src src --glob '*.{ts,tsx}'
rg -n 'session_event|settledVersion|awaitingDone|removeSession|abortStream' src/hooks/usePiStream.ts src/App.tsx
```

Confirm:

1. App still renders one session shell and passes the active keyed state.
2. Empty Work → Active Work retains one mounted MessageInput.
3. Chat uses existing `ChatMessageItem` behavior.
4. Outputs/Sources use messages plus streaming message only; no persisted projection store exists.
5. Sidecar output path uses the emitting runtime cwd, not an active/global cwd.
6. Completion, sidecar-loss, abort, and deletion contracts are untouched.

- [ ] **Step 6: Run manual desktop acceptance when an interactive GUI is available**

Start `pnpm run tauri dev` and verify:

1. Empty Work still matches Phase 3 and switching Chat/Work before send keeps the typed draft.
2. Send first Work prompt; composer stays focused/mounted while the active document canvas appears.
3. Header shows the exact session task title and Work label.
4. User directions are compact rows; assistant Markdown is borderless and readable; activity remains quiet.
5. Attach, paste, voice, file mention/drop, model selection, slash command, Shift+Enter, steering, follow-up, Ctrl+↑ queue editing, abort, and retry still work.
6. Completed write/edit calls appear once in Outputs; editing the same path updates that row without moving it.
7. Assistant Markdown links, Exa `URL:` records, and attached references appear in Sources; code-block URLs and unsafe schemes do not.
8. Reload the Work session; Outputs/Sources and order exactly match the live session.
9. Select a valid workspace output; preview loads. Delete/move it; row remains and shows `File unavailable`.
10. HTML cannot run scripts or remote loads. Script/event-bearing SVG does not execute.
11. Wide content (`>=1280px`) shows a fixed 304px rail; center text stays readable.
12. Medium content shows no rail by default and opens a max-320px right drawer.
13. Narrow viewport makes sidebar and Work panel drawers mutually exclusive; Escape/backdrop close and focus returns to toggle.
14. Reduced motion disables drawer transitions.
15. Start Work A, switch to Chat B, run B, return to A; A's live document/rail update without reloading and B continues.
16. Active Chat layout/tool details remain unchanged.

Record headless/environment limits rather than claiming unperformed checks.

- [ ] **Step 7: Review final diff against Phase 4**

Run `code_review` against the Phase 3 start commit if configured. If unavailable, record the exact initialization/provider error and perform direct diff inspection plus one active-session `fusion` critique. Fix only verified Critical/Important defects, with a failing regression test before production changes.

Review lenses:

- canonical session cwd and live/reload output equivalence;
- URL/path normalization and stable dedupe order;
- structured source allowlist and Markdown parser semantics;
- Rust canonical containment, symlink escape, byte cap, and missing-file behavior;
- HTML CSP/sandbox, SVG sanitization, and unsafe Markdown links;
- one persistent composer and Chat regression safety;
- keyed hidden-session progress and panel selection reconciliation;
- closed-drawer accessibility, mutual exclusion, container breakpoints, and reduced motion;
- strict Phase 4 boundary.

- [ ] **Step 8: Commit verified cleanup/fixes only**

If no fixes are needed, do not create an empty commit. Otherwise:

```bash
git add <verified regression test and minimum fix files>
git commit -m "fix: harden active work canvas"
```

Delete placeholders in their own commit if no other verified cleanup commit exists:

```bash
git add src/components/RightPanel.tsx src/components/DocumentsPanel.tsx
git commit -m "refactor: remove obsolete work panel placeholders"
```

- [ ] **Step 9: Push while preserving draft PR state**

```bash
git status --short
git log --oneline d991a1ed8..HEAD
git push origin feat/chat-work-phase-1-runtime-identity
gh pr view 354 --json isDraft,state,mergedAt,headRefName,url
```

Expected: clean tree; Phase 4 commits pushed; PR #354 remains `OPEN`, `isDraft: true`, `mergedAt: null`. Do not rebase, mark ready, merge, close, or alter audit findings.

---

## Execution Checkpoints

1. **After Task 1:** inspect sidecar event/snapshot records; prove raw args unchanged and canonical output path/details equal live/reload.
2. **After Task 2:** inspect pure projections; prove URL/path edge cases, parser semantics, allowlisted structured sources, stable ordering, and malformed isolation.
3. **After Tasks 3–4:** inspect native security boundary and rail; prove missing/out-of-workspace files stay unavailable and unsafe content is inert.
4. **After Task 5:** inspect stable shell; prove one composer mount and unchanged active Chat.
5. **After Tasks 6–7:** inspect responsive/accessibility behavior, run full gates/review, push, and keep PR draft.

## Phase 4 Completion Criteria

Phase 4 is complete only when:

- active Work renders a task title, Work label, document-style assistant results, compact user directions, quiet activity, and one persistent composer;
- Empty Work remains the approved Phase 3 surface and does not lose draft/focus/files on first send;
- completed write/edit calls derive one latest output per normalized path with stable first appearance order;
- assistant Markdown links, allowlisted structured browse/search results, and attached references derive safe typed sources;
- live and reloaded messages produce byte-for-byte equal projection objects;
- URL/path normalization follows the approved display/identity contract without changing raw tool arguments;
- missing or unauthorized output files remain listed as `File unavailable`;
- native canonical containment and size limits gate file reads/folder opens;
- HTML has an empty sandbox plus restrictive CSP, SVG is sanitized and never inserted as raw executable markup, and unsafe Markdown links are non-navigable;
- wide content shows a fixed 304px rail, medium uses a max-320px drawer, and narrow sidebar/panel drawers are mutually exclusive and accessible;
- static responsive layout uses CSS container/media rules, not JavaScript viewport branching;
- `RightPanel` and `DocumentsPanel` are removed with no second source of truth;
- active Chat, concurrent hidden sessions, completion, model, queue, abort, deletion, file, voice, and command regressions remain green;
- no dependency/lockfile or Phase 5 changes appear;
- automated gates pass and PR #354 remains draft/unmerged.

## Deferred Phase 5 Contracts

- Work result message roots retain `data-message-id` for selected-text containment.
- Chat and Work assistant Markdown remain distinct visible surfaces but share safe link rendering.
- `MessageInput` remains the sole owner of send/steer/follow-up semantics; Phase 5 adds quoted context, not another composer.
- The responsive drawer union and keyed session identity remain stable while selection actions are added.
- Outputs/Sources stay projections and are not expanded into an editor or clipping database.
