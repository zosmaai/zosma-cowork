import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ShareExport } from "./ShareExport";

const mockWriteText = vi.fn();
Object.defineProperty(navigator, "clipboard", {
	value: { writeText: mockWriteText },
	writable: true,
});

describe("ShareExport", () => {
	const mockMessages = [
		{ role: "user" as const, content: "Hello", timestamp: 1000 },
		{
			role: "assistant" as const,
			content: "Hi there!",
			timestamp: 2000,
			model: "claude-sonnet",
			provider: "anthropic",
		},
	];

	it("renders the export button", () => {
		render(<ShareExport messages={mockMessages} />);
		expect(screen.getByTitle("Export conversation")).toBeDefined();
	});

	it("renders the share button", () => {
		render(<ShareExport messages={mockMessages} />);
		expect(screen.getByTitle("Share Zosma Cowork")).toBeDefined();
	});

	it("copies markdown export to clipboard", async () => {
		mockWriteText.mockResolvedValue(undefined);
		render(<ShareExport messages={mockMessages} />);
		fireEvent.click(screen.getByTitle("Export conversation"));
		await vi.waitFor(() => {
			expect(mockWriteText).toHaveBeenCalled();
		});
		const markdown = mockWriteText.mock.calls[0][0];
		expect(markdown).toContain("# Zosma Cowork Conversation");
		expect(markdown).toContain("**You:**");
		expect(markdown).toContain("**Zosma:**");
		expect(markdown).toContain("Hello");
		expect(markdown).toContain("Hi there!");
	});

	it("copies app repo URL to clipboard", async () => {
		mockWriteText.mockResolvedValue(undefined);
		render(<ShareExport messages={mockMessages} />);
		fireEvent.click(screen.getByTitle("Share Zosma Cowork"));
		await vi.waitFor(() => {
			expect(mockWriteText).toHaveBeenCalledWith("https://github.com/zosmaai/zosma-cowork");
		});
	});

	it("shows tooltip briefly after copy", async () => {
		mockWriteText.mockResolvedValue(undefined);
		render(<ShareExport messages={mockMessages} />);
		fireEvent.click(screen.getByTitle("Export conversation"));
		await vi.waitFor(() => {
			expect(screen.getByText("Copied!")).toBeDefined();
		});
	});
});
