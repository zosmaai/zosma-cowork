import { cleanupMocks } from "@/test/mocks";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePasteDetection } from "./usePasteDetection";

describe("usePasteDetection", () => {
	afterEach(() => {
		cleanupMocks();
	});

	it("starts with empty pasted images", () => {
		const { result } = renderHook(() => usePasteDetection());
		expect(result.current.pastedImages).toEqual([]);
	});

	it("detects pasted image from clipboard", async () => {
		const { result } = renderHook(() => usePasteDetection());

		const file = new File(["fake-png-data"], "screenshot.png", { type: "image/png" });
		const event = {
			clipboardData: {
				items: [
					{
						kind: "file",
						type: "image/png",
						getAsFile: () => file,
					},
				],
			},
			preventDefault: vi.fn(),
		} as unknown as ClipboardEvent;

		result.current.pasteHandler(event);
		expect(event.preventDefault).toHaveBeenCalled();

		// Wait for FileReader
		await new Promise((r) => setTimeout(r, 50));

		expect(result.current.pastedImages).toHaveLength(1);
		expect(result.current.pastedImages[0].type).toBe("image/png");
		expect(result.current.pastedImages[0].name).toBe("screenshot.png");
		expect(result.current.pastedImages[0].dataUrl).toContain("data:image/png;base64");
	});

	it("ignores non-image clipboard items", () => {
		const { result } = renderHook(() => usePasteDetection());

		const event = {
			clipboardData: {
				items: [
					{
						kind: "string",
						type: "text/plain",
					},
				],
			},
			preventDefault: vi.fn(),
		} as unknown as ClipboardEvent;

		result.current.pasteHandler(event);
		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(result.current.pastedImages).toEqual([]);
	});

	it("handles empty clipboard", () => {
		const { result } = renderHook(() => usePasteDetection());

		const event = {
			clipboardData: {
				items: [],
			},
			preventDefault: vi.fn(),
		} as unknown as ClipboardEvent;

		result.current.pasteHandler(event);
		expect(result.current.pastedImages).toEqual([]);
	});

	it("clears images after calling clearImages", async () => {
		const { result } = renderHook(() => usePasteDetection());

		const file = new File(["fake-png"], "img.png", { type: "image/png" });
		const event = {
			clipboardData: {
				items: [
					{
						kind: "file",
						type: "image/png",
						getAsFile: () => file,
					},
				],
			},
			preventDefault: vi.fn(),
		} as unknown as ClipboardEvent;

		result.current.pasteHandler(event);
		await new Promise((r) => setTimeout(r, 50));

		expect(result.current.pastedImages).toHaveLength(1);

		act(() => {
			result.current.clearImages();
		});
		expect(result.current.pastedImages).toEqual([]);
	});
});
