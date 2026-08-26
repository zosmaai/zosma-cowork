import type { AssistantSelection } from "@/lib/selection-actions";
import { createPortal } from "react-dom";

interface SelectionActionsProps {
	selection: AssistantSelection;
	onAsk: (excerpt: string) => void;
	onStartWriting: (excerpt: string) => void;
}

export function SelectionActions({ selection, onAsk, onStartWriting }: SelectionActionsProps) {
	const left = Math.max(116, Math.min(window.innerWidth - 116, selection.anchor.left));
	const placeBelow = selection.anchor.top < 56;
	return createPortal(
		<div
			role="toolbar"
			aria-label="Selection actions"
			className="selection-actions"
			data-selection-actions
			data-placement={placeBelow ? "below" : "above"}
			style={{ left, top: placeBelow ? selection.anchor.bottom : selection.anchor.top }}
			onPointerDown={(event) => event.preventDefault()}
			onMouseDown={(event) => event.preventDefault()}
		>
			<button type="button" onClick={() => onAsk(selection.excerpt)}>Ask AI</button>
			<button type="button" onClick={() => onStartWriting(selection.excerpt)}>
				Start writing
			</button>
		</div>,
		document.body,
	);
}
