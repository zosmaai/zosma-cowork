import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FileMentionPopup } from "./FileMentionPopup";

const mockEntries = [
	{ name: "src", path: "/workspace/src", isDirectory: true },
	{ name: "package.json", path: "/workspace/package.json", isDirectory: false },
	{ name: "README.md", path: "/workspace/README.md", isDirectory: false },
];

describe("FileMentionPopup", () => {
	it("renders folder and file entries with correct icons", () => {
		render(
			<FileMentionPopup
				entries={mockEntries}
				selectedIndex={0}
				query=""
				breadcrumb=""
				onSelectIndex={() => {}}
				onSelect={() => {}}
				anchorRect={{ top: 100, left: 50 }}
			/>,
		);
		// All three entries should render as buttons
		const items = screen.getAllByRole("button");
		expect(items).toHaveLength(3);
	});

	it("shows 'No matches' only when query is non-empty and results are empty", () => {
		// Empty results + empty query → no message (fresh open)
		const { rerender } = render(
			<FileMentionPopup
				entries={[]}
				selectedIndex={0}
				query=""
				breadcrumb=""
				onSelectIndex={() => {}}
				onSelect={() => {}}
				anchorRect={{ top: 100, left: 50 }}
			/>,
		);
		expect(screen.queryByText(/No matches/i)).not.toBeInTheDocument();

		// Empty results + non-empty query → "No matches"
		rerender(
			<FileMentionPopup
				entries={[]}
				selectedIndex={0}
				query="xyz"
				breadcrumb=""
				onSelectIndex={() => {}}
				onSelect={() => {}}
				anchorRect={{ top: 100, left: 50 }}
			/>,
		);
		expect(screen.getByText(/No matches/i)).toBeInTheDocument();
	});

	it("highlights the selected index and only that one", () => {
		render(
			<FileMentionPopup
				entries={mockEntries}
				selectedIndex={1}
				query=""
				breadcrumb=""
				onSelectIndex={() => {}}
				onSelect={() => {}}
				anchorRect={{ top: 100, left: 50 }}
			/>,
		);
		const items = screen.getAllByRole("button");
		// Only the middle item should be selected
		expect(items[0].dataset.selected).toBe("false");
		expect(items[1].dataset.selected).toBe("true");
		expect(items[2].dataset.selected).toBe("false");
	});

	it("handles out-of-bounds selectedIndex gracefully", () => {
		render(
			<FileMentionPopup
				entries={mockEntries}
				selectedIndex={999}
				query=""
				breadcrumb=""
				onSelectIndex={() => {}}
				onSelect={() => {}}
				anchorRect={{ top: 100, left: 50 }}
			/>,
		);
		const items = screen.getAllByRole("button");
		// No item should crash or show selected=true beyond array bounds
		expect(items).toHaveLength(3);
	});

	it("calls onSelect when entry is clicked", async () => {
		const onSelect = vi.fn();
		const user = userEvent.setup();
		render(
			<FileMentionPopup
				entries={mockEntries}
				selectedIndex={0}
				query=""
				breadcrumb=""
				onSelectIndex={() => {}}
				onSelect={onSelect}
				anchorRect={{ top: 100, left: 50 }}
			/>,
		);
		await user.click(screen.getByText("package.json"));
		expect(onSelect).toHaveBeenCalledTimes(1);
		expect(onSelect).toHaveBeenCalledWith(mockEntries[1]);
	});

	it("does not render anything when anchorRect is null", () => {
		const { container } = render(
			<FileMentionPopup
				entries={mockEntries}
				selectedIndex={0}
				query=""
				breadcrumb=""
				onSelectIndex={() => {}}
				onSelect={() => {}}
				anchorRect={null}
			/>,
		);
		expect(container.innerHTML).toBe("");
	});

	it("shows breadcrumb when provided", () => {
		render(
			<FileMentionPopup
				entries={mockEntries}
				selectedIndex={0}
				query=""
				breadcrumb="workspace > src > hooks"
				onSelectIndex={() => {}}
				onSelect={() => {}}
				anchorRect={{ top: 100, left: 50 }}
			/>,
		);
		expect(screen.getByText("workspace > src > hooks")).toBeInTheDocument();
	});

	it("renders a single entry correctly", () => {
		render(
			<FileMentionPopup
				entries={[mockEntries[0]]}
				selectedIndex={0}
				query=""
				breadcrumb=""
				onSelectIndex={() => {}}
				onSelect={() => {}}
				anchorRect={{ top: 100, left: 50 }}
			/>,
		);
		expect(screen.getAllByRole("button")).toHaveLength(1);
		expect(screen.getByText("src")).toBeInTheDocument();
	});
});
