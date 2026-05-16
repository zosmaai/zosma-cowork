import { cleanupMocks } from "@/test/mocks";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock @tauri-apps/plugin-dialog
const mockOpen = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-dialog", () => ({
	open: mockOpen,
}));

import { MessageInput } from "./MessageInput";

describe("MessageInput file picker", () => {
	afterEach(() => {
		cleanupMocks();
	});

	it("renders file attach button", () => {
		render(<MessageInput onSend={vi.fn()} />);
		expect(screen.getByLabelText("Attach files")).toBeInTheDocument();
	});

	it("opens file dialog on attach button click", async () => {
		mockOpen.mockResolvedValue(["/home/test/doc.md"]);
		const user = userEvent.setup();
		render(<MessageInput onSend={vi.fn()} />);

		await user.click(screen.getByLabelText("Attach files"));

		expect(mockOpen).toHaveBeenCalled();
	});

	it("shows file chip after selection", async () => {
		mockOpen.mockResolvedValue(["/home/test/doc.md"]);
		const user = userEvent.setup();
		render(<MessageInput onSend={vi.fn()} />);

		await user.click(screen.getByLabelText("Attach files"));

		expect(screen.getByText("doc.md")).toBeInTheDocument();
	});

	it("shows multiple file chips", async () => {
		mockOpen.mockResolvedValue(["/home/test/a.ts", "/home/test/b.ts", "/home/test/c.ts"]);
		const user = userEvent.setup();
		render(<MessageInput onSend={vi.fn()} />);

		await user.click(screen.getByLabelText("Attach files"));

		expect(screen.getByText("a.ts")).toBeInTheDocument();
		expect(screen.getByText("b.ts")).toBeInTheDocument();
		expect(screen.getByText("c.ts")).toBeInTheDocument();
	});

	it("removes file chip on remove button click", async () => {
		mockOpen.mockResolvedValue(["/home/test/doc.md", "/home/test/other.md"]);
		const user = userEvent.setup();
		render(<MessageInput onSend={vi.fn()} />);

		await user.click(screen.getByLabelText("Attach files"));
		expect(screen.getByText("doc.md")).toBeInTheDocument();

		// Click remove on first chip
		const removeButtons = screen.getAllByRole("button", { name: /remove/i });
		await user.click(removeButtons[0]);

		expect(screen.queryByText("doc.md")).not.toBeInTheDocument();
		expect(screen.getByText("other.md")).toBeInTheDocument();
	});

	it("sends file content prepended to message", async () => {
		mockOpen.mockResolvedValue(["/home/test/doc.md"]);
		const onSend = vi.fn();
		const user = userEvent.setup();

		render(<MessageInput onSend={onSend} />);

		// Attach file
		await user.click(screen.getByLabelText("Attach files"));

		// Type message
		const textarea = screen.getByPlaceholderText(/Message Zosma Cowork/);
		await user.type(textarea, "Summarize this");

		// Send
		await user.click(screen.getByRole("button", { name: /send/i }));

		// onSend should include file reference in the prompt
		expect(onSend).toHaveBeenCalledTimes(1);
		const sentText = onSend.mock.calls[0][0];
		expect(sentText).toContain("doc.md");
		expect(sentText).toContain("Summarize this");
	});

	it("clears file chips after sending", async () => {
		mockOpen.mockResolvedValue(["/home/test/doc.md"]);
		const onSend = vi.fn();
		const user = userEvent.setup();

		render(<MessageInput onSend={onSend} />);

		await user.click(screen.getByLabelText("Attach files"));
		expect(screen.getByText("doc.md")).toBeInTheDocument();

		const textarea = screen.getByPlaceholderText(/Message Zosma Cowork/);
		await user.type(textarea, "hi");
		await user.click(screen.getByRole("button", { name: /send/i }));

		// File chips should be gone after sending
		expect(screen.queryByText("doc.md")).not.toBeInTheDocument();
	});

	it("truncates long file names in chips", async () => {
		const longName = `${"a".repeat(60)}.ts`;
		mockOpen.mockResolvedValue([`/home/test/${longName}`]);
		const user = userEvent.setup();
		render(<MessageInput onSend={vi.fn()} />);

		await user.click(screen.getByLabelText("Attach files"));

		// Should show truncated name
		expect(screen.getByText((content) => content.includes("…"))).toBeInTheDocument();
	});
});
