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
	it("forwards every agent event to stdout", async () => {
		const send = vi.fn();
		vi.doMock("./protocol.js", () => ({
			send,
			log: vi.fn(),
			logDebug: vi.fn(),
			logWarn: vi.fn(),
			logError: vi.fn(),
		}));
		const { subscribeSession } = await import("./prompt-runner.js");
		let cb: ((e: unknown) => void) | undefined;
		subscribeSession({ subscribe: (f) => { cb = f; } });
		cb?.({ type: "text", text: "hi" });
		expect(send).toHaveBeenCalledWith({ type: "event", event: { type: "text", text: "hi" } });
		vi.resetModules();
	});

	// Regression guard: no session may be subscribed with a bare event-forward
	// that skips the watchdog heartbeat. All three sites (init + 2 rebinds)
	// must route through subscribeSession.
	it("no rebind bypasses subscribeSession with a bare event-forward", () => {
		for (const rel of ["index.ts", "commands/handlers/sessions.ts"]) {
			const src = readFileSync(join(here, rel), "utf8");
			expect(src, `${rel} has a bare .subscribe forwarding events`).not.toMatch(
				/\.subscribe\(\s*\([^)]*\)\s*=>\s*\{[^}]*type:\s*["']event["']/s,
			);
		}
	});
});
