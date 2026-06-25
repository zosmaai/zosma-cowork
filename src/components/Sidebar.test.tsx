import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";

const noop = () => {};

// jsdom has no IntersectionObserver; ConversationSearch's infinite-scroll
// sentinel constructs one. Stub it so the chats panel renders.
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

const baseProps = {
	sessions: [{ id: "1", title: "Hello", lastMessage: "hi", timestamp: 1000 }],
	onSessionSelect: noop,
	onNewSession: noop,
	onOpenSession: noop,
	onDeleteSession: noop,
};

describe("Sidebar IA (Cowork / Tasks)", () => {
	it("renders the Cowork and Tasks tabs, not Templates/Chats", () => {
		render(<Sidebar view="chats" onChangeView={noop} {...baseProps} />);

		expect(screen.getByText("Cowork")).toBeInTheDocument();
		expect(screen.getByText("Tasks")).toBeInTheDocument();
		expect(screen.queryByText("Templates")).not.toBeInTheDocument();
		expect(screen.queryByText("Chats")).not.toBeInTheDocument();
	});

	it("selecting the Tasks tab calls onChangeView('tasks')", () => {
		const onChangeView = vi.fn();
		render(<Sidebar view="chats" onChangeView={onChangeView} {...baseProps} />);

		fireEvent.click(screen.getByText("Tasks"));

		expect(onChangeView).toHaveBeenCalledWith("tasks");
	});

	it("renders the Tasks placeholder panel when view is 'tasks'", () => {
		render(<Sidebar view="tasks" onChangeView={noop} {...baseProps} />);

		expect(screen.getByText("No tasks yet")).toBeInTheDocument();
	});
});
