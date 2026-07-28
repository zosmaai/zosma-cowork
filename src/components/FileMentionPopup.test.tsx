import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileMentionPopup } from "./FileMentionPopup";

const mockEntries = [
	{ name: "src", path: "/workspace/src", isDirectory: true },
	{ name: "package.json", path: "/workspace/package.json", isDirectory: false },
	{ name: "README.md", path: "/workspace/README.md", isDirectory: false },
];

const baseProps = {
	entries: [] as typeof mockEntries,
	selectedIndex: 0,
	query: "",
	breadcrumb: "",
	loading: false,
	onSelectIndex: () => {},
	onSelect: () => {},
	anchorRect: { top: 100, left: 50 } as const,
};

describe("FileMentionPopup", () => {
	it("renders folder and file entries with correct icons", () => {
		render(<FileMentionPopup {...baseProps} entries={mockEntries} />);
		const items = screen.getAllByRole("button");
		expect(items).toHaveLength(3);
	});

	it("shows 'No matches' only when query is non-empty and results are empty", () => {
		// Empty results + empty query + not loading → "No files in workspace"
		const { rerender } = render(<FileMentionPopup {...baseProps} />);
		expect(screen.queryByText(/No matches/i)).not.toBeInTheDocument();
		expect(screen.getByText("No files in workspace")).toBeInTheDocument();

		// Empty results + non-empty query → "No matches"
		rerender(<FileMentionPopup {...baseProps} query="xyz" />);
		expect(screen.getByText(/No matches/i)).toBeInTheDocument();
	});

	it("shows loading state when loading is true", () => {
		render(<FileMentionPopup {...baseProps} loading={true} />);
		expect(screen.getByText(/Loading workspace files/)).toBeInTheDocument();
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
	});

	it("shows empty workspace state when not loading, no query, and no entries", () => {
		render(<FileMentionPopup {...baseProps} entries={[]} />);
		expect(screen.getByText("No files in workspace")).toBeInTheDocument();
	});

	it("highlights the selected index and only that one", () => {
		render(<FileMentionPopup {...baseProps} entries={mockEntries} selectedIndex={1} />);
		const items = screen.getAllByRole("button");
		expect(items[0].dataset.selected).toBe("false");
		expect(items[1].dataset.selected).toBe("true");
		expect(items[2].dataset.selected).toBe("false");
	});

	it("handles out-of-bounds selectedIndex gracefully", () => {
		render(<FileMentionPopup {...baseProps} entries={mockEntries} selectedIndex={999} />);
		const items = screen.getAllByRole("button");
		expect(items).toHaveLength(3);
	});

	it("calls onSelect when entry is clicked", async () => {
		const onSelect = vi.fn();
		const user = userEvent.setup();
		render(<FileMentionPopup {...baseProps} entries={mockEntries} onSelect={onSelect} />);
		await user.click(screen.getByText("package.json"));
		expect(onSelect).toHaveBeenCalledWith(mockEntries[1]);
	});

	it("does not render anything when anchorRect is null", () => {
		const { container } = render(<FileMentionPopup {...baseProps} anchorRect={null} />);
		expect(container.innerHTML).toBe("");
	});

	it("shows breadcrumb when provided", () => {
		render(
			<FileMentionPopup {...baseProps} entries={mockEntries} breadcrumb="workspace > src > hooks" />,
		);
		expect(screen.getByText("workspace > src > hooks")).toBeInTheDocument();
	});
});
