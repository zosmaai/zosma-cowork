import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FeedbackDialog } from "./FeedbackDialog";

const mockTrackEvent = vi.fn();
vi.mock("@/lib/telemetry", () => ({
	trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

describe("FeedbackDialog", () => {
	it("renders when open", () => {
		render(<FeedbackDialog open={true} onClose={() => {}} />);
		expect(screen.getByText("Send Feedback")).toBeDefined();
	});

	it("does not render when closed", () => {
		render(<FeedbackDialog open={false} onClose={() => {}} />);
		expect(screen.queryByText("Send Feedback")).toBeNull();
	});

	it("renders category selector", () => {
		render(<FeedbackDialog open={true} onClose={() => {}} />);
		expect(screen.getByText("Bug Report")).toBeDefined();
		expect(screen.getByText("Feature Request")).toBeDefined();
		expect(screen.getByText("General")).toBeDefined();
	});

	it("renders message textarea", () => {
		render(<FeedbackDialog open={true} onClose={() => {}} />);
		expect(screen.getByPlaceholderText("Describe your feedback in detail...")).toBeDefined();
	});

	it("renders optional email input", () => {
		render(<FeedbackDialog open={true} onClose={() => {}} />);
		expect(screen.getByPlaceholderText("Email (optional, if you'd like a reply)")).toBeDefined();
	});

	it("submit button is disabled when message is empty", () => {
		render(<FeedbackDialog open={true} onClose={() => {}} />);
		const submitBtn = screen.getByText("Submit Feedback");
		expect(submitBtn).toBeDisabled();
	});

	it("submit button is enabled when message is filled", () => {
		render(<FeedbackDialog open={true} onClose={() => {}} />);
		const textarea = screen.getByPlaceholderText("Describe your feedback in detail...");
		fireEvent.change(textarea, { target: { value: "Great app!" } });
		const submitBtn = screen.getByText("Submit Feedback");
		expect(submitBtn).not.toBeDisabled();
	});

	it("calls trackEvent on submit and closes", () => {
		const onClose = vi.fn();
		render(<FeedbackDialog open={true} onClose={onClose} />);
		const textarea = screen.getByPlaceholderText("Describe your feedback in detail...");
		fireEvent.change(textarea, { target: { value: "Love this app" } });
		fireEvent.click(screen.getByText("Submit Feedback"));
		expect(mockTrackEvent).toHaveBeenCalledWith("app_feedback", {
			category: "general",
			message: "Love this app",
		});
		expect(onClose).toHaveBeenCalled();
	});

	it("includes category in telemetry", () => {
		render(<FeedbackDialog open={true} onClose={() => {}} />);
		const textarea = screen.getByPlaceholderText("Describe your feedback in detail...");
		fireEvent.change(textarea, { target: { value: "Button misaligned" } });
		fireEvent.click(screen.getByText("Bug Report"));
		fireEvent.click(screen.getByText("Submit Feedback"));
		expect(mockTrackEvent).toHaveBeenCalledWith("app_feedback", {
			category: "bug",
			message: "Button misaligned",
		});
	});

	it("resets form when reopened", () => {
		const { rerender } = render(<FeedbackDialog open={true} onClose={() => {}} />);
		const textarea = screen.getByPlaceholderText("Describe your feedback in detail...");
		fireEvent.change(textarea, { target: { value: "Feedback text" } });
		fireEvent.click(screen.getByText("General"));

		// Close the dialog
		rerender(<FeedbackDialog open={false} onClose={() => {}} />);
		expect(screen.queryByText("Send Feedback")).toBeNull();

		// Re-open
		rerender(<FeedbackDialog open={true} onClose={() => {}} />);
		expect(
			(screen.getByPlaceholderText("Describe your feedback in detail...") as HTMLTextAreaElement)
				.value,
		).toBe("");
	});
});
