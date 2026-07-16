import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import {
	convertAgentMessagesToChat,
	deriveTitle,
	mapSessionInfoToEntry,
	readMeta,
	renamePiSession,
	setPiSessionPinned,
	sortEntries,
	writeMeta,
} from "./pi-session-store.js";

function info(over: Partial<SessionInfo> = {}): SessionInfo {
	return {
		path: "/p/a.jsonl",
		id: "a",
		cwd: "/home/u/proj",
		created: new Date(1000),
		modified: new Date(2000),
		messageCount: 4,
		firstMessage: "Hello there world",
		allMessagesText: "Hello there world\nsecond msg",
		...over,
	} as SessionInfo;
}

describe("pi-session-store", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "pi-sess-"));
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	describe("deriveTitle", () => {
		it("falls back to 'Chat' for empty first message", () => {
			expect(deriveTitle("")).toBe("Chat");
		});
		it("truncates long titles", () => {
			expect(deriveTitle("x".repeat(100))).toBe(`${"x".repeat(77)}...`);
		});
	});

	describe("mapSessionInfoToEntry", () => {
		it("overlays a custom title from meta and locks it", () => {
			const e = mapSessionInfoToEntry(info(), { pinned: [], titles: { "/p/a.jsonl": "My Chat" } });
			expect(e.title).toBe("My Chat");
			expect(e.titleLocked).toBe(true);
		});
		it("marks pinned when path is in meta.pinned", () => {
			const e = mapSessionInfoToEntry(info(), { pinned: ["/p/a.jsonl"], titles: {} });
			expect(e.pinned).toBe(true);
		});
		it("derives a title from first message when no custom title/name", () => {
			const e = mapSessionInfoToEntry(info(), { pinned: [], titles: {} });
			expect(e.title).toBe("Hello there world");
			expect(e.titleLocked).toBe(false);
		});
	});

	describe("sortEntries", () => {
		it("puts pinned first, then most-recent", () => {
			const a = mapSessionInfoToEntry(info({ path: "/p/a.jsonl", modified: new Date(1) }), { pinned: ["/p/a.jsonl"], titles: {} });
			const b = mapSessionInfoToEntry(info({ path: "/p/b.jsonl", modified: new Date(999) }), { pinned: [], titles: {} });
			expect(sortEntries([b, a]).map((e) => e.file)).toEqual(["/p/a.jsonl", "/p/b.jsonl"]);
		});
	});

	describe("meta round-trip", () => {
		it("rename then read returns the custom title", () => {
			renamePiSession(dir, "/p/a.jsonl", "Renamed");
			expect(readMeta(dir).titles["/p/a.jsonl"]).toBe("Renamed");
		});
		it("pin then unpin", () => {
			setPiSessionPinned(dir, "/p/a.jsonl", true);
			expect(readMeta(dir).pinned).toContain("/p/a.jsonl");
			setPiSessionPinned(dir, "/p/a.jsonl", false);
			expect(readMeta(dir).pinned).not.toContain("/p/a.jsonl");
		});
		it("tolerates a corrupt meta file", () => {
			writeMeta(dir, { pinned: ["/x"], titles: {} });
			expect(readMeta(dir).pinned).toEqual(["/x"]);
		});
	});

	describe("convertAgentMessagesToChat", () => {
		it("assigns ids and pairs tool results with calls", () => {
			const out = convertAgentMessagesToChat([
				{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 },
				{
					role: "assistant",
					content: [{ type: "toolCall", id: "t1", name: "read", arguments: {} }],
					timestamp: 2,
				},
				{ role: "toolResult", toolCallId: "t1", content: [{ type: "text", text: "ok" }], timestamp: 3 },
			]);
			expect(out.every((m) => typeof m.id === "string")).toBe(true);
			const asst = out.find((m) => m.role === "assistant") as Record<string, unknown>;
			const tc = (asst.toolCalls as Array<Record<string, unknown>>)[0];
			expect(tc.status).toBe("completed");
			expect(tc.result).toBe("ok");
		});
	});
});
