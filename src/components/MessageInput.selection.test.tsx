import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MessageInput } from "./MessageInput";

const quoteContext = {
	excerpt: "Selected answer\nwith evidence",
	onRemove: vi.fn(),
};

describe("MessageInput selected quote context", () => {
	it("shows a removable quote card without inserting it into the editable field", () => {
		render(<MessageInput sessionFile="/a.jsonl" onSend={vi.fn()} quoteContext={quoteContext} />);
		expect(screen.getByRole("region", { name: "Quoted context" })).toHaveTextContent(
			"Selected answer with evidence",
		);
		expect(screen.getByRole("textbox")).toHaveValue("");
		expect(screen.getByRole("button", { name: "Remove quoted context" })).toBeInTheDocument();
	});

	it("does not enable sending for quote context alone", () => {
		render(<MessageInput sessionFile="/a.jsonl" onSend={vi.fn()} quoteContext={quoteContext} />);
		expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
	});

	it("requires a custom instruction while preserving files already attached", async () => {
		const user = userEvent.setup();
		const onSend = vi.fn();
		render(
			<MessageInput
				sessionFile="/a.jsonl"
				onSend={onSend}
				pendingDropFiles={[{
					path: "/work/reference.pdf",
					name: "reference.pdf",
					size: 12,
					mimeType: "application/pdf",
				}]}
				pendingDropNonce={1}
				quoteContext={{ excerpt: "Selected answer", onRemove: vi.fn() }}
			/>,
		);
		expect(await screen.findByText("reference.pdf")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
		await user.type(screen.getByRole("textbox"), "Compare this with the reference");
		await user.keyboard("{Enter}");
		expect(onSend).toHaveBeenCalledWith(
			"[File: /work/reference.pdf]\n\n> Selected answer\n\nCompare this with the reference",
		);
	});

	it("prepends the quote to a custom instruction and consumes it after send", async () => {
		const user = userEvent.setup();
		const onSend = vi.fn();
		const onRemove = vi.fn();
		render(
			<MessageInput
				sessionFile="/a.jsonl"
				onSend={onSend}
				quoteContext={{ excerpt: "Selected answer\nwith evidence", onRemove }}
			/>,
		);
		await user.type(screen.getByRole("textbox"), "Explain this");
		await user.keyboard("{Enter}");
		expect(onSend).toHaveBeenCalledWith(
			"> Selected answer\n> with evidence\n\nExplain this",
		);
		expect(onRemove).toHaveBeenCalledTimes(1);
	});

	it("removes the quote without clearing the typed instruction", async () => {
		const user = userEvent.setup();
		const onRemove = vi.fn();
		render(
			<MessageInput
				sessionFile="/a.jsonl"
				onSend={vi.fn()}
				quoteContext={{ excerpt: "Selected answer", onRemove }}
			/>,
		);
		await user.type(screen.getByRole("textbox"), "Keep this draft");
		await user.click(screen.getByRole("button", { name: "Remove quoted context" }));
		expect(onRemove).toHaveBeenCalledTimes(1);
		expect(screen.getByRole("textbox")).toHaveValue("Keep this draft");
	});
});
