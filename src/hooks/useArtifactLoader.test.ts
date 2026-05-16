import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useArtifactLoader } from "./useArtifactLoader";

const mockReadTextFile = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-fs", () => ({
	readTextFile: mockReadTextFile,
}));

describe("useArtifactLoader", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("returns null when filePath is null", () => {
		const { result } = renderHook(() => useArtifactLoader(null));
		expect(result.current).toBeNull();
	});

	it("loads file content for a valid HTML path", async () => {
		mockReadTextFile.mockResolvedValue("<h1>Hello</h1>");
		const { result } = renderHook(() => useArtifactLoader("/tmp/test.html"));

		await waitFor(() => {
			expect(result.current).toEqual({
				filePath: "/tmp/test.html",
				fileContent: "<h1>Hello</h1>",
				artifactType: "html",
			});
		});
	});

	it("loads file content for a code file path", async () => {
		mockReadTextFile.mockResolvedValue("const x = 1;");
		const { result } = renderHook(() => useArtifactLoader("/tmp/script.ts"));

		await waitFor(() => {
			expect(result.current).toEqual({
				filePath: "/tmp/script.ts",
				fileContent: "const x = 1;",
				artifactType: "code",
			});
		});
	});

	it("returns null on read error", async () => {
		mockReadTextFile.mockRejectedValue(new Error("file not found"));
		const { result } = renderHook(() => useArtifactLoader("/tmp/nonexistent.html"));

		await waitFor(() => expect(result.current).toBeNull());
	});

	it("cleans up on unmount", () => {
		mockReadTextFile.mockReturnValue(new Promise(() => {}));
		const { result, unmount } = renderHook(() => useArtifactLoader("/tmp/test.html"));

		unmount();
		expect(result.current).toBeNull();
	});

	it("resets to null when filePath becomes null", async () => {
		mockReadTextFile.mockResolvedValue("content");
		const { result, rerender } = renderHook(
			({ path }: { path: string | null }) => useArtifactLoader(path),
			{ initialProps: { path: "/tmp/first.html" } as { path: string | null } },
		);

		await waitFor(() => {
			expect(result.current).not.toBeNull();
			expect(result.current?.filePath).toBe("/tmp/first.html");
		});

		rerender({ path: null });
		expect(result.current).toBeNull();
	});
});
