import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ConversationSearch } from "./ConversationSearch";

const noop = () => {};

// jsdom has no IntersectionObserver; the infinite-scroll sentinel constructs one
// whenever there are more matches than a page. Stub it so those paths render.
beforeAll(() => {
	class IO {
		observe() {}
		unobserve() {}
		disconnect() {}
		takeRecords() {
			return [];
		}
	}
	vi.stubGlobal("IntersectionObserver", IO);
});

const mockSessions = [
	{ id: "1", title: "React project setup", lastMessage: "How do I init", timestamp: 1000 },
	{ id: "2", title: "API design patterns", lastMessage: "Best practices", timestamp: 2000 },
	{ id: "3", title: "Debugging memory leaks", lastMessage: "Node process", timestamp: 3000 },
];

describe("ConversationSearch", () => {
	it("renders search input", () => {
		render(
			<ConversationSearch
				sessions={mockSessions}
				onSelect={noop}
				onNewSession={noop} onOpenSession={noop}
				onDeleteSession={noop}
			/>,
		);
		expect(screen.getByPlaceholderText("Search conversations...")).toBeDefined();
	});

	it("shows all sessions when search is empty", () => {
		render(
			<ConversationSearch
				sessions={mockSessions}
				onSelect={noop}
				onNewSession={noop} onOpenSession={noop}
				onDeleteSession={noop}
			/>,
		);
		expect(screen.getByText("React project setup")).toBeDefined();
		expect(screen.getByText("API design patterns")).toBeDefined();
		expect(screen.getByText("Debugging memory leaks")).toBeDefined();
	});

	it("filters sessions by title", async () => {
		render(
			<ConversationSearch
				sessions={mockSessions}
				onSelect={noop}
				onNewSession={noop} onOpenSession={noop}
				onDeleteSession={noop}
			/>,
		);
		const input = screen.getByPlaceholderText("Search conversations...");
		fireEvent.change(input, { target: { value: "React" } });
		expect(screen.getByText("React project setup")).toBeDefined();
		expect(screen.queryByText("API design patterns")).toBeNull();
		expect(screen.queryByText("Debugging memory leaks")).toBeNull();
	});

	it("filters sessions by lastMessage content", async () => {
		render(
			<ConversationSearch
				sessions={mockSessions}
				onSelect={noop}
				onNewSession={noop} onOpenSession={noop}
				onDeleteSession={noop}
			/>,
		);
		const input = screen.getByPlaceholderText("Search conversations...");
		fireEvent.change(input, { target: { value: "Best practices" } });
		expect(screen.queryByText("React project setup")).toBeNull();
		expect(screen.getByText("API design patterns")).toBeDefined();
	});

	it("shows no results message when nothing matches", async () => {
		render(
			<ConversationSearch
				sessions={mockSessions}
				onSelect={noop}
				onNewSession={noop} onOpenSession={noop}
				onDeleteSession={noop}
			/>,
		);
		const input = screen.getByPlaceholderText("Search conversations...");
		fireEvent.change(input, { target: { value: "zzz_no_match" } });
		expect(screen.getByText("No results")).toBeDefined();
	});

	it("calls onSelect when a session is clicked", () => {
		const onSelect = vi.fn();
		render(
			<ConversationSearch
				sessions={mockSessions}
				onSelect={onSelect}
				onNewSession={noop} onOpenSession={noop}
				onDeleteSession={noop}
			/>,
		);
		fireEvent.click(screen.getByText("React project setup"));
		expect(onSelect).toHaveBeenCalledWith("1");
	});

	it("is case-insensitive", async () => {
		render(
			<ConversationSearch
				sessions={mockSessions}
				onSelect={noop}
				onNewSession={noop} onOpenSession={noop}
				onDeleteSession={noop}
			/>,
		);
		const input = screen.getByPlaceholderText("Search conversations...");
		fireEvent.change(input, { target: { value: "react" } });
		expect(screen.getByText("React project setup")).toBeDefined();
	});

	it("highlights active session", () => {
		render(
			<ConversationSearch
				sessions={mockSessions}
				onSelect={noop}
				onNewSession={noop} onOpenSession={noop}
				onDeleteSession={noop}
				activeSessionId="2"
			/>,
		);
		const items = screen.getAllByRole("button");
		const activeItem = items.find((item) => item.textContent?.includes("API design patterns"));
		expect(activeItem?.className).toContain("bg-sidebar-accent");
	});
});

describe("ConversationSearch — pin / rename / deep search", () => {
	const sessions = [
		{ id: "1", title: "React project setup", lastMessage: "init", timestamp: 1000 },
		{
			id: "2",
			title: "Pinned planning doc",
			lastMessage: "roadmap",
			timestamp: 500,
			pinned: true,
		},
		{ id: "3", title: "Debugging memory leaks", lastMessage: "node", timestamp: 3000 },
	];

	it("renders a Pinned group when a session is pinned", () => {
		render(
			<ConversationSearch
				sessions={sessions}
				onSelect={noop}
				onNewSession={noop} onOpenSession={noop}
				onDeleteSession={noop}
				onPinSession={vi.fn()}
			/>,
		);
		expect(screen.getByText("Pinned")).toBeDefined();
		expect(screen.getByText("Recent")).toBeDefined();
	});

	it("calls onPinSession with the toggled state", () => {
		const onPin = vi.fn();
		render(
			<ConversationSearch
				sessions={sessions}
				onSelect={noop}
				onNewSession={noop} onOpenSession={noop}
				onDeleteSession={noop}
				onPinSession={onPin}
			/>,
		);
		// Unpinned session #1 → pin it.
		fireEvent.click(screen.getByRole("button", { name: "Pin session React project setup" }));
		expect(onPin).toHaveBeenCalledWith("1", true);
		// Pinned session #2 → unpin it.
		fireEvent.click(screen.getByRole("button", { name: "Unpin session Pinned planning doc" }));
		expect(onPin).toHaveBeenCalledWith("2", false);
	});

	it("requests a rename popup when the edit button is clicked", () => {
		const onRequestRename = vi.fn();
		render(
			<ConversationSearch
				sessions={sessions}
				onSelect={noop}
				onNewSession={noop} onOpenSession={noop}
				onDeleteSession={noop}
				onRequestRename={onRequestRename}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Rename session React project setup" }));
		expect(onRequestRename).toHaveBeenCalledWith("1");
	});

	it("requests a rename popup on double-click of a row", () => {
		const onRequestRename = vi.fn();
		render(
			<ConversationSearch
				sessions={sessions}
				onSelect={noop}
				onNewSession={noop} onOpenSession={noop}
				onDeleteSession={noop}
				onRequestRename={onRequestRename}
			/>,
		);
		fireEvent.doubleClick(screen.getByText("Debugging memory leaks"));
		expect(onRequestRename).toHaveBeenCalledWith("3");
	});

	it("does not render an inline rename input (editing happens in a popup)", () => {
		render(
			<ConversationSearch
				sessions={sessions}
				onSelect={noop}
				onNewSession={noop} onOpenSession={noop}
				onDeleteSession={noop}
				onRequestRename={vi.fn()}
			/>,
		);
		// Only the search box is a textbox; clicking edit must NOT add an inline input.
		expect(screen.getAllByRole("textbox")).toHaveLength(1);
		fireEvent.click(screen.getByRole("button", { name: "Rename session React project setup" }));
		expect(screen.getAllByRole("textbox")).toHaveLength(1);
	});
});

describe("ConversationSearch — pagination (infinite scroll)", () => {
	const many = Array.from({ length: 25 }, (_, i) => ({
		id: String(i),
		title: `Session number ${i}`,
		lastMessage: `message ${i}`,
		timestamp: 1000 - i, // descending so order is stable (0 first)
	}));

	it("only renders the first page (10) of rows initially", () => {
		render(
			<ConversationSearch
				sessions={many}
				onSelect={noop}
				onNewSession={noop} onOpenSession={noop}
				onDeleteSession={noop}
			/>,
		);
		// One Delete button per rendered row.
		const rows = screen.getAllByRole("button", { name: /^Delete session/ });
		expect(rows).toHaveLength(10);
		expect(screen.getByText("Session number 0")).toBeDefined();
		expect(screen.queryByText("Session number 12")).toBeNull();
	});

	it("search matches sessions beyond the first page", () => {
		render(
			<ConversationSearch
				sessions={many}
				onSelect={noop}
				onNewSession={noop} onOpenSession={noop}
				onDeleteSession={noop}
			/>,
		);
		// 'Session number 20' is past the initial 10, but search scans ALL sessions.
		const input = screen.getByPlaceholderText("Search conversations...");
		fireEvent.change(input, { target: { value: "number 20" } });
		expect(screen.getByText("Session number 20")).toBeDefined();
		expect(screen.queryByText("Session number 0")).toBeNull();
	});
});

describe("ConversationSearch — deep content search", () => {
	const sessions = [
		{ id: "a.jsonl", title: "React", lastMessage: "init", timestamp: 1000 },
		{ id: "b.jsonl", title: "Rust", lastMessage: "borrow", timestamp: 2000 },
	];

	it("merges deep-search hits (matching message bodies) into the visible list", async () => {
		// Query 'ownership' matches no title/preview, but the deep search returns
		// session b.jsonl by body content.
		const onDeepSearch = vi
			.fn()
			.mockResolvedValue([
				{ file: "b.jsonl", snippet: "…explain ownership and lifetimes…", matchCount: 1 },
			]);
		render(
			<ConversationSearch
				sessions={sessions}
				onSelect={noop}
				onNewSession={noop} onOpenSession={noop}
				onDeleteSession={noop}
				onDeepSearch={onDeepSearch}
			/>,
		);
		const input = screen.getByPlaceholderText("Search conversations...");
		fireEvent.change(input, { target: { value: "ownership" } });
		// Debounce (180ms) then the resolved hit merges into the list.
		await waitFor(() => expect(onDeepSearch).toHaveBeenCalledWith("ownership"));
		await waitFor(() => {
			expect(screen.getByText("Rust")).toBeDefined();
		});
		// The snippet replaces the preview for the matched row.
		expect(screen.getByText(/explain ownership and lifetimes/i)).toBeDefined();
		// Non-matching session is filtered out.
		expect(screen.queryByText("React")).toBeNull();
	});
});
