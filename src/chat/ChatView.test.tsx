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

describe("ChatView queued bubbles (#201 PR3 follow-up)", () => {
	afterEach(() => cleanupMocks());

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

	it("renders queued steer and follow-up items as inline bubbles in the chat area", () => {
		render(
			<ChatView
				{...defaultProps}
				isRunning={true}
				status="responding"
				messages={[
					{ id: "u1", role: "user", content: "Tell me a big story", timestamp: 1 },
				]}
				streamingMessage={{
					id: "a1",
					role: "assistant",
					content: "Once upon a time",
					timestamp: 2,
				}}
				queue={{ steering: ["Tell me another story"], followUp: ["I don't like this"] }}
			/>,
		);
		expect(screen.getByText("Tell me another story")).toBeInTheDocument();
		expect(screen.getByText("I don't like this")).toBeInTheDocument();
	});

	it("renders queued bubbles AFTER the streaming AI message in DOM order", () => {
		// Why: chronologically the queued messages will be delivered AFTER the
		// AI finishes current work, so they belong below the streaming bubble.
		const { container } = render(
			<ChatView
				{...defaultProps}
				isRunning={true}
				status="responding"
				messages={[
					{ id: "u1", role: "user", content: "original prompt", timestamp: 1 },
				]}
				streamingMessage={{
					id: "a1",
					role: "assistant",
					content: "in-progress AI answer",
					timestamp: 2,
				}}
				queue={{ steering: ["queued steer text"], followUp: [] }}
			/>,
		);
		const text = container.textContent ?? "";
		const aiIdx = text.indexOf("in-progress AI answer");
		const queuedIdx = text.indexOf("queued steer text");
		expect(aiIdx).toBeGreaterThanOrEqual(0);
		expect(queuedIdx).toBeGreaterThanOrEqual(0);
		expect(queuedIdx).toBeGreaterThan(aiIdx);
	});

	it("labels queued items with pi-style 'Steering:' / 'Follow-up:' inline prefix (no chunky badge)", () => {
		render(
			<ChatView
				{...defaultProps}
				isRunning={true}
				status="responding"
				streamingMessage={{
					id: "a1",
					role: "assistant",
					content: "streaming",
					timestamp: 2,
				}}
				queue={{ steering: ["do A"], followUp: ["do B"] }}
			/>,
		);
		// Pi-style inline prefix (with or without trailing colon, no chunky badge).
		expect(screen.getByText(/Steering\b/i)).toBeInTheDocument();
		expect(screen.getByText(/Follow-up\b/i)).toBeInTheDocument();
		// The old chunky badge text "queued · steer" is gone.
		expect(screen.queryByText(/queued · steer/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/queued · follow-up/i)).not.toBeInTheDocument();
	});

	it("shows a single 'Ctrl+↑ to edit all queued messages' hint when queue is non-empty", () => {
		render(
			<ChatView
				{...defaultProps}
				isRunning={true}
				status="responding"
				streamingMessage={{
					id: "a1",
					role: "assistant",
					content: "streaming",
					timestamp: 2,
				}}
				queue={{ steering: ["x"], followUp: ["y"] }}
			/>,
		);
		const hints = screen.getAllByText(/Ctrl\+↑ to edit all queued messages/i);
		expect(hints.length).toBe(1);
	});

	it("renders queued items as a visually threaded group (connecting line) under the streaming bubble", () => {
		// Why: a flat list of `Steering:` / `Follow-up:` rows reads as
		// disconnected messages. Pi-style is a vertical thread line tying
		// queued items to the in-progress bubble above. We assert the thread
		// container exists — visual styling lives in tailwind classes on
		// the data-testid="queued-thread" element.
		const { container } = render(
			<ChatView
				{...defaultProps}
				isRunning={true}
				status="responding"
				streamingMessage={{
					id: "a1",
					role: "assistant",
					content: "streaming",
					timestamp: 2,
				}}
				queue={{ steering: ["do A"], followUp: ["do B"] }}
			/>,
		);
		const thread = container.querySelector('[data-testid="queued-thread"]');
		expect(thread).not.toBeNull();
		// Thread visual cue: a left border class. Permits any tailwind
		// border-l-* / pl-* combo so styling can evolve.
		expect(thread?.className).toMatch(/border-l/);
	});

	it("does not render queued section when queue is empty", () => {
		render(
			<ChatView
				{...defaultProps}
				isRunning={true}
				status="responding"
				streamingMessage={{
					id: "a1",
					role: "assistant",
					content: "hi",
					timestamp: 2,
				}}
				queue={{ steering: [], followUp: [] }}
			/>,
		);
		expect(screen.queryByText(/Steering\b/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/Follow-up\b/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/Ctrl\+↑ to edit/i)).not.toBeInTheDocument();
	});
});
