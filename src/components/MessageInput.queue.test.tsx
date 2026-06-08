import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MessageInput } from "./MessageInput";

/**
 * Queue-aware composer affordances — issue #201, PR 3 of 3.
 *
 * When the SDK has steer/follow-up messages pending, the composer must
 * surface that state and let the user EDIT the queue **without adding a
 * second input field**. The mechanism reuses this very textarea:
 *
 *  - Idle, queue empty → existing behavior (Enter sends).
 *  - Streaming, queue empty → existing behavior (Enter steers).
 *  - **Queue non-empty (streaming or idle)** → composer surfaces a
 *    summary line "N queued — Ctrl+↑ to edit". Pressing Ctrl+ArrowUp
 *    fires `onEditQueue()`; the parent drains the SDK queue and loads
 *    the messages into this composer via the existing `draft` prop —
 *    no new UI surface.
 *
 * The composer does NOT itself decide whether to call clear_queue or
 * how to join messages. Its only contract is "tell me when the user
 * wants to edit". This keeps composer pure + makes testing simple.
 */
describe("MessageInput — queue affordances (#201 PR 3)", () => {
	const baseProps = {
		onSend: vi.fn(),
		onSteer: vi.fn(),
		onFollowUp: vi.fn(),
		onEditQueue: vi.fn(),
	};

	// PR3 follow-up: when streaming, the queue affordance is folded into
	// the textarea PLACEHOLDER (no separate visible row — that looked like a
	// second input above the main input). When idle, the queue chip is
	// visible because a follow-up can outlive the originating turn.
	it("streaming: queue affordance lives in the textarea placeholder (count + Ctrl+↑)", () => {
		render(
			<MessageInput
				{...baseProps}
				streaming
				queue={{ steering: ["stop, do A", "actually B"], followUp: [] }}
			/>,
		);
		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
		expect(textarea.placeholder).toMatch(/2 queued/i);
		expect(textarea.placeholder).toMatch(/Ctrl\+↑/i);
		// No separate row.
		expect(screen.queryByTestId("composer-queue-summary")).not.toBeInTheDocument();
	});

	it("streaming: total count appears in placeholder for follow-up only queue", () => {
		render(
			<MessageInput
				{...baseProps}
				streaming
				queue={{ steering: [], followUp: ["finally C"] }}
			/>,
		);
		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
		expect(textarea.placeholder).toMatch(/1 queued/i);
	});

	it("streaming: placeholder combines steer + follow-up counts into one total", () => {
		render(
			<MessageInput
				{...baseProps}
				streaming
				queue={{ steering: ["a", "b"], followUp: ["c"] }}
			/>,
		);
		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
		expect(textarea.placeholder).toMatch(/3 queued/i);
	});

	it("idle: queue chip is visible because a follow-up can outlive STREAM_COMPLETE", () => {
		render(
			<MessageInput
				{...baseProps}
				queue={{ steering: [], followUp: ["finally C"] }}
			/>,
		);
		const summary = screen.getByTestId("composer-queue-summary");
		expect(summary.textContent).toMatch(/1 queued/i);
		expect(summary.textContent).toMatch(/Ctrl\+↑/i);
	});

	it("hides the queue summary when both queues are empty (idle and streaming)", () => {
		const { rerender } = render(
			<MessageInput
				{...baseProps}
				streaming
				queue={{ steering: [], followUp: [] }}
			/>,
		);
		expect(screen.queryByText(/queued/i)).not.toBeInTheDocument();
		rerender(
			<MessageInput
				{...baseProps}
				queue={{ steering: [], followUp: [] }}
			/>,
		);
		expect(screen.queryByText(/queued/i)).not.toBeInTheDocument();
	});

	it("Ctrl+ArrowUp calls onEditQueue when queue is non-empty", async () => {
		const user = userEvent.setup();
		const onEditQueue = vi.fn();
		render(
			<MessageInput
				{...baseProps}
				onEditQueue={onEditQueue}
				streaming
				queue={{ steering: ["stop"], followUp: [] }}
			/>,
		);
		const textarea = screen.getByRole("textbox");
		await user.click(textarea);
		await user.keyboard("{Control>}{ArrowUp}{/Control}");
		expect(onEditQueue).toHaveBeenCalledTimes(1);
	});

	it("Ctrl+ArrowUp is a no-op when queue is empty (don't poke the SDK for nothing)", async () => {
		const user = userEvent.setup();
		const onEditQueue = vi.fn();
		render(
			<MessageInput
				{...baseProps}
				onEditQueue={onEditQueue}
				streaming
				queue={{ steering: [], followUp: [] }}
			/>,
		);
		const textarea = screen.getByRole("textbox");
		await user.click(textarea);
		await user.keyboard("{Control>}{ArrowUp}{/Control}");
		expect(onEditQueue).not.toHaveBeenCalled();
	});

	it("Ctrl+ArrowUp is a no-op when onEditQueue handler is missing (graceful)", async () => {
		const user = userEvent.setup();
		render(
			<MessageInput
				onSend={vi.fn()}
				streaming
				queue={{ steering: ["x"], followUp: [] }}
			/>,
		);
		const textarea = screen.getByRole("textbox");
		await user.click(textarea);
		// Should not throw.
		await user.keyboard("{Control>}{ArrowUp}{/Control}");
	});

	it("plain ArrowUp (no Ctrl) does NOT fire onEditQueue — textarea caret-navigation must keep working", async () => {
		const user = userEvent.setup();
		const onEditQueue = vi.fn();
		render(
			<MessageInput
				{...baseProps}
				onEditQueue={onEditQueue}
				streaming
				queue={{ steering: ["x"], followUp: [] }}
			/>,
		);
		const textarea = screen.getByRole("textbox");
		await user.click(textarea);
		await user.type(textarea, "line1{Enter}line2");
		await user.keyboard("{ArrowUp}");
		expect(onEditQueue).not.toHaveBeenCalled();
	});

	it("Ctrl+ArrowUp also works in idle (non-streaming) state — follow-ups can survive past STREAM_COMPLETE", async () => {
		// After STREAM_COMPLETE, `streaming` flips false but a pending
		// follow-up may still be in the SDK queue waiting to dequeue.
		// The user must be able to recall it for editing.
		const user = userEvent.setup();
		const onEditQueue = vi.fn();
		render(
			<MessageInput
				{...baseProps}
				onEditQueue={onEditQueue}
				streaming={false}
				queue={{ steering: [], followUp: ["finally C"] }}
			/>,
		);
		const textarea = screen.getByRole("textbox");
		await user.click(textarea);
		await user.keyboard("{Control>}{ArrowUp}{/Control}");
		expect(onEditQueue).toHaveBeenCalledTimes(1);
	});

	it("queue summary is hidden during hard-disabled state (no model / sidecar not ready)", () => {
		// `disabled` means a hard block. Showing "N queued — Ctrl+↑ to
		// edit" while the user can't act on it is just confusing.
		render(
			<MessageInput
				{...baseProps}
				disabled
				queue={{ steering: ["x"], followUp: [] }}
			/>,
		);
		expect(screen.queryByText(/queued/i)).not.toBeInTheDocument();
	});
});
