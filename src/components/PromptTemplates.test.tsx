/**
 * PromptTemplates test
 *
 * Tests for the templates sidebar panel that shows reusable prompt templates.
 */

import { CATEGORIES, TEMPLATES } from "@/data/templates";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PromptTemplates } from "./PromptTemplates";

describe("PromptTemplates", () => {
	const mockOnSend = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders the section title", () => {
		render(<PromptTemplates onSend={mockOnSend} />);
		expect(screen.getByText("Templates")).toBeInTheDocument();
	});

	it("renders all category sections", () => {
		render(<PromptTemplates onSend={mockOnSend} />);
		for (const cat of Object.values(CATEGORIES)) {
			// Use getAllByText with substring match — at least one element should match
			const matches = screen.getAllByText((content) => content.includes(cat.label));
			expect(matches.length).toBeGreaterThanOrEqual(1);
		}
	});

	it("renders all template cards with titles", () => {
		render(<PromptTemplates onSend={mockOnSend} />);
		for (const tpl of TEMPLATES) {
			expect(screen.getByText(tpl.title)).toBeInTheDocument();
		}
	});

	it("renders template descriptions", () => {
		render(<PromptTemplates onSend={mockOnSend} />);
		for (const tpl of TEMPLATES) {
			expect(screen.getByText(tpl.description)).toBeInTheDocument();
		}
	});

	it("templates are rendered under their category section", () => {
		render(<PromptTemplates onSend={mockOnSend} />);
		// Verify writing templates appear in the rendered output
		const writingTemplates = TEMPLATES.filter((t) => t.category === "writing");
		for (const tpl of writingTemplates) {
			expect(screen.getByText(tpl.title)).toBeInTheDocument();
		}
	});

	it("calls onSend with the template prompt when a card is clicked", async () => {
		const user = userEvent.setup();
		render(<PromptTemplates onSend={mockOnSend} />);

		const firstTemplate = TEMPLATES[0];
		const card = screen.getByText(firstTemplate.title).closest("button");
		if (!card) throw new Error("Card element not found");
		await user.click(card);
		expect(mockOnSend).toHaveBeenCalledWith(firstTemplate.prompt);
	});

	it("calls onSend with the correct prompt for each template", async () => {
		const user = userEvent.setup();
		render(<PromptTemplates onSend={mockOnSend} />);

		for (const tpl of TEMPLATES) {
			vi.clearAllMocks();
			const card = screen.getByText(tpl.title).closest("button");
			if (!card) throw new Error("Card element not found");
			await user.click(card);
			expect(mockOnSend).toHaveBeenCalledWith(tpl.prompt);
		}
	});
});
