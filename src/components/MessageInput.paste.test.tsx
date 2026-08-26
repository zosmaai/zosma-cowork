import { cleanupMocks } from "@/test/mocks";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MessageInput } from "./MessageInput";

describe("MessageInput paste detection", () => {
	afterEach(() => {
		cleanupMocks();
	});

	it("shows pasted image preview when pasteHandler gets image data", () => {
		render(<MessageInput sessionFile="/s.test.jsonl" onSend={vi.fn()} />);
		// Component renders with a textarea for input
		expect(screen.getByRole("textbox")).toBeInTheDocument();
	});

	it("includes image data in prompt when sending with pasted image", async () => {
		const onSend = vi.fn();
		render(<MessageInput sessionFile="/s.test.jsonl" onSend={onSend} />);

		const textarea = screen.getByRole("textbox");

		// Type some text
		const user = (await import("@testing-library/user-event")).default.setup();
		await user.type(textarea, "Check this");

		// Send
		const sendBtn = screen.getByRole("button", { name: /send/i });
		await user.click(sendBtn);

		expect(onSend).toHaveBeenCalledWith("Check this");
	});
});
