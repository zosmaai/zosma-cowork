import { cleanupMocks } from "@/test/mocks";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock @tauri-apps/plugin-dialog
const mockOpen = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-dialog", () => ({
	open: mockOpen,
}));

import { useFilePicker } from "./useFilePicker";

describe("useFilePicker", () => {
	afterEach(() => {
		cleanupMocks();
	});

	it("starts with empty file list", () => {
		const { result } = renderHook(() => useFilePicker());
		expect(result.current.selectedFiles).toEqual([]);
	});

	it("opens dialog and adds selected files on pickFiles", async () => {
		mockOpen.mockResolvedValue(["/home/user/doc.txt", "/home/user/image.png"]);
		const { result } = renderHook(() => useFilePicker());

		await act(async () => {
			await result.current.pickFiles();
		});

		expect(mockOpen).toHaveBeenCalledWith({
			multiple: true,
			title: "Select files",
		});
		expect(result.current.selectedFiles).toHaveLength(2);
		expect(result.current.selectedFiles[0]).toEqual({
			path: "/home/user/doc.txt",
			name: "doc.txt",
		});
		expect(result.current.selectedFiles[1]).toEqual({
			path: "/home/user/image.png",
			name: "image.png",
		});
	});

	it("handles single file selection from dialog", async () => {
		mockOpen.mockResolvedValue("/home/user/single.ts");
		const { result } = renderHook(() => useFilePicker());

		await act(async () => {
			await result.current.pickFiles();
		});

		expect(result.current.selectedFiles).toHaveLength(1);
		expect(result.current.selectedFiles[0].name).toBe("single.ts");
	});

	it("handles cancelled dialog (null)", async () => {
		mockOpen.mockResolvedValue(null);
		const { result } = renderHook(() => useFilePicker());

		await act(async () => {
			await result.current.pickFiles();
		});

		expect(result.current.selectedFiles).toEqual([]);
	});

	it("removes a file by path", async () => {
		mockOpen.mockResolvedValue(["/a.ts", "/b.ts", "/c.ts"]);
		const { result } = renderHook(() => useFilePicker());

		await act(async () => {
			await result.current.pickFiles();
		});

		act(() => {
			result.current.removeFile("/b.ts");
		});

		expect(result.current.selectedFiles).toHaveLength(2);
		expect(result.current.selectedFiles.map((f) => f.path)).toEqual(["/a.ts", "/c.ts"]);
	});

	it("removing last file clears the list", async () => {
		mockOpen.mockResolvedValue(["/x.rs"]);
		const { result } = renderHook(() => useFilePicker());

		await act(async () => {
			await result.current.pickFiles();
		});

		act(() => {
			result.current.removeFile("/x.rs");
		});

		expect(result.current.selectedFiles).toEqual([]);
	});

	it("clears all files", async () => {
		mockOpen.mockResolvedValue(["/a.ts", "/b.ts"]);
		const { result } = renderHook(() => useFilePicker());

		await act(async () => {
			await result.current.pickFiles();
		});

		act(() => {
			result.current.clearFiles();
		});

		expect(result.current.selectedFiles).toEqual([]);
	});
});
