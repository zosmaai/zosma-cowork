import { cleanupMocks } from "@/test/mocks";
import { fireEvent, render, screen, waitForElementToBeRemoved } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatView } from "./ChatView";

function selectRenderedText(element: Element) {
	// biome-ignore lint/style/noNonNullAssertion: test helper
	const node = element.firstChild!;
	const range = document.createRange();
	range.selectNodeContents(node);
	Object.defineProperty(range, "getBoundingClientRect", {
		value: () => ({ left: 80, top: 120, right: 180, bottom: 140, width: 100, height: 20 }),
	});
	// biome-ignore lint/style/noNonNullAssertion: test helper
	const selection = window.getSelection()!;
	selection.removeAllRanges();
	selection.addRange(range);
	// Trigger the selectionchange event so the hook picks it up
	document.dispatchEvent(new Event("selectionchange"));
}

describe("ChatView selection boundaries", () => {
	afterEach(() => cleanupMocks());

	it("marks only assistant Markdown as a selection-action response root", () => {
		const { container } = render(
			<ChatView
				sessionFile="/chat.jsonl"
				messages={[
					{ id: "u", role: "user", content: "User direction", timestamp: 1 },
					{ id: "a", role: "assistant", content: "Assistant answer", timestamp: 2 },
				]}
				streamingMessage={null}
				isRunning={false}
				error={null}
				onSend={vi.fn()}
				onAbort={vi.fn()}
				mode="chat"
			/>,
		);
		expect(container.querySelectorAll("[data-assistant-response]")).toHaveLength(1);
		expect(container.querySelector("[data-assistant-response='a']")).toHaveTextContent(
			"Assistant answer",
		);
		expect(screen.getByText("User direction").closest("[data-assistant-response]")).toBeNull();
	});

	it.each(["chat", "work"] as const)(
		"shows one selection toolbar for assistant Markdown in %s",
		async (mode) => {
			const { container } = render(
				<ChatView
					sessionFile={`/${mode}.jsonl`}
					messages={[{ id: "a", role: "assistant", content: "Selectable answer", timestamp: 1 }]}
					streamingMessage={null}
					isRunning={false}
					error={null}
					onSend={vi.fn()}
					onAbort={vi.fn()}
					mode={mode}
				/>,
			);
			// biome-ignore lint/style/noNonNullAssertion: test helper
			selectRenderedText(container.querySelector("[data-assistant-response='a']")!);
			await new Promise((r) => setTimeout(r, 0));
			expect(screen.getByRole("toolbar", { name: "Selection actions" })).toBeInTheDocument();
		},
	);

	it("does not show selection actions for user text", async () => {
		const { container } = render(
			<ChatView
				sessionFile="/chat.jsonl"
				messages={[{ id: "u", role: "user", content: "User direction", timestamp: 1 }]}
				streamingMessage={null}
				isRunning={false}
				error={null}
				onSend={vi.fn()}
				onAbort={vi.fn()}
				mode="chat"
			/>,
		);
		// biome-ignore lint/style/noNonNullAssertion: test helper
		selectRenderedText(container.querySelector("[data-message-id='u'] .chat-markdown")!);
		await new Promise((r) => setTimeout(r, 0));
		expect(screen.queryByRole("toolbar", { name: "Selection actions" })).not.toBeInTheDocument();
	});

	it.each(["chat", "work"] as const)(
		"Ask AI creates one removable quote and focuses the composer in %s",
		async (mode) => {
			const user = userEvent.setup();
			const { container } = render(
				<ChatView
					sessionFile={`/${mode}.jsonl`}
					sessionKey={`/${mode}.jsonl`}
					messages={[{ id: "a", role: "assistant", content: "Selected answer", timestamp: 1 }]}
					streamingMessage={null}
					isRunning={false}
					error={null}
					onSend={vi.fn()}
					onAbort={vi.fn()}
					mode={mode}
				/>,
			);
			// biome-ignore lint/style/noNonNullAssertion: rendered fixture must expose its assistant response
			selectRenderedText(container.querySelector("[data-assistant-response='a']")!);
			await new Promise((r) => setTimeout(r, 0));
			await user.click(screen.getByRole("button", { name: "Ask AI" }));
			expect(screen.queryByRole("toolbar", { name: "Selection actions" })).not.toBeInTheDocument();
			expect(screen.getByRole("region", { name: "Quoted context" })).toHaveTextContent(
				"Selected answer",
			);
			// Focus happens via requestAnimationFrame; wait for it
			await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
			expect(screen.getByRole("textbox")).toHaveFocus();
			expect(screen.getByRole("textbox")).toHaveValue("");
		},
	);

	it("never renders quoted context in a different session", async () => {
		const user = userEvent.setup();
		const props = {
			messages: [{ id: "a", role: "assistant" as const, content: "Selected answer", timestamp: 1 }],
			streamingMessage: null,
			isRunning: false,
			error: null,
			onSend: vi.fn(),
			onAbort: vi.fn(),
		};
		const view = render(<ChatView {...props} sessionFile="/a.jsonl" sessionKey="/a.jsonl" />);
		// biome-ignore lint/style/noNonNullAssertion: rendered fixture must expose its assistant response
		selectRenderedText(view.container.querySelector("[data-assistant-response='a']")!);
		await new Promise((r) => setTimeout(r, 0));
		await user.click(screen.getByRole("button", { name: "Ask AI" }));
		expect(screen.getByRole("region", { name: "Quoted context" })).toBeInTheDocument();
		view.rerender(<ChatView {...props} sessionFile="/b.jsonl" sessionKey="/b.jsonl" />);
		expect(screen.queryByRole("region", { name: "Quoted context" })).not.toBeInTheDocument();
	});

	it("Start writing immediately sends a quoted normal turn while idle", async () => {
		const user = userEvent.setup();
		const onSend = vi.fn();
		const onFollowUp = vi.fn();
		const { container } = render(
			<ChatView
				sessionFile="/a.jsonl"
				messages={[{ id: "a", role: "assistant", content: "Selected answer", timestamp: 1 }]}
				streamingMessage={null}
				isRunning={false}
				error={null}
				onSend={onSend}
				onAbort={vi.fn()}
				onFollowUp={onFollowUp}
			/>,
		);
		// biome-ignore lint/style/noNonNullAssertion: rendered fixture must expose its assistant response
		selectRenderedText(container.querySelector("[data-assistant-response='a']")!);
		await new Promise((r) => setTimeout(r, 0));
		await user.click(screen.getByRole("button", { name: "Start writing" }));
		expect(onSend).toHaveBeenCalledWith("> Selected answer\n\nStart writing from this excerpt.");
		expect(onFollowUp).not.toHaveBeenCalled();
	});

	it("Start writing queues a quoted follow-up while the selected session is running", async () => {
		const user = userEvent.setup();
		const onSend = vi.fn();
		const onFollowUp = vi.fn();
		const { container } = render(
			<ChatView
				sessionFile="/a.jsonl"
				messages={[{ id: "a", role: "assistant", content: "Selected answer", timestamp: 1 }]}
				streamingMessage={null}
				isRunning
				error={null}
				onSend={onSend}
				onAbort={vi.fn()}
				onFollowUp={onFollowUp}
			/>,
		);
		// biome-ignore lint/style/noNonNullAssertion: rendered fixture must expose its assistant response
		selectRenderedText(container.querySelector("[data-assistant-response='a']")!);
		await new Promise((r) => setTimeout(r, 0));
		await user.click(screen.getByRole("button", { name: "Start writing" }));
		expect(onFollowUp).toHaveBeenCalledWith(
			"> Selected answer\n\nStart writing from this excerpt.",
		);
		expect(onSend).not.toHaveBeenCalled();
	});

	it("Start writing does nothing when the required running follow-up handler is absent", async () => {
		const user = userEvent.setup();
		const onSend = vi.fn();
		const { container } = render(
			<ChatView
				sessionFile="/a.jsonl"
				messages={[{ id: "a", role: "assistant", content: "Selected answer", timestamp: 1 }]}
				streamingMessage={null}
				isRunning
				error={null}
				onSend={onSend}
				onAbort={vi.fn()}
			/>,
		);
		// biome-ignore lint/style/noNonNullAssertion: rendered fixture must expose its assistant response
		selectRenderedText(container.querySelector("[data-assistant-response='a']")!);
		await new Promise((r) => setTimeout(r, 0));
		await user.click(screen.getByRole("button", { name: "Start writing" }));
		expect(onSend).not.toHaveBeenCalled();
		expect(screen.getByRole("toolbar", { name: "Selection actions" })).toBeInTheDocument();
	});
});

describe("ChatView queued bubbles (#201 PR3 follow-up)", () => {
	afterEach(() => cleanupMocks());

	const defaultProps = {
		messages: [],
		streamingMessage: null,
		isRunning: false,
		error: null,
		onSend: vi.fn(),
		onAbort: vi.fn(),
	};

	it("renders queued steer and follow-up items as inline bubbles in the chat area", () => {
		render(
			<ChatView
				sessionFile="/s.test.jsonl"
				{...defaultProps}
				isRunning={true}
				messages={[{ id: "u1", role: "user", content: "Tell me a big story", timestamp: 1 }]}
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
				sessionFile="/s.test.jsonl"
				{...defaultProps}
				isRunning={true}
				messages={[{ id: "u1", role: "user", content: "original prompt", timestamp: 1 }]}
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
				sessionFile="/s.test.jsonl"
				{...defaultProps}
				isRunning={true}
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
				sessionFile="/s.test.jsonl"
				{...defaultProps}
				isRunning={true}
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
				sessionFile="/s.test.jsonl"
				{...defaultProps}
				isRunning={true}
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
				sessionFile="/s.test.jsonl"
				{...defaultProps}
				isRunning={true}
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
		sessionFile: "/s.test.jsonl",
		streamingMessage: null,
		isRunning: false,
		error: null,
		onSend: vi.fn(),
		onAbort: vi.fn(),
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

describe("ChatView mode-specific empty shell", () => {
	const emptyProps = {
		messages: [],
		streamingMessage: null,
		isRunning: false,
		error: null,
		onSend: vi.fn(),
		onAbort: vi.fn(),
	};

	it("shows only Empty Chat controls before the first prompt", () => {
		render(<ChatView sessionFile="/a.jsonl" {...emptyProps} mode="chat" onModeChange={vi.fn()} />);
		expect(screen.getByText("What’s on your mind today?")).toBeInTheDocument();
		expect(screen.queryByText("What should we work on?")).not.toBeInTheDocument();
		expect(screen.getByPlaceholderText("Ask Zosma…")).toBeInTheDocument();
	});

	it("shows Empty Work with a multiline task composer and workspace", () => {
		render(
			<ChatView
				sessionFile="/a.jsonl"
				{...emptyProps}
				mode="work"
				workspaceCwd="/work/acme"
				onModeChange={vi.fn()}
			/>,
		);
		expect(screen.getByText("What should we work on?")).toBeInTheDocument();
		const input = screen.getByPlaceholderText("Work on anything…");
		expect(input).toHaveAttribute("rows", "3");
		expect(screen.getByText("/work/acme")).toBeInTheDocument();
	});

	it("hides the mode switch and empty starters after conversation starts", () => {
		render(
			<ChatView
				sessionFile="/a.jsonl"
				{...emptyProps}
				mode="work"
				messages={[{ id: "u", role: "user", content: "Run it", timestamp: 1 }]}
				onModeChange={vi.fn()}
			/>,
		);
		expect(screen.queryByRole("tablist", { name: "Session mode" })).not.toBeInTheDocument();
		expect(screen.queryByText("Research and produce a report")).not.toBeInTheDocument();
	});

	it("keeps one composer node from Empty Work into Active Work", () => {
		const props = {
			sessionFile: "/work.jsonl",
			streamingMessage: null,
			isRunning: false,
			error: null,
			onSend: vi.fn(),
			onAbort: vi.fn(),
			mode: "work" as const,
			taskTitle: "Task title",
		};
		const { rerender } = render(<ChatView {...props} messages={[]} />);
		const before = screen.getByRole("textbox") as HTMLTextAreaElement;
		fireEvent.change(before, { target: { value: "draft survives" } });
		rerender(
			<ChatView
				{...props}
				messages={[
					{ id: "u", role: "user", content: "Start", timestamp: 1 },
					{ id: "a", role: "assistant", content: "Result", timestamp: 2 },
				]}
			/>,
		);
		const after = screen.getByRole("textbox") as HTMLTextAreaElement;
		expect(after).toBe(before);
		expect(after.value).toBe("draft survives");
		expect(screen.getByRole("heading", { name: "Task title" })).toBeInTheDocument();
	});

	it("routes active Work drawer controls and backdrop through one owner", () => {
		const onDrawerChange = vi.fn();
		const { container } = render(
			<ChatView
				sessionFile="/work.jsonl"
				messages={[{ id: "a", role: "assistant", content: "Result", timestamp: 1 }]}
				streamingMessage={null}
				isRunning={false}
				error={null}
				onSend={vi.fn()}
				onAbort={vi.fn()}
				mode="work"
				taskTitle="Task"
				drawer="work-panel"
				onDrawerChange={onDrawerChange}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Open Outputs and Sources" }));
		expect(onDrawerChange).toHaveBeenCalledWith("work-panel");
		fireEvent.click(container.querySelector(".work-panel-backdrop") as HTMLButtonElement);
		expect(onDrawerChange).toHaveBeenCalledWith(null);
	});

	it("keeps active Chat on the existing bubble renderer", () => {
		const { container } = render(
			<ChatView
				sessionFile="/chat.jsonl"
				messages={[{ id: "a", role: "assistant", content: "Hello", timestamp: 1 }]}
				streamingMessage={null}
				isRunning={false}
				error={null}
				onSend={vi.fn()}
				onAbort={vi.fn()}
				mode="chat"
				taskTitle="Chat title"
			/>,
		);
		expect(container.querySelector(".chat-bubble")).toBeInTheDocument();
		expect(container.querySelector(".work-result-document")).toBeNull();
	});
});
