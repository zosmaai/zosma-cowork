import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SessionEmptyIntro, SessionStarterPrompts } from "./SessionEmptyState";

it("renders the conversational Chat hierarchy", () => {
	render(<SessionEmptyIntro mode="chat" onModeChange={vi.fn()} />);
	expect(screen.getByRole("heading", { name: "What’s on your mind today?" })).toBeInTheDocument();
	expect(screen.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
});

it("renders the task-oriented Work hierarchy and workspace", () => {
	render(
		<>
			<SessionEmptyIntro mode="work" onModeChange={vi.fn()} />
			<SessionStarterPrompts mode="work" workspaceCwd="/work/acme" onSelect={vi.fn()} />
		</>,
	);
	expect(screen.getByRole("heading", { name: "What should we work on?" })).toBeInTheDocument();
	expect(screen.getByText("/work/acme")).toBeInTheDocument();
	expect(screen.getByRole("tab", { name: "Work" })).toHaveAttribute("aria-selected", "true");
});

it("supports arrow-key tab selection", () => {
	const onModeChange = vi.fn();
	render(<SessionEmptyIntro mode="chat" onModeChange={onModeChange} />);
	fireEvent.keyDown(screen.getByRole("tab", { name: "Chat" }), { key: "ArrowRight" });
	expect(onModeChange).toHaveBeenCalledWith("work");
	expect(screen.getByRole("tab", { name: "Work" })).toHaveFocus();
});

it("starter prompts fill through onSelect and never send", () => {
	const onSelect = vi.fn();
	render(<SessionStarterPrompts mode="chat" onSelect={onSelect} />);
	fireEvent.click(screen.getByRole("button", { name: "Help me write" }));
	expect(onSelect).toHaveBeenCalledWith("Help me write");
});

it("disables mode tabs while first-send mode commit is pending", () => {
	render(<SessionEmptyIntro mode="work" onModeChange={vi.fn()} disabled />);
	expect(screen.getByRole("tab", { name: "Chat" })).toBeDisabled();
	expect(screen.getByRole("tab", { name: "Work" })).toBeDisabled();
});

it("shows an inline mode-save error", () => {
	render(
		<SessionEmptyIntro
			mode="chat"
			onModeChange={vi.fn()}
			error="Couldn’t save this session’s mode. Try again."
		/>,
	);
	expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t save this session’s mode");
});