import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPromptScheduler } from "./prompt-scheduler.js";
import {
	SessionRuntimeManager,
	snapshotRuntime,
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
		reload: vi.fn().mockResolvedValue(undefined),
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

	describe("snapshotRuntime", () => {
		it("snapshots an explicit persisted mode without changing the default", () => {
			const runtime = fakeRuntime("/tmp/a.jsonl");
			expect(snapshotRuntime(runtime).mode).toBe("chat");
			expect(snapshotRuntime(runtime, "work").mode).toBe("work");
		});
	});
});
