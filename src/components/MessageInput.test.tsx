import { cleanupMocks, mockInvoke } from "@/test/mocks";
import type { ModelInfo } from "@/types";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
		const textarea = screen.getByRole("textbox");
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

		const textarea = screen.getByRole("textbox");
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

describe("MessageInput draft (prompt templates)", () => {
	afterEach(() => {
		cleanupMocks();
	});

	it("fills the textarea with the draft text without sending", () => {
		const onSend = vi.fn();
		render(<MessageInput onSend={onSend} draft={{ text: "Draft prompt", nonce: 1 }} />);

		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
		expect(textarea.value).toBe("Draft prompt");
		// Loading a template must NOT auto-send.
		expect(onSend).not.toHaveBeenCalled();
	});

	it("replaces the draft when the nonce changes", () => {
		const { rerender } = render(
			<MessageInput onSend={vi.fn()} draft={{ text: "First", nonce: 1 }} />,
		);
		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
		expect(textarea.value).toBe("First");

		rerender(<MessageInput onSend={vi.fn()} draft={{ text: "Second", nonce: 2 }} />);
		expect(textarea.value).toBe("Second");
	});

	it("sends the draft text once the user submits", async () => {
		const onSend = vi.fn();
		const user = userEvent.setup();
		render(<MessageInput onSend={onSend} draft={{ text: "Editable prompt", nonce: 1 }} />);

		await user.click(screen.getByRole("button", { name: /send/i }));

		expect(onSend).toHaveBeenCalledTimes(1);
		expect(onSend.mock.calls[0][0]).toBe("Editable prompt");
	});
});

describe("MessageInput image warning", () => {
	const textOnlyModels: ModelInfo[] = [
		{
			id: "llama3.1:8b",
			name: "Llama 3.1 8B",
			provider: "custom-local-llm",
			reasoning: false,
			contextWindow: 8192,
			maxTokens: 2048,
			input: ["text"],
		},
	];
	const visionModels: ModelInfo[] = [
		{
			id: "gpt-4o",
			name: "GPT-4o",
			provider: "openai",
			reasoning: false,
			contextWindow: 128000,
			maxTokens: 4096,
			input: ["text", "image"],
		},
	];

	beforeEach(() => {
		mockOpen.mockResolvedValue(["/home/test/photo.png"]);
		mockInvoke(
			async (cmd: string, args?: Record<string, unknown>) => {
				if (cmd === "get_file_info") {
					const path = args?.path as string;
					const mimeType = path.endsWith(".png") ? "image/png" : "application/octet-stream";
					const name = path.split("/").pop() ?? path;
					return { name, size: 1024, mime_type: mimeType };
				}
				throw new Error(`unexpected invoke: ${cmd}`);
			},
		);
	});

	afterEach(() => {
		cleanupMocks();
	});

	it("shows warning when image file is attached with text-only model", async () => {
		const user = userEvent.setup();
		render(
			<MessageInput
				onSend={vi.fn()}
				models={textOnlyModels}
				currentModelId="custom-local-llm/llama3.1:8b"
			/>,
		);

		await user.click(screen.getByLabelText("Attach files"));
		await screen.findByText(/does not support images/i);
	});

	it("does not show warning when image file is attached with vision model", async () => {
		const user = userEvent.setup();
		render(
			<MessageInput
				onSend={vi.fn()}
				models={visionModels}
				currentModelId="openai/gpt-4o"
			/>,
		);

		await user.click(screen.getByLabelText("Attach files"));
		expect(screen.queryByText(/does not support images/i)).not.toBeInTheDocument();
	});

	it("does not show warning when no models prop is passed (assumes image support)", async () => {
		const user = userEvent.setup();
		render(<MessageInput onSend={vi.fn()} />);

		await user.click(screen.getByLabelText("Attach files"));
		expect(screen.queryByText(/does not support images/i)).not.toBeInTheDocument();
	});
});
