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
		expect(buildGreeting(at(8))).toMatch(/^Good morning[.,]/);
		expect(buildGreeting(at(14))).toMatch(/^Good afternoon[.,]/);
		expect(buildGreeting(at(20))).toMatch(/^Good evening[.,]/);
		expect(buildGreeting(at(2))).toMatch(/^Working late[.,]/);
		expect(buildGreeting(at(23))).toMatch(/^Working late[.,]/);
	});

	it("uses the generic tail when there is no session history or name", () => {
		expect(buildGreeting(at(20))).toBe(`Good evening. ${GREETING_FALLBACK}`);
	});

	it("includes the user name when available", () => {
		expect(buildGreeting(at(20), "arjun")).toBe(
			`Good evening, Arjun. ${GREETING_FALLBACK}`,
		);
	});

	it("capitalises the first letter of a lower-case name", () => {
		expect(buildGreeting(at(8), "arjun")).toContain("Good morning, Arjun");
	});

	it("references a pinned session (takes priority over recent)", () => {
		expect(buildGreeting(at(20), undefined, "Sales Report")).toBe(
			'Good evening. Ready for "Sales Report"?',
		);
	});

	it("references a pinned session with the user name", () => {
		expect(buildGreeting(at(20), "arjun", "Sales Report")).toBe(
			'Good evening, Arjun. Ready for "Sales Report"?',
		);
	});

	it("references the last session title when pinned is absent", () => {
		expect(buildGreeting(at(20), undefined, undefined, "Refactor auth")).toBe(
			'Good evening. Pick up where you left off on "Refactor auth"?',
		);
	});

	it("references the last session title with the user name", () => {
		expect(buildGreeting(at(20), "arjun", undefined, "Refactor auth")).toBe(
			'Good evening, Arjun. Pick up where you left off on "Refactor auth"?',
		);
	});

	it("truncates an overlong title", () => {
		const long = "A".repeat(60);
		const out = buildGreeting(at(20), undefined, undefined, long);
		expect(out).toContain("…");
		expect(out.length).toBeLessThan(
			`Good evening. Pick up what you left off on "${long}"?`.length,
		);
	});

	it("pinned session outranks recent session even when both are given", () => {
		const out = buildGreeting(at(20), "arjun", "Pinned Thing", "Recent Thing");
		expect(out).toContain("Pinned Thing");
		expect(out).not.toContain("Recent Thing");
	});
});

describe("useGreeting", () => {
	afterEach(() => cleanupMocks());

	it("shows name + pinned session when both exist", async () => {
		mockInvoke(async (cmd) => {
			if (cmd === "list_sessions")
				return {
					sessions: [
						{ title: "Sales Report", lastActivity: 999, pinned: true },
						{ title: "Old unpinned", lastActivity: 100 },
					],
				};
			if (cmd === "get_username") return "arjun";
			return {};
		});

		const { result } = renderHook(() => useGreeting());

		await waitFor(() =>
			expect(result.current).toContain('Ready for "Sales Report"?'),
		);
	});

	it("shows name + most recent unpinned when nothing is pinned", async () => {
		mockInvoke(async (cmd) => {
			if (cmd === "list_sessions")
				return {
					sessions: [
						{ title: "Old unpinned", lastActivity: 100 },
						{ title: "New work", lastActivity: 999 },
					],
				};
			if (cmd === "get_username") return "arjun";
			return {};
		});

		const { result } = renderHook(() => useGreeting());

		await waitFor(() =>
			expect(result.current).toContain('Pick up where you left off on "New work"'),
		);
	});

	it("shows name-only greeting when there's no session history", async () => {
		mockInvoke(async (cmd) => {
			if (cmd === "list_sessions") return { sessions: [] };
			if (cmd === "get_username") return "arjun";
			return {};
		});

		const { result } = renderHook(() => useGreeting());

		await waitFor(() => {
			expect(result.current).toContain(GREETING_FALLBACK);
			expect(result.current).toContain("Arjun");
		});
	});

	it("survives a sidecar error and keeps a valid time-only greeting", async () => {
		mockInvoke(async () => {
			throw new Error("sidecar down");
		});

		const { result } = renderHook(() => useGreeting());

		await waitFor(() =>
			expect(result.current).toMatch(/[.,]/),
		);
		expect(result.current).not.toContain("Pick up");
	});
});
