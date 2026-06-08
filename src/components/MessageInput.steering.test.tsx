/**
 * Composer steering / follow-up behavior tests (issue #201, PR 2).
 *
 * Contract under test:
 *
 *  - When the agent is IDLE (no `streaming` prop or `streaming === false`):
 *      Enter           → onSend(text)        (existing behavior, unchanged)
 *      Alt+Enter       → onSend(text)        (no-op fallback when no steer handler exists)
 *      Shift+Enter     → newline (no submit)
 *
 *  - When the agent is STREAMING (`streaming === true`):
 *      Enter           → onSteer(text)       (queued mid-turn, pi's default behavior)
 *      Alt+Enter       → onFollowUp(text)    (queued post-turn)
 *      Shift+Enter     → newline (no submit)
 *
 *  - The textarea MUST remain enabled while streaming so users can type/queue.
 *  - The send button MUST also work as steer while streaming (clicking the
 *    arrow with Enter would be ambiguous otherwise).
 *  - Visible hint text MUST tell the user which keys queue which kind of
 *    message — without that affordance the feature is invisible.
 *  - The existing `disabled` prop (which gates by "no model / not ready")
 *    still fully disables the textarea, distinct from `streaming`.
 */

import { cleanupMocks } from "@/test/mocks";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({
	open: vi.fn(),
}));

import { MessageInput } from "./MessageInput";

describe("MessageInput — idle behavior (regression guard)", () => {
	afterEach(() => cleanupMocks());

	it("Enter calls onSend when not streaming", async () => {
		const onSend = vi.fn();
		const onSteer = vi.fn();
		const onFollowUp = vi.fn();
		const user = userEvent.setup();

		render(
			<MessageInput
				onSend={onSend}
				onSteer={onSteer}
				onFollowUp={onFollowUp}
				streaming={false}
			/>,
		);

		const textarea = screen.getByRole("textbox");
		await user.type(textarea, "hello");
		await user.keyboard("{Enter}");

		expect(onSend).toHaveBeenCalledTimes(1);
		expect(onSend).toHaveBeenCalledWith("hello");
		expect(onSteer).not.toHaveBeenCalled();
		expect(onFollowUp).not.toHaveBeenCalled();
	});

	it("Enter still calls onSend when streaming prop is omitted (back-compat)", async () => {
		const onSend = vi.fn();
		const user = userEvent.setup();

		render(<MessageInput onSend={onSend} />);

		const textarea = screen.getByRole("textbox");
		await user.type(textarea, "hi");
		await user.keyboard("{Enter}");

		expect(onSend).toHaveBeenCalledWith("hi");
	});

	it("Shift+Enter inserts a newline and does not submit (idle)", async () => {
		const onSend = vi.fn();
		const user = userEvent.setup();

		render(<MessageInput onSend={onSend} />);

		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
		await user.type(textarea, "line1");
		await user.keyboard("{Shift>}{Enter}{/Shift}");
		await user.type(textarea, "line2");

		expect(onSend).not.toHaveBeenCalled();
		expect(textarea.value).toContain("line1");
		expect(textarea.value).toContain("line2");
		expect(textarea.value).toContain("\n");
	});

	it("does not show the streaming-mode hint when idle", () => {
		render(<MessageInput onSend={vi.fn()} streaming={false} />);
		// Steering / follow-up hint must only appear during streaming.
		expect(screen.queryByText(/steer/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/follow.?up/i)).not.toBeInTheDocument();
	});
});

describe("MessageInput — streaming-mode keyboard behavior (issue #201)", () => {
	afterEach(() => cleanupMocks());

	it("Enter routes to onSteer (NOT onSend) while streaming", async () => {
		const onSend = vi.fn();
		const onSteer = vi.fn();
		const onFollowUp = vi.fn();
		const user = userEvent.setup();

		render(
			<MessageInput
				onSend={onSend}
				onSteer={onSteer}
				onFollowUp={onFollowUp}
				streaming={true}
			/>,
		);

		const textarea = screen.getByRole("textbox");
		await user.type(textarea, "stop and do this");
		await user.keyboard("{Enter}");

		expect(onSteer).toHaveBeenCalledTimes(1);
		expect(onSteer).toHaveBeenCalledWith("stop and do this");
		expect(onSend).not.toHaveBeenCalled();
		expect(onFollowUp).not.toHaveBeenCalled();
	});

	it("Alt+Enter routes to onFollowUp while streaming", async () => {
		const onSend = vi.fn();
		const onSteer = vi.fn();
		const onFollowUp = vi.fn();
		const user = userEvent.setup();

		render(
			<MessageInput
				onSend={onSend}
				onSteer={onSteer}
				onFollowUp={onFollowUp}
				streaming={true}
			/>,
		);

		const textarea = screen.getByRole("textbox");
		await user.type(textarea, "after you finish");
		await user.keyboard("{Alt>}{Enter}{/Alt}");

		expect(onFollowUp).toHaveBeenCalledTimes(1);
		expect(onFollowUp).toHaveBeenCalledWith("after you finish");
		expect(onSend).not.toHaveBeenCalled();
		expect(onSteer).not.toHaveBeenCalled();
	});

	it("Shift+Enter still inserts a newline while streaming", async () => {
		const onSteer = vi.fn();
		const onFollowUp = vi.fn();
		const user = userEvent.setup();

		render(
			<MessageInput
				onSend={vi.fn()}
				onSteer={onSteer}
				onFollowUp={onFollowUp}
				streaming={true}
			/>,
		);

		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
		await user.type(textarea, "a");
		await user.keyboard("{Shift>}{Enter}{/Shift}");
		await user.type(textarea, "b");

		expect(onSteer).not.toHaveBeenCalled();
		expect(onFollowUp).not.toHaveBeenCalled();
		expect(textarea.value).toBe("a\nb");
	});

	it("keeps the textarea ENABLED while streaming (so the user can type)", () => {
		render(
			<MessageInput
				onSend={vi.fn()}
				onSteer={vi.fn()}
				onFollowUp={vi.fn()}
				streaming={true}
			/>,
		);

		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
		expect(textarea).not.toBeDisabled();
	});

	it("clicking the send button while streaming behaves like Enter → steer", async () => {
		const onSend = vi.fn();
		const onSteer = vi.fn();
		const user = userEvent.setup();

		render(
			<MessageInput
				onSend={onSend}
				onSteer={onSteer}
				onFollowUp={vi.fn()}
				streaming={true}
			/>,
		);

		const textarea = screen.getByRole("textbox");
		await user.type(textarea, "queued via click");
		await user.click(screen.getByRole("button", { name: /send/i }));

		expect(onSteer).toHaveBeenCalledWith("queued via click");
		expect(onSend).not.toHaveBeenCalled();
	});

	it("clears the textarea after queueing a steering message", async () => {
		const user = userEvent.setup();
		const onSteer = vi.fn();

		render(
			<MessageInput onSend={vi.fn()} onSteer={onSteer} streaming={true} />,
		);

		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
		await user.type(textarea, "hi");
		await user.keyboard("{Enter}");

		// Same UX as send: the composer empties so the next message starts fresh.
		expect(textarea.value).toBe("");
		expect(onSteer).toHaveBeenCalledWith("hi");
	});

	it("clears the textarea after queueing a follow-up message", async () => {
		const user = userEvent.setup();
		const onFollowUp = vi.fn();

		render(
			<MessageInput onSend={vi.fn()} onFollowUp={onFollowUp} streaming={true} />,
		);

		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
		await user.type(textarea, "and also this");
		await user.keyboard("{Alt>}{Enter}{/Alt}");

		expect(textarea.value).toBe("");
		expect(onFollowUp).toHaveBeenCalledWith("and also this");
	});

	it("does nothing when Enter is pressed with empty text while streaming", async () => {
		const onSteer = vi.fn();
		const onFollowUp = vi.fn();
		const user = userEvent.setup();

		render(
			<MessageInput
				onSend={vi.fn()}
				onSteer={onSteer}
				onFollowUp={onFollowUp}
				streaming={true}
			/>,
		);

		const textarea = screen.getByRole("textbox");
		textarea.focus();
		await user.keyboard("{Enter}");
		await user.keyboard("{Alt>}{Enter}{/Alt}");

		expect(onSteer).not.toHaveBeenCalled();
		expect(onFollowUp).not.toHaveBeenCalled();
	});

	it("falls back gracefully when onSteer is not provided (Enter is a no-op while streaming)", async () => {
		const onSend = vi.fn();
		const user = userEvent.setup();

		render(<MessageInput onSend={onSend} streaming={true} />);

		const textarea = screen.getByRole("textbox");
		await user.type(textarea, "x");
		await user.keyboard("{Enter}");

		// Crucially: must NOT silently fall back to onSend (that would start a
		// new prompt mid-turn, which the sidecar's prompt-scheduler would queue
		// behind the running one — exactly the bug we're fixing).
		expect(onSend).not.toHaveBeenCalled();
	});
});

describe("MessageInput — discoverability hints (issue #201)", () => {
	afterEach(() => cleanupMocks());

	it("advertises steer / follow-up via the textarea placeholder while streaming (single integrated input, no extra hint row)", () => {
		// PR3 follow-up: the stand-alone hint row that lived below the
		// textarea looked like a second input area. We fold the shortcut
		// hints into the placeholder so the composer reads as ONE input.
		render(
			<MessageInput
				onSend={vi.fn()}
				onSteer={vi.fn()}
				onFollowUp={vi.fn()}
				streaming={true}
			/>,
		);

		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
		const placeholder = textarea.placeholder.toLowerCase();
		expect(placeholder).toMatch(/steer/);
		expect(placeholder).toMatch(/follow.?up/);
		// The old hint row must be gone — no visible text node carrying both.
		expect(screen.queryByText(/Enter to steer/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/Alt\+Enter to queue follow-up/i)).not.toBeInTheDocument();
	});

	it("placeholder text reflects the streaming-mode keyboard contract", () => {
		render(
			<MessageInput
				onSend={vi.fn()}
				onSteer={vi.fn()}
				onFollowUp={vi.fn()}
				streaming={true}
			/>,
		);

		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
		// While streaming the placeholder must invite a steer or follow-up,
		// not say "Thinking..." (which implied "you can't type now").
		expect(textarea.placeholder.toLowerCase()).toMatch(/steer|follow.?up/);
		expect(textarea.placeholder.toLowerCase()).not.toMatch(/^thinking\.\.\.$/);
	});
});

describe("MessageInput — disabled vs streaming separation", () => {
	afterEach(() => cleanupMocks());

	it("the disabled prop fully blocks the textarea even when streaming is true", () => {
		// `disabled` (e.g. no model selected, sidecar not ready) is harder
		// than `streaming` — nothing should be sendable at all.
		render(
			<MessageInput
				onSend={vi.fn()}
				onSteer={vi.fn()}
				onFollowUp={vi.fn()}
				streaming={true}
				disabled={true}
			/>,
		);

		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
		expect(textarea).toBeDisabled();
	});

	it("Enter does nothing when disabled even if streaming is true", async () => {
		const onSteer = vi.fn();
		const onSend = vi.fn();
		const user = userEvent.setup();

		render(
			<MessageInput
				onSend={onSend}
				onSteer={onSteer}
				streaming={true}
				disabled={true}
			/>,
		);

		const textarea = screen.getByRole("textbox");
		// userEvent.type on a disabled input is a no-op but try anyway
		await user.type(textarea, "blocked");
		await user.keyboard("{Enter}");

		expect(onSteer).not.toHaveBeenCalled();
		expect(onSend).not.toHaveBeenCalled();
	});
});

describe("MessageInput — auto-focus after send (PR3 follow-up)", () => {
	afterEach(() => cleanupMocks());

	it("keeps focus on the textarea after Enter sends an idle prompt", async () => {
		// Why: when you fire a prompt you almost always want to type the
		// next one immediately (steer / follow-up). Losing focus to body on
		// submit forces a mouse trip to refocus the textarea.
		const user = userEvent.setup();
		render(<MessageInput onSend={vi.fn()} />);
		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
		await user.click(textarea);
		await user.type(textarea, "hi");
		await user.keyboard("{Enter}");
		expect(document.activeElement).toBe(textarea);
	});

	it("keeps focus on the textarea after Enter queues a steer mid-stream", async () => {
		const user = userEvent.setup();
		render(
			<MessageInput
				onSend={vi.fn()}
				onSteer={vi.fn()}
				onFollowUp={vi.fn()}
				streaming={true}
			/>,
		);
		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
		await user.click(textarea);
		await user.type(textarea, "pivot");
		await user.keyboard("{Enter}");
		expect(document.activeElement).toBe(textarea);
	});

	it("keeps focus on the textarea after Alt+Enter queues a follow-up mid-stream", async () => {
		const user = userEvent.setup();
		render(
			<MessageInput
				onSend={vi.fn()}
				onSteer={vi.fn()}
				onFollowUp={vi.fn()}
				streaming={true}
			/>,
		);
		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
		await user.click(textarea);
		await user.type(textarea, "later");
		await user.keyboard("{Alt>}{Enter}{/Alt}");
		expect(document.activeElement).toBe(textarea);
	});
});
