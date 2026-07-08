/**
 * ModelSelector — controlled-open behaviour (slash-command /model wiring).
 *
 * Tests that `open` + `onOpenChange` props let App.tsx open the dropdown
 * programmatically (e.g. when the user types `/model` with no args).
 */
import { cleanupMocks } from "@/test/mocks";
import type { ModelInfo } from "@/types";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelSelector } from "./ModelSelector";

afterEach(() => cleanupMocks());

const MODELS: ModelInfo[] = [
	{
		id: "gpt-4o",
		name: "GPT-4o",
		provider: "openai",
		reasoning: false,
		contextWindow: 128000,
		maxTokens: 4096,
	},
	{
		id: "claude-3-5-sonnet",
		name: "Claude 3.5 Sonnet",
		provider: "anthropic",
		reasoning: false,
		contextWindow: 200000,
		maxTokens: 8192,
	},
];

function renderSelector(
	props: Partial<{ open: boolean; onOpenChange: (o: boolean) => void }> = {},
) {
	const onSelect = vi.fn();
	const onOpenChange = props.onOpenChange ?? vi.fn();
	render(
		<ModelSelector
			models={MODELS}
			currentModelId="openai/gpt-4o"
			onSelect={onSelect}
			open={props.open}
			onOpenChange={onOpenChange}
		/>,
	);
	return { onSelect, onOpenChange };
}

describe("ModelSelector — controlled open prop", () => {
	it("shows the dropdown immediately when open={true} without clicking the trigger", () => {
		renderSelector({ open: true });
		expect(screen.getByRole("listbox", { name: /select a model/i })).toBeInTheDocument();
		expect(screen.getByPlaceholderText(/search models/i)).toBeInTheDocument();
	});

	it("hides the dropdown when open={false}", () => {
		renderSelector({ open: false });
		expect(screen.queryByRole("listbox", { name: /select a model/i })).not.toBeInTheDocument();
	});

	it("calls onOpenChange(false) when Escape is pressed inside the dropdown", async () => {
		const user = userEvent.setup();
		const { onOpenChange } = renderSelector({ open: true });
		await user.keyboard("{Escape}");
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("calls onOpenChange(false) when a model is selected", async () => {
		const user = userEvent.setup();
		const { onOpenChange, onSelect } = renderSelector({ open: true });
		await user.click(screen.getByRole("option", { name: /claude 3.5 sonnet/i }));
		expect(onSelect).toHaveBeenCalledWith("anthropic", "claude-3-5-sonnet");
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("still opens/closes via the trigger button when no controlled prop is passed", async () => {
		const user = userEvent.setup();
		const onSelect = vi.fn();
		render(<ModelSelector models={MODELS} currentModelId="openai/gpt-4o" onSelect={onSelect} />);
		// dropdown is closed
		expect(screen.queryByRole("listbox", { name: /select a model/i })).not.toBeInTheDocument();
		// click trigger to open
		await user.click(screen.getByRole("button", { name: /gpt-4o/i }));
		expect(screen.getByRole("listbox", { name: /select a model/i })).toBeInTheDocument();
	});
});
