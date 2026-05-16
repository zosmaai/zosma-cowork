import { cleanupMocks } from "@/test/mocks";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock @tauri-apps/plugin-dialog
const mockSave = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-dialog", () => ({
	save: mockSave,
}));

import { ChatMessageItem } from "./ChatMessage";

describe("ChatMessage export actions", () => {
	afterEach(() => {
		cleanupMocks();
	});

	const baseMessage = {
		id: "msg-1",
		role: "assistant" as const,
		content: "Hello! Here is some useful content that can be exported.",
		timestamp: Date.now(),
	};

	it("shows copy button for assistant messages", () => {
		render(<ChatMessageItem message={baseMessage} />);
		expect(screen.getByRole("button", { name: /copy content/i })).toBeInTheDocument();
	});

	it("shows save button for assistant messages", () => {
		render(<ChatMessageItem message={baseMessage} />);
		expect(screen.getByRole("button", { name: /save to file/i })).toBeInTheDocument();
	});

	it("shows 'Copied!' after clicking copy button", async () => {
		// Provide a clipboard that resolves so setCopied(true) fires
		vi.stubGlobal(
			"navigator",
			Object.assign({}, navigator, {
				clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
			}),
		);

		const user = userEvent.setup();
		render(<ChatMessageItem message={baseMessage} />);
		await user.click(screen.getByRole("button", { name: /copy content/i }));

		expect(await screen.findByText("Copied!")).toBeInTheDocument();
	});

	it("does not show action buttons for user messages", () => {
		render(
			<ChatMessageItem
				message={{
					id: "msg-2",
					role: "user",
					content: "Hello",
					timestamp: Date.now(),
				}}
			/>,
		);
		expect(screen.queryByRole("button", { name: /copy content/i })).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /save to file/i })).not.toBeInTheDocument();
	});

	it("does not show action buttons for streaming messages", () => {
		render(
			<ChatMessageItem
				message={{
					...baseMessage,
					isStreaming: true,
				}}
			/>,
		);
		expect(screen.queryByRole("button", { name: /copy content/i })).not.toBeInTheDocument();
	});

	it("shows open folder button for messages with artifact file paths", () => {
		render(
			<ChatMessageItem
				message={{
					...baseMessage,
					content: "Written to /home/user/output.html (5 lines)",
				}}
			/>,
		);
		expect(screen.getByRole("button", { name: /open folder/i })).toBeInTheDocument();
	});

	it("opens save dialog on save button click", async () => {
		mockSave.mockResolvedValue("/home/user/exported-file.md");
		const user = userEvent.setup();
		render(<ChatMessageItem message={baseMessage} />);

		await user.click(screen.getByRole("button", { name: /save to file/i }));

		expect(mockSave).toHaveBeenCalledWith(
			expect.objectContaining({
				defaultPath: expect.stringContaining(".md"),
			}),
		);
	});

	it("does not show open folder when no file path in content", () => {
		render(<ChatMessageItem message={baseMessage} />);
		expect(screen.queryByRole("button", { name: /open folder/i })).not.toBeInTheDocument();
	});
});
