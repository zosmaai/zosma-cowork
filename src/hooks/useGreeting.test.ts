import { cleanupMocks, mockInvoke } from "@/test/mocks";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GREETING_FALLBACK, buildGreeting, useGreeting } from "./useGreeting";

function at(hour: number): Date {
	const d = new Date();
	d.setHours(hour, 0, 0, 0);
	return d;
}

describe("buildGreeting", () => {
	it("picks the salutation by time of day", () => {
		expect(buildGreeting(at(8))).toMatch(/^Good morning\./);
		expect(buildGreeting(at(14))).toMatch(/^Good afternoon\./);
		expect(buildGreeting(at(20))).toMatch(/^Good evening\./);
		expect(buildGreeting(at(2))).toMatch(/^Working late\./);
		expect(buildGreeting(at(23))).toMatch(/^Working late\./);
	});

	it("uses the generic tail when there is no recent session", () => {
		expect(buildGreeting(at(20))).toBe(`Good evening. ${GREETING_FALLBACK}`);
	});

	it("references the last session title when present", () => {
		expect(buildGreeting(at(20), "Refactor auth")).toBe(
			'Good evening. Pick up where you left off on "Refactor auth"?',
		);
	});

	it("truncates an overlong title", () => {
		const long = "A".repeat(60);
		const out = buildGreeting(at(20), long);
		expect(out).toContain("…");
		expect(out.length).toBeLessThan(`Good evening. Pick up where you left off on "${long}"?`.length);
	});
});

describe("useGreeting", () => {
	afterEach(() => cleanupMocks());

	it("upgrades to the most recently active session (ignores pinned order)", async () => {
		mockInvoke(async (cmd) => {
			if (cmd === "list_sessions")
				return {
					sessions: [
						{ title: "Pinned old", lastActivity: 100 },
						{ title: "Newest work", lastActivity: 999 },
					],
				};
			return {};
		});

		const { result } = renderHook(() => useGreeting());

		await waitFor(() => expect(result.current).toContain('Pick up where you left off on "Newest work"?'));
	});

	it("keeps the time-only greeting when there is no history", async () => {
		mockInvoke(async () => ({ sessions: [] }));

		const { result } = renderHook(() => useGreeting());
		// time-only line has the generic tail, never a session reference
		await waitFor(() => expect(result.current).toContain(GREETING_FALLBACK));
		expect(result.current).not.toContain("Pick up where you left off");
	});

	it("survives a sidecar error and keeps a valid greeting", async () => {
		mockInvoke(async () => {
			throw new Error("sidecar down");
		});

		const { result } = renderHook(() => useGreeting());
		await waitFor(() => expect(result.current).toMatch(/(morning|afternoon|evening|late)/));
	});
});
