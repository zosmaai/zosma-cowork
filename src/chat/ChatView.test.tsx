import { cleanupMocks } from "@/test/mocks";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatView } from "./ChatView";

describe("ChatView empty state", () => {
	afterEach(() => {
		cleanupMocks();
	});

	const defaultProps = {
		messages: [],
		streamingMessage: null,
		isRunning: false,
		status: "idle" as const,
		error: null,
		onSend: vi.fn(),
		onAbort: vi.fn(),
		toolPhase: null,
	};

	it("shows suggested actions when no messages exist", () => {
		render(<ChatView {...defaultProps} />);
		expect(screen.getByText("What are you working on?")).toBeInTheDocument();
		expect(screen.getByText("Write a document")).toBeInTheDocument();
		expect(screen.getByText("Write code")).toBeInTheDocument();
	});

	it("does not show suggested actions when messages exist", () => {
		render(
			<ChatView
				{...defaultProps}
				messages={[{ id: "1", role: "user", content: "Hello", timestamp: Date.now() }]}
			/>,
		);
		expect(screen.queryByText("Write a document")).not.toBeInTheDocument();
	});

	it("calls onSend with prompt when a suggested action is clicked", async () => {
		const onSend = vi.fn();
		const user = userEvent.setup();
		render(<ChatView {...defaultProps} onSend={onSend} />);

		await user.click(screen.getByText("Write a document"));
		expect(onSend).toHaveBeenCalledTimes(1);
		expect(onSend).toHaveBeenCalledWith(expect.stringMatching(/document/i));
	});

	it("does not show suggested actions when streaming is active", () => {
		render(
			<ChatView
				{...defaultProps}
				isRunning={true}
				status="thinking"
				streamingMessage={{
					id: "stream-1",
					role: "assistant",
					content: "",
					timestamp: Date.now(),
				}}
			/>,
		);
		expect(screen.queryByText("Write a document")).not.toBeInTheDocument();
	});
});
