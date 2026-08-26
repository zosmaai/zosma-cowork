import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WorkOutput, WorkSource } from "@/lib/work-projections";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkPanel } from "./WorkPanel";

const { invoke, openExternalUrl } = vi.hoisted(() => ({
	invoke: vi.fn(),
	openExternalUrl: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/lib/utils", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/utils")>()),
	openExternalUrl,
}));

const output: WorkOutput = {
	kind: "file",
	identity: "/work/report.md",
	displayValue: "report.md",
	path: "/work/report.md",
	title: "report.md",
	messageId: "m1",
	toolCallId: "w1",
};
const urlSource: WorkSource = {
	kind: "url",
	identity: "https://example.com/report",
	displayValue: "https://Example.com/report#part",
	title: "Reference report",
	messageId: "m2",
};

describe("WorkPanel", () => {
	beforeEach(() => {
		invoke.mockReset();
		openExternalUrl.mockReset();
	});

	it("keeps restrained Outputs and Sources empty states visible", () => {
		render(<WorkPanel outputs={[]} sources={[]} workspace="/work" open onClose={vi.fn()} />);
		expect(screen.getByRole("heading", { name: "Outputs" })).toBeInTheDocument();
		expect(screen.getByText("No outputs yet")).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "Sources" })).toBeInTheDocument();
		expect(screen.getByText("No sources yet")).toBeInTheDocument();
	});

	it("renders output and discriminated URL/file sources", () => {
		const fileSource: WorkSource = {
			kind: "file",
			identity: "/refs/a.pdf",
			displayValue: "/refs/a.pdf",
			title: "a.pdf",
			messageId: "u1",
		};
		render(
			<WorkPanel
				outputs={[output]}
				sources={[urlSource, fileSource]}
				workspace="/work"
				open
				onClose={vi.fn()}
			/>,
		);
		expect(screen.getByRole("button", { name: /report.md/i })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /Reference report/i })).toBeInTheDocument();
		expect(screen.getByText("a.pdf")).toBeInTheDocument();
	});

	it("loads a selected output and opens only its authorized folder", async () => {
		invoke.mockResolvedValueOnce({ bytes: [35, 32, 82], mimeType: "text/markdown" });
		render(<WorkPanel outputs={[output]} sources={[]} workspace="/work" open onClose={vi.fn()} />);
		fireEvent.click(screen.getByRole("button", { name: /report.md/i }));
		await screen.findByText("# R");
		fireEvent.click(screen.getByRole("button", { name: "Open output folder" }));
		expect(invoke).toHaveBeenCalledWith("open_workspace_folder", {
			path: "/work/report.md",
			workspace: "/work",
		});
	});

	it("retains an unavailable output row and reports failure inline", async () => {
		invoke.mockRejectedValueOnce(new Error("File unavailable"));
		render(<WorkPanel outputs={[output]} sources={[]} workspace="/work" open onClose={vi.fn()} />);
		fireEvent.click(screen.getByRole("button", { name: /report.md/i }));
		await screen.findByText("File unavailable");
		expect(screen.getByRole("button", { name: /report.md/i })).toBeInTheDocument();
	});

	it("clears selected preview when that identity disappears", async () => {
		invoke.mockResolvedValueOnce({ bytes: [120], mimeType: "text/plain" });
		const { rerender } = render(
			<WorkPanel outputs={[output]} sources={[]} workspace="/work" open onClose={vi.fn()} />,
		);
		fireEvent.click(screen.getByRole("button", { name: /report.md/i }));
		await waitFor(() => expect(screen.getByTestId("artifact-filename")).toBeInTheDocument());
		rerender(<WorkPanel outputs={[]} sources={[]} workspace="/work" open onClose={vi.fn()} />);
		expect(screen.queryByTestId("artifact-filename")).toBeNull();
	});

	it("uses modal semantics, traps focus, and closes on Escape", async () => {
		render(
			<WorkPanel
				outputs={[output]}
				sources={[urlSource]}
				workspace="/work"
				open
				onClose={invoke}
			/>,
		);
		const dialog = screen.getByRole("dialog", { name: "Work outputs and sources" });
		expect(dialog).toHaveAttribute("aria-modal", "true");
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Close Work panel" })).toHaveFocus(),
		);
		fireEvent.keyDown(dialog, { key: "Tab" });
		expect(dialog).toContainElement(document.activeElement as HTMLElement);
		fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
		expect(dialog).toContainElement(document.activeElement as HTMLElement);
		fireEvent.keyDown(window, { key: "Escape" });
		expect(invoke).toHaveBeenCalled();
	});

	it("marks a closed panel for the CSS visibility contract", () => {
		render(
			<WorkPanel outputs={[]} sources={[]} workspace="/work" open={false} onClose={vi.fn()} />,
		);
		const panel = screen.getByRole("region", { name: "Work outputs and sources" });
		expect(panel).toHaveAttribute("data-open", "false");
		expect(panel).not.toHaveAttribute("aria-modal");
	});

	it("opens a URL source by normalized identity", () => {
		render(
			<WorkPanel outputs={[]} sources={[urlSource]} workspace="/work" open onClose={vi.fn()} />,
		);
		fireEvent.click(screen.getByRole("button", { name: /Reference report/i }));
		expect(openExternalUrl).toHaveBeenCalledWith("https://example.com/report");
		expect(openExternalUrl).not.toHaveBeenCalledWith(urlSource.displayValue);
	});
});
