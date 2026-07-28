import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFileDrop } from "./useFileDrop";

describe("useFileDrop", () => {
	it("starts with isDragging = false", () => {
		const { result } = renderHook(() => useFileDrop({ onDrop: () => {} }));
		expect(result.current.isDragging).toBe(false);
	});

	it("provides all four drag event handlers", () => {
		const { result } = renderHook(() => useFileDrop({ onDrop: () => {} }));
		expect(typeof result.current.handlers.onDragEnter).toBe("function");
		expect(typeof result.current.handlers.onDragOver).toBe("function");
		expect(typeof result.current.handlers.onDragLeave).toBe("function");
		expect(typeof result.current.handlers.onDrop).toBe("function");
	});

	it("handlers call preventDefault and stopPropagation without throwing", () => {
		const { result } = renderHook(() => useFileDrop({ onDrop: () => {} }));
		const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as DragEvent;
		act(() => {
			result.current.handlers.onDragEnter(event);
		});
		act(() => {
			result.current.handlers.onDragOver(event);
		});
		act(() => {
			result.current.handlers.onDragLeave(event);
		});
		act(() => {
			result.current.handlers.onDrop(event);
		});
		expect(event.preventDefault).toHaveBeenCalledTimes(4);
		expect(event.stopPropagation).toHaveBeenCalledTimes(4);
	});

	it("sets isDragging on dragEnter and resets on dragLeave with counter", () => {
		const { result } = renderHook(() => useFileDrop({ onDrop: () => {} }));
		const enterEvent = {
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
			dataTransfer: { types: ["Files"] },
		} as unknown as DragEvent;
		const leaveEvent = {
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
		} as unknown as DragEvent;

		// Enter
		act(() => { result.current.handlers.onDragEnter(enterEvent); });
		expect(result.current.isDragging).toBe(true);

		// Leave
		act(() => { result.current.handlers.onDragLeave(leaveEvent); });
		expect(result.current.isDragging).toBe(false);
	});

	it("handles nested enter/leave without flickering", () => {
		const { result } = renderHook(() => useFileDrop({ onDrop: () => {} }));
		const enterEvent = {
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
			dataTransfer: { types: ["Files"] },
		} as unknown as DragEvent;
		const leaveEvent = {
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
		} as unknown as DragEvent;

		// Enter main zone
		act(() => { result.current.handlers.onDragEnter(enterEvent); });
		expect(result.current.isDragging).toBe(true);
		// Enter child → counter=2, still dragging
		act(() => { result.current.handlers.onDragEnter(enterEvent); });
		expect(result.current.isDragging).toBe(true);
		// Leave child → counter=1, still dragging
		act(() => { result.current.handlers.onDragLeave(leaveEvent); });
		expect(result.current.isDragging).toBe(true);
		// Leave main → counter=0, not dragging
		act(() => { result.current.handlers.onDragLeave(leaveEvent); });
		expect(result.current.isDragging).toBe(false);
	});

	it("does not set isDragging on dragEnter when Files type is not present", () => {
		const { result } = renderHook(() => useFileDrop({ onDrop: () => {} }));
		const event = {
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
			dataTransfer: { types: ["text/plain"] },
		} as unknown as DragEvent;
		act(() => { result.current.handlers.onDragEnter(event); });
		expect(result.current.isDragging).toBe(false);
	});

	it("calls onDrop with paths from files that have a path property", () => {
		const onDrop = vi.fn();
		const { result } = renderHook(() => useFileDrop({ onDrop }));
		const file = { path: "/home/user/dragged.txt" } as unknown as File;
		const event = {
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
			dataTransfer: { files: [file] },
		} as unknown as DragEvent;
		act(() => { result.current.handlers.onDrop(event); });
		expect(onDrop).toHaveBeenCalledWith(["/home/user/dragged.txt"]);
	});

	it("does not call onDrop when no files are in the drop event", () => {
		const onDrop = vi.fn();
		const { result } = renderHook(() => useFileDrop({ onDrop }));
		const event = {
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
			dataTransfer: { files: [] },
		} as unknown as DragEvent;
		act(() => { result.current.handlers.onDrop(event); });
		expect(onDrop).not.toHaveBeenCalled();
	});
});
