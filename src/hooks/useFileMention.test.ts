import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useFileMention } from "./useFileMention";

const mockReadDir = vi.fn();
vi.mock("@tauri-apps/plugin-fs", () => ({
	readDir: (...args: unknown[]) => mockReadDir(...args),
}));

vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn().mockResolvedValue("/home/user/project"),
}));

describe("useFileMention", () => {
	beforeEach(() => {
		mockReadDir.mockReset();
		mockReadDir.mockResolvedValue([
			{ name: "src", isDirectory: () => true },
			{ name: "package.json", isDirectory: () => false },
			{ name: "README.md", isDirectory: () => false },
			{ name: "asset-pipeline.config.js", isDirectory: () => false },
			{ name: "node_modules", isDirectory: () => true },
		]);
	});

	it("starts in idle state with empty results and loading true", () => {
		const { result } = renderHook(() => useFileMention());
		expect(result.current.state).toBe("idle");
		expect(result.current.results).toEqual([]);
		expect(result.current.triggerPosition).toBeNull();
		expect(result.current.loading).toBe(true);
	});

	it("transitions to active when @ is typed with whitespace before it", async () => {
		const { result } = renderHook(() => useFileMention());
		await act(async () => {});
		act(() => {
			result.current.onInput("check @", 7);
		});
		expect(result.current.state).toBe("active");
	});

	it("stays idle when @ is mid-word (not a mention trigger)", async () => {
		const { result } = renderHook(() => useFileMention());
		await act(async () => {});
		// "email@example.com" → the @ is mid-word, should not trigger
		act(() => {
			result.current.onInput("email@example.com", 15);
		});
		expect(result.current.state).toBe("idle");
	});

	it("stays idle when @ is at start of a word without preceding space", async () => {
		const { result } = renderHook(() => useFileMention());
		await act(async () => {});
		// "file@name" → @ is mid-word
		act(() => {
			result.current.onInput("file@name", 9);
		});
		expect(result.current.state).toBe("idle");
	});

	it("filters results as user types after @", async () => {
		const { result } = renderHook(() => useFileMention());
		await act(async () => {});
		act(() => {
			result.current.onInput("@src", 4);
		});
		expect(result.current.state).toBe("active");
		expect(result.current.results).toHaveLength(1);
		expect(result.current.results[0].name).toBe("src");
	});

	it("filters case-insensitively", async () => {
		const { result } = renderHook(() => useFileMention());
		await act(async () => {});
		act(() => {
			result.current.onInput("@README", 7);
		});
		expect(result.current.results).toHaveLength(1);
		expect(result.current.results[0].name).toBe("README.md");
	});

	it("shows all files when query is empty", async () => {
		const { result } = renderHook(() => useFileMention());
		await act(async () => {});
		act(() => {
			result.current.onInput("@", 1);
		});
		// Should show all 5 entries (no filtering)
		expect(result.current.results).toHaveLength(5);
	});

	it("shows empty results when nothing matches query", async () => {
		const { result } = renderHook(() => useFileMention());
		await act(async () => {});
		act(() => {
			result.current.onInput("@zzz_not_found", 15);
		});
		expect(result.current.results).toEqual([]);
	});

	it("transitions back to idle on cancel", async () => {
		const { result } = renderHook(() => useFileMention());
		await act(async () => {});
		act(() => {
			result.current.onInput("@", 1);
		});
		expect(result.current.state).toBe("active");
		act(() => {
			result.current.cancel();
		});
		expect(result.current.state).toBe("idle");
		expect(result.current.triggerPosition).toBeNull();
		expect(result.current.query).toBe("");
	});

	it("selectFile returns path and name and resets state", async () => {
		const { result } = renderHook(() => useFileMention());
		await act(async () => {});
		act(() => {
			result.current.onInput("@", 1);
		});
		expect(result.current.state).toBe("active");
		const selection = result.current.selectFile({
			name: "package.json",
			path: "/home/user/project/package.json",
			isDirectory: false,
		});
		expect(selection).toEqual({
			path: "/home/user/project/package.json",
			name: "package.json",
		});
		// State should reset after selection
		await waitFor(() => {
			expect(result.current.state).toBe("idle");
		});
	});

	it("sets triggerPosition to the index of @ character", async () => {
		const { result } = renderHook(() => useFileMention());
		await act(async () => {});
		act(() => {
			result.current.onInput("look at @file", 11);
		});
		expect(result.current.triggerPosition).toBe(8);
	});

	it("handles multiple @ symbols — uses the last one before cursor", async () => {
		const { result } = renderHook(() => useFileMention());
		await act(async () => {});
		act(() => {
			// "@old and @new" — indices: @=0, @=9 (before "new"), cursor at end
			result.current.onInput("@old and @new", 13);
		});
		// Should use the @ at index 9 (before "new"), not index 0
		expect(result.current.triggerPosition).toBe(9);
		expect(result.current.query).toBe("new");
	});

	it("handles backspace deleting past @ — returns to idle", async () => {
		const { result } = renderHook(() => useFileMention());
		await act(async () => {});
		act(() => {
			result.current.onInput("@", 1);
		});
		expect(result.current.state).toBe("active");
		// Simulate user deleting the @
		act(() => {
			result.current.onInput("", 0);
		});
		expect(result.current.state).toBe("idle");
	});
});
