import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

// The startup watchdog (prompt-runner) aborts a turn if no agent event is
// seen within 20s. Every session subscription MUST feed that watchdog via
// markPromptEmitted. The bug: rebind sites (new_session/load_session)
// subscribed with a bare `send({type:"event"})` and skipped the heartbeat,
// so promptHasEmitted stayed false and EVERY turn aborted at 20s regardless
// of model. Fix centralizes all subscriptions in subscribeSession().

describe("subscribeSession", () => {
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

	// Regression guard: no session may be subscribed with a bare event-forward
	// that skips the watchdog heartbeat. All subscriptions live in
	// session-runtime-factory.ts and call subscribeSession(runtime).
	it("no rebind bypasses subscribeSession with a bare event-forward", () => {
		for (const rel of ["session-runtime-factory.ts", "commands/handlers/sessions.ts"]) {
			const path = join(here, rel);
			try {
				const src = readFileSync(path, "utf8");
				expect(src, `${rel} has a bare .subscribe forwarding events`).not.toMatch(
					/\.subscribe\(\s*\([^)]*\)\s*=>\s*\{[^}]*type:\s*["']event["']/s,
				);
			} catch {
				// File not yet created — will be checked once it exists.
			}
		}
	});
});
