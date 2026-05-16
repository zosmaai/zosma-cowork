import { cleanupMocks } from "@/test/mocks";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SuggestedActions } from "./SuggestedActions";

describe("SuggestedActions", () => {
	afterEach(() => {
		cleanupMocks();
	});

	it("renders section title", () => {
		render(<SuggestedActions onSend={vi.fn()} />);
		expect(screen.getByText("What are you working on?")).toBeInTheDocument();
	});

	it("renders subtitle", () => {
		render(<SuggestedActions onSend={vi.fn()} />);
		expect(screen.getByText(/Choose a quick start or type below/)).toBeInTheDocument();
	});

	it("renders all suggested action cards", () => {
		render(<SuggestedActions onSend={vi.fn()} />);
		expect(screen.getByText("Write a document")).toBeInTheDocument();
		expect(screen.getByText("Summarize a file")).toBeInTheDocument();
		expect(screen.getByText("Analyze data")).toBeInTheDocument();
		expect(screen.getByText("Translate text")).toBeInTheDocument();
		expect(screen.getByText("Write code")).toBeInTheDocument();
	});

	it("calls onSend with write prompt when Write a document is clicked", async () => {
		const onSend = vi.fn();
		const user = userEvent.setup();
		render(<SuggestedActions onSend={onSend} />);

		await user.click(screen.getByText("Write a document"));
		expect(onSend).toHaveBeenCalledTimes(1);
		expect(onSend).toHaveBeenCalledWith(expect.stringContaining("document"));
	});

	it("calls onSend with summarize prompt when Summarize a file is clicked", async () => {
		const onSend = vi.fn();
		const user = userEvent.setup();
		render(<SuggestedActions onSend={onSend} />);

		await user.click(screen.getByText("Summarize a file"));
		expect(onSend).toHaveBeenCalledWith(expect.stringMatching(/summarize/i));
	});

	it("calls onSend with analyze prompt when Analyze data is clicked", async () => {
		const onSend = vi.fn();
		const user = userEvent.setup();
		render(<SuggestedActions onSend={onSend} />);

		await user.click(screen.getByText("Analyze data"));
		expect(onSend).toHaveBeenCalledWith(expect.stringMatching(/analyze/i));
	});

	it("calls onSend with translate prompt when Translate text is clicked", async () => {
		const onSend = vi.fn();
		const user = userEvent.setup();
		render(<SuggestedActions onSend={onSend} />);

		await user.click(screen.getByText("Translate text"));
		expect(onSend).toHaveBeenCalledWith(expect.stringMatching(/Translate/i));
	});

	it("calls onSend with code prompt when Write code is clicked", async () => {
		const onSend = vi.fn();
		const user = userEvent.setup();
		render(<SuggestedActions onSend={onSend} />);

		await user.click(screen.getByText("Write code"));
		expect(onSend).toHaveBeenCalledWith(expect.stringMatching(/write/i));
	});

	it("provides descriptions for each card", () => {
		render(<SuggestedActions onSend={vi.fn()} />);
		expect(screen.getByText(/Draft a report, proposal/)).toBeInTheDocument();
		expect(screen.getByText(/Extract key points/)).toBeInTheDocument();
		expect(screen.getByText(/Review datasets/)).toBeInTheDocument();
		expect(screen.getByText(/Convert between languages/)).toBeInTheDocument();
		expect(screen.getByText(/Build a script/)).toBeInTheDocument();
	});
});
