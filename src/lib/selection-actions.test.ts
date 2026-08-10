import { describe, expect, it } from "vitest";
import { formatSelectionPrompt, readAssistantSelection } from "./selection-actions";

describe("formatSelectionPrompt", () => {
	it("serializes every excerpt line as a readable Markdown quote", () => {
		expect(formatSelectionPrompt("First line\n\nSecond line", "Explain this")).toBe(
			"> First line\n>\n> Second line\n\nExplain this",
		);
	});

	it("normalizes CRLF and trims the excerpt and instruction edges", () => {
		expect(formatSelectionPrompt("  alpha\r\nbeta  ", "  Compare these claims  ")).toBe(
			"> alpha\n> beta\n\nCompare these claims",
		);
	});

	it("returns an empty string for an empty excerpt", () => {
		expect(formatSelectionPrompt(" \n ", "Explain this")).toBe("");
	});

	it("returns an empty string for an empty instruction", () => {
		expect(formatSelectionPrompt("Evidence", "  ")).toBe("");
	});
});

function select(start: Node, end: Node = start): Selection {
	const range = document.createRange();
	range.setStart(start, 0);
	range.setEnd(end, end.textContent?.length ?? 0);
	Object.defineProperty(range, "getBoundingClientRect", {
		value: () => ({
			x: 80,
			y: 120,
			left: 80,
			top: 120,
			right: 180,
			bottom: 140,
			width: 100,
			height: 20,
			toJSON: () => ({}),
		}),
	});
	// biome-ignore lint/style/noNonNullAssertion: test helper
	const selection = window.getSelection()!;
	selection.removeAllRanges();
	selection.addRange(range);
	return selection;
}

describe("readAssistantSelection", () => {
	it("accepts text wholly inside one assistant response root", () => {
		document.body.innerHTML =
			'<div data-assistant-response="m1"><p id="one">Selected answer</p></div>';
		const selection = select(document.querySelector("#one")!.firstChild!);
		expect(readAssistantSelection(selection)).toEqual({
			excerpt: "Selected answer",
			messageId: "m1",
			anchor: { left: 130, top: 120, bottom: 140 },
		});
	});

	it("rejects a selection crossing assistant response roots", () => {
		document.body.innerHTML = [
			'<div data-assistant-response="m1"><p id="one">First</p></div>',
			'<div data-assistant-response="m2"><p id="two">Second</p></div>',
		].join("");
		const selection = select(
			document.querySelector("#one")!.firstChild!,
			document.querySelector("#two")!.firstChild!,
		);
		expect(readAssistantSelection(selection)).toBeNull();
	});

	it("rejects text outside an assistant response root", () => {
		document.body.innerHTML = '<div data-message-id="u1"><p id="user">User text</p></div>';
		expect(readAssistantSelection(select(document.querySelector("#user")!.firstChild!))).toBeNull();
	});

	it("rejects a collapsed or whitespace-only selection", () => {
		document.body.innerHTML =
			'<div data-assistant-response="m1"><p id="blank">   </p></div>';
		expect(readAssistantSelection(select(document.querySelector("#blank")!.firstChild!))).toBeNull();
	});
});
