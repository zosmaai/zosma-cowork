import { cleanupMocks, mockInvoke } from "@/test/mocks";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GREETING_FALLBACK, useGreeting } from "./useGreeting";

const CACHE_KEY = "cowork:greeting";

describe("useGreeting", () => {
	beforeEach(() => {
		sessionStorage.clear();
	});
	afterEach(() => {
		cleanupMocks();
		sessionStorage.clear();
	});

	it("uses a fresh cache hit and skips the generate_greeting call", () => {
		sessionStorage.setItem(CACHE_KEY, JSON.stringify({ text: "cached line", ts: Date.now() }));
		const invoke = mockInvoke(async () => ({}));

		const { result } = renderHook(() => useGreeting());

		expect(result.current).toBe("cached line");
		expect(invoke).not.toHaveBeenCalled();
	});

	it("falls back to the static string when generation errors", async () => {
		mockInvoke(async () => {
			throw new Error("sidecar down");
		});

		const { result } = renderHook(() => useGreeting());

		await waitFor(() => expect(result.current).toBe(GREETING_FALLBACK));
	});

	it("refetches when the cached greeting has expired (TTL)", async () => {
		// Cache stamped 31 min ago — past the 30-min TTL.
		const stale = Date.now() - 31 * 60 * 1000;
		sessionStorage.setItem(CACHE_KEY, JSON.stringify({ text: "stale line", ts: stale }));

		const calls: string[] = [];
		mockInvoke(async (cmd) => {
			calls.push(cmd);
			if (cmd === "list_sessions") return { sessions: [{ title: "Refactor auth" }] };
			if (cmd === "generate_greeting") return { text: "fresh line" };
			return {};
		});

		const { result } = renderHook(() => useGreeting());

		await waitFor(() => expect(result.current).toBe("fresh line"));
		expect(calls).toContain("generate_greeting");
	});
});
