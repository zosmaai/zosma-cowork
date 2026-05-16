import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FeedbackButtons } from "./FeedbackButtons";

// Mock telemetry trackEvent
const mockTrackEvent = vi.fn();
vi.mock("@/lib/telemetry", () => ({
	trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

describe("FeedbackButtons", () => {
	it("renders thumbs up and thumbs down buttons", () => {
		render(<FeedbackButtons />);
		expect(screen.getByTitle("Good response")).toBeDefined();
		expect(screen.getByTitle("Bad response")).toBeDefined();
	});

	it("starts with no feedback selected", () => {
		render(<FeedbackButtons />);
		expect(screen.queryByText("What went wrong?")).toBeNull();
	});

	it("highlights thumbs up when clicked", () => {
		render(<FeedbackButtons />);
		const upBtn = screen.getByTitle("Good response");
		fireEvent.click(upBtn);
		// After clicking, the up button should have a different class
		expect(upBtn.className).toContain("text-primary");
	});

	it("highlights thumbs down when clicked", () => {
		render(<FeedbackButtons />);
		const downBtn = screen.getByTitle("Bad response");
		fireEvent.click(downBtn);
		expect(downBtn.className).toContain("text-destructive");
	});

	it("shows feedback textarea when thumbs down is clicked", () => {
		render(<FeedbackButtons />);
		fireEvent.click(screen.getByTitle("Bad response"));
		expect(screen.getByPlaceholderText("What went wrong? (optional)")).toBeDefined();
		expect(screen.getByText("Submit")).toBeDefined();
	});

	it("hides textarea when switching to thumbs up", () => {
		render(<FeedbackButtons />);
		fireEvent.click(screen.getByTitle("Bad response"));
		expect(screen.getByPlaceholderText("What went wrong? (optional)")).toBeDefined();
		fireEvent.click(screen.getByTitle("Good response"));
		expect(screen.queryByPlaceholderText("What went wrong? (optional)")).toBeNull();
	});

	it("calls trackEvent when thumbs up is submitted", () => {
		render(<FeedbackButtons />);
		fireEvent.click(screen.getByTitle("Good response"));
		expect(mockTrackEvent).toHaveBeenCalledWith("feedback", {
			rating: "up",
		});
	});

	it("calls trackEvent when thumbs down feedback is submitted", () => {
		render(<FeedbackButtons />);
		fireEvent.click(screen.getByTitle("Bad response"));
		const textarea = screen.getByPlaceholderText("What went wrong? (optional)");
		fireEvent.change(textarea, { target: { value: "Wrong answer" } });
		fireEvent.click(screen.getByText("Submit"));
		expect(mockTrackEvent).toHaveBeenCalledWith("feedback", {
			rating: "down",
			message: "Wrong answer",
		});
	});

	it("can toggle thumbs up off", () => {
		render(<FeedbackButtons />);
		const upBtn = screen.getByTitle("Good response");
		fireEvent.click(upBtn);
		expect(upBtn.className).toContain("text-primary");
		// Click again to deselect
		fireEvent.click(upBtn);
		expect(upBtn.className).not.toContain("text-primary");
	});

	it("allows submitting feedback via pressing Enter", () => {
		render(<FeedbackButtons />);
		fireEvent.click(screen.getByTitle("Bad response"));
		const textarea = screen.getByPlaceholderText("What went wrong? (optional)");
		fireEvent.change(textarea, { target: { value: "Incorrect" } });
		fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
		expect(mockTrackEvent).toHaveBeenCalledWith("feedback", {
			rating: "down",
			message: "Incorrect",
		});
	});
});
