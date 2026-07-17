import { useCallback, useRef, useState } from "react";

interface UseFileDropOptions {
	onDrop: (filePaths: string[]) => void;
}

interface UseFileDropReturn {
	isDragging: boolean;
	handlers: {
		onDragEnter: (e: DragEvent) => void;
		onDragOver: (e: DragEvent) => void;
		onDragLeave: (e: DragEvent) => void;
		onDrop: (e: DragEvent) => void;
	};
}

/**
 * Hook to manage drag-and-drop state for a drop zone.
 * Uses a counter to handle dragEnter/dragLeave from child elements
 * without flickering the drop zone overlay.
 */
export function useFileDrop({ onDrop }: UseFileDropOptions): UseFileDropReturn {
	const [isDragging, setIsDragging] = useState(false);
	const dragCounter = useRef(0);

	const handleDragEnter = useCallback((e: DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		dragCounter.current += 1;
		if (e.dataTransfer?.types.includes("Files")) {
			setIsDragging(true);
		}
	}, []);

	const handleDragOver = useCallback((e: DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
	}, []);

	const handleDragLeave = useCallback((e: DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		dragCounter.current -= 1;
		if (dragCounter.current <= 0) {
			dragCounter.current = 0;
			setIsDragging(false);
		}
	}, []);

	const handleDrop = useCallback(
		(e: DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			setIsDragging(false);
			dragCounter.current = 0;

			const files = Array.from(e.dataTransfer?.files ?? []);
			if (files.length === 0) return;

			// Tauri provides file paths on the dropped files via the webview
			const paths = files
				.map((f) => (f as unknown as { path?: string }).path)
				.filter((p): p is string => !!p);

			if (paths.length > 0) {
				onDrop(paths);
			}
		},
		[onDrop],
	);

	return {
		isDragging,
		handlers: {
			onDragEnter: handleDragEnter,
			onDragOver: handleDragOver,
			onDragLeave: handleDragLeave,
			onDrop: handleDrop,
		},
	};
}
