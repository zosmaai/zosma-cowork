import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { describe, expect, it } from "vitest";
import { useSelectionActions } from "./useSelectionActions";

function Harness({ sessionKey = "/a.jsonl" }: { sessionKey?: string }) {
	const rootRef = useRef<HTMLDivElement>(null);
	const { selection } = useSelectionActions(rootRef, sessionKey);
	return (
		<div ref={rootRef} data-testid="scroll-root">
			<div data-assistant-response="a"><span>Selectable answer</span></div>
			<div data-message-id="u"><span>User text</span></div>
			<button type="button" data-selection-actions>Toolbar action</button>
			<output>{selection?.excerpt ?? "closed"}</output>
		</div>
	);
}

function selectText(element: Element) {
	const node = element.firstChild!;
	const range = document.createRange();
	range.selectNodeContents(node);
	Object.defineProperty(range, "getBoundingClientRect", {
		value: () => ({ left: 80, top: 120, right: 180, bottom: 140, width: 100, height: 20 }),
	});
	const selection = window.getSelection()!;
	selection.removeAllRanges();
	selection.addRange(range);
	act(() => document.dispatchEvent(new Event("selectionchange")));
}

describe("useSelectionActions", () => {
	it("opens for a valid keyboard or pointer selection", () => {
		render(<Harness />);
		selectText(screen.getByText("Selectable answer"));
		expect(screen.getByText("Selectable answer", { selector: "output" })).toBeInTheDocument();
	});

	it("closes when the selection collapses", () => {
		render(<Harness />);
		selectText(screen.getByText("Selectable answer"));
		window.getSelection()!.removeAllRanges();
		act(() => document.dispatchEvent(new Event("selectionchange")));
		expect(screen.getByText("closed", { selector: "output" })).toBeInTheDocument();
	});

	it("closes when its scroll container scrolls", () => {
		render(<Harness />);
		selectText(screen.getByText("Selectable answer"));
		fireEvent.scroll(screen.getByTestId("scroll-root"));
		expect(screen.getByText("closed", { selector: "output" })).toBeInTheDocument();
	});

	it("closes on Escape", () => {
		render(<Harness />);
		selectText(screen.getByText("Selectable answer"));
		fireEvent.keyDown(window, { key: "Escape" });
		expect(screen.getByText("closed", { selector: "output" })).toBeInTheDocument();
	});

	it("closes on pointer down outside the toolbar", () => {
		render(<Harness />);
		selectText(screen.getByText("Selectable answer"));
		fireEvent.pointerDown(document.body);
		expect(screen.getByText("closed", { selector: "output" })).toBeInTheDocument();
	});

	it("keeps the stored excerpt while focus or pointer is inside the toolbar", () => {
		render(<Harness />);
		selectText(screen.getByText("Selectable answer"));
		const action = screen.getByRole("button", { name: "Toolbar action" });
		action.focus();
		fireEvent.pointerDown(action);
		expect(screen.getByText("Selectable answer", { selector: "output" })).toBeInTheDocument();
	});

	it("never exposes a previous session selection during the session-change render", () => {
		const view = render(<Harness sessionKey="/a.jsonl" />);
		selectText(screen.getByText("Selectable answer"));
		view.rerender(<Harness sessionKey="/b.jsonl" />);
		expect(screen.getByText("closed", { selector: "output" })).toBeInTheDocument();
	});

	it("ignores selection outside the supplied scroll root", () => {
		render(<Harness />);
		const outside = document.createElement("span");
		outside.textContent = "Outside text";
		document.body.append(outside);
		selectText(outside);
		expect(screen.getByText("closed", { selector: "output" })).toBeInTheDocument();
		outside.remove();
	});
});
