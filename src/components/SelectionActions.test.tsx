import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SelectionActions } from "./SelectionActions";

const selection = {
	excerpt: "Selected answer",
	messageId: "a",
	anchor: { left: 200, top: 160, bottom: 180 },
};

describe("SelectionActions", () => {
	it("renders one labeled toolbar with two keyboard-reachable actions", async () => {
		const user = userEvent.setup();
		render(<SelectionActions selection={selection} onAsk={vi.fn()} onStartWriting={vi.fn()} />);
		const toolbar = screen.getByRole("toolbar", { name: "Selection actions" });
		expect(toolbar).toBeInTheDocument();
		await user.tab();
		expect(screen.getByRole("button", { name: "Ask AI" })).toHaveFocus();
		await user.tab();
		expect(screen.getByRole("button", { name: "Start writing" })).toHaveFocus();
	});

	it("preserves the browser selection on pointer down and activates Ask AI", () => {
		const onAsk = vi.fn();
		// biome-ignore lint/style/noNonNullAssertion: test helper
		const removeAllRanges = vi.spyOn(window.getSelection()!, "removeAllRanges");
		render(<SelectionActions selection={selection} onAsk={onAsk} onStartWriting={vi.fn()} />);
		const button = screen.getByRole("button", { name: "Ask AI" });
		const pointerDown = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
		button.dispatchEvent(pointerDown);
		expect(pointerDown.defaultPrevented).toBe(true);
		const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
		button.dispatchEvent(mouseDown);
		expect(mouseDown.defaultPrevented).toBe(true);
		fireEvent.click(button);
		expect(onAsk).toHaveBeenCalledWith("Selected answer");
		expect(removeAllRanges).not.toHaveBeenCalled();
	});
});
