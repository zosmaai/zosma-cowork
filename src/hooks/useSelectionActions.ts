import { readAssistantSelection, type AssistantSelection } from "@/lib/selection-actions";
import { type RefObject, useCallback, useEffect, useState } from "react";

type OwnedSelection = AssistantSelection & { sessionKey: string };

export function useSelectionActions(
	rootRef: RefObject<HTMLElement | null>,
	sessionKey: string,
) {
	const [stored, setStored] = useState<OwnedSelection | null>(null);
	const dismiss = useCallback(() => setStored(null), []);

	useEffect(() => {
		const update = () => {
			const browserSelection = window.getSelection();
			const next = readAssistantSelection(browserSelection);
			const root = rootRef.current;
			const range = browserSelection?.rangeCount ? browserSelection.getRangeAt(0) : null;
			const focusedToolbar = document.activeElement?.closest?.("[data-selection-actions]");
			if (!next || !root || !range || !root.contains(range.commonAncestorContainer)) {
				if (!focusedToolbar) setStored(null);
				return;
			}
			setStored({ ...next, sessionKey });
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") dismiss();
		};
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (target instanceof Element && target.closest("[data-selection-actions]")) return;
			dismiss();
		};
		document.addEventListener("selectionchange", update);
		document.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("keydown", onKeyDown);
		const root = rootRef.current;
		root?.addEventListener("scroll", dismiss, { passive: true });
		return () => {
			document.removeEventListener("selectionchange", update);
			document.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("keydown", onKeyDown);
			root?.removeEventListener("scroll", dismiss);
		};
	}, [rootRef, sessionKey, dismiss]);

	const selection = stored?.sessionKey === sessionKey ? stored : null;
	return { selection, dismiss };
}
