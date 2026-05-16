import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConversationSearch } from "./ConversationSearch";

const noop = () => {};

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
				onNewSession={noop}
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
				onNewSession={noop}
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
				onNewSession={noop}
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
				onNewSession={noop}
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
				onNewSession={noop}
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
				onNewSession={noop}
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
				onNewSession={noop}
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
				onNewSession={noop}
				onDeleteSession={noop}
				activeSessionId="2"
			/>,
		);
		const items = screen.getAllByRole("button");
		const activeItem = items.find((item) => item.textContent?.includes("API design patterns"));
		expect(activeItem?.className).toContain("bg-sidebar-accent");
	});
});
