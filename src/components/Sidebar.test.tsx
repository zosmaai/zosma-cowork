import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";

const noop = () => {};

// jsdom has no IntersectionObserver; ConversationSearch's infinite-scroll
// sentinel constructs one. Stub it so the sessions panel renders.
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
	onChangeView: noop,
};

describe("Sidebar", () => {
	it("renders the session list", () => {
		render(<Sidebar {...baseProps} />);
		expect(screen.getByText("Hello")).toBeInTheDocument();
	});

	it("clicking Settings calls onChangeView('settings')", () => {
		const onChangeView = vi.fn();
		render(<Sidebar {...baseProps} onChangeView={onChangeView} />);
		fireEvent.click(screen.getByText("Settings"));
		expect(onChangeView).toHaveBeenCalledWith("settings");
	});

	it("shows the running count when collapsed", () => {
		render(
			<Sidebar
				{...baseProps}
				collapsed
				onCollapsedChange={vi.fn()}
				sessions={[
					{
						id: "1",
						title: "First",
						lastMessage: "work",
						timestamp: 1,
						runtimeStatus: "running",
					},
					{
						id: "2",
						title: "Second",
						lastMessage: "work",
						timestamp: 2,
						runtimeStatus: "running",
					},
				]}
			/>,
		);
		expect(screen.getByLabelText("2 running sessions")).toBeInTheDocument();
	});
});
