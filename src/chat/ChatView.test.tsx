import { cleanupMocks } from "@/test/mocks";
import { render, screen, waitForElementToBeRemoved } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ThinkingState } from "@/lib/sessionStats";
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

	const thinking: ThinkingState = {
		level: "high",
		available: ["off", "minimal", "low", "medium", "high", "xhigh"],
		supported: true,
	};

	it("empty state: centered greeting + input, no statusbar, no suggested actions", () => {
		render(<ChatView {...defaultProps} thinking={thinking} />);
		// Greeting renders immediately above the input: time-of-day prefix + tail.
		expect(screen.getByTestId("greeting")).toBeInTheDocument();
		expect(screen.getByTestId("greeting").textContent).toContain("What are you working on?");
		// Ultra-clean empty screen: no statusbar (decision C).
		expect(
			screen.queryByRole("button", { name: /reasoning effort/i }),
		).not.toBeInTheDocument();
		// SuggestedActions block is gone for good.
		expect(screen.queryByText("Write a document")).not.toBeInTheDocument();
	});

	it("active state: statusbar renders at top, greeting is gone", () => {
		render(
			<ChatView
				{...defaultProps}
				thinking={thinking}
				messages={[{ id: "1", role: "user", content: "Hello", timestamp: Date.now() }]}
			/>,
		);
		expect(
			screen.getByRole("button", { name: /reasoning effort/i }),
		).toBeInTheDocument();
		expect(screen.queryByTestId("greeting")).not.toBeInTheDocument();
	});

	it("streaming counts as active: no greeting", () => {
		render(
			<ChatView
				{...defaultProps}
				thinking={thinking}
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
		expect(screen.queryByTestId("greeting")).not.toBeInTheDocument();
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

describe("ChatView in-thread find (#267)", () => {
	afterEach(() => cleanupMocks());

	const findProps = {
		streamingMessage: null,
		isRunning: false,
		status: "idle" as const,
		error: null,
		onSend: vi.fn(),
		onAbort: vi.fn(),
		toolPhase: null,
		messages: [
			{ id: "m1", role: "user" as const, content: "How do I configure vite?", timestamp: 1 },
			{
				id: "m2",
				role: "assistant" as const,
				content: "Use the vite config to add plugins. vite is fast.",
				timestamp: 2,
			},
		],
	};

	it("opens the find bar with Cmd/Ctrl+F and highlights matches", async () => {
		const user = userEvent.setup();
		const { container } = render(<ChatView {...findProps} />);
		// Find bar is hidden until the shortcut.
		expect(screen.queryByPlaceholderText("Find in conversation…")).not.toBeInTheDocument();

		await user.keyboard("{Control>}f{/Control}");
		const input = await screen.findByPlaceholderText("Find in conversation…");
		await user.type(input, "vite");

		// "vite" occurs 3× across the two messages → 3 highlighted marks.
		const marks = container.querySelectorAll("mark.find-highlight");
		expect(marks.length).toBe(3);
		// Counter shows 1/3 and exactly one active mark.
		expect(screen.getByText("1/3")).toBeInTheDocument();
		expect(container.querySelectorAll('[data-find-active="true"]').length).toBe(1);
	});

	it("navigates matches with next/prev", async () => {
		const user = userEvent.setup();
		render(<ChatView {...findProps} />);
		await user.keyboard("{Control>}f{/Control}");
		const input = await screen.findByPlaceholderText("Find in conversation…");
		await user.type(input, "vite");

		expect(screen.getByText("1/3")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Next match" }));
		expect(screen.getByText("2/3")).toBeInTheDocument();
		// Wrap-around: prev from 1 → 3.
		await user.click(screen.getByRole("button", { name: "Previous match" }));
		await user.click(screen.getByRole("button", { name: "Previous match" }));
		expect(screen.getByText("3/3")).toBeInTheDocument();
	});

	it("shows 0/0 when nothing matches", async () => {
		const user = userEvent.setup();
		render(<ChatView {...findProps} />);
		await user.keyboard("{Control>}f{/Control}");
		const input = await screen.findByPlaceholderText("Find in conversation…");
		await user.type(input, "zzz_nomatch");
		expect(screen.getByText("0/0")).toBeInTheDocument();
	});

	it("closes the find bar via the close button", async () => {
		const user = userEvent.setup();
		render(<ChatView {...findProps} />);
		await user.keyboard("{Control>}f{/Control}");
		const input = await screen.findByPlaceholderText("Find in conversation…");
		await user.click(screen.getByRole("button", { name: "Close find" }));
		// AnimatePresence plays an exit animation before unmounting.
		await waitForElementToBeRemoved(input);
		expect(screen.queryByPlaceholderText("Find in conversation…")).not.toBeInTheDocument();
	});
});
