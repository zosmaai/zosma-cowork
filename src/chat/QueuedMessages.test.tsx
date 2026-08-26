import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { QueuedMessages } from "./QueuedMessages";

describe("QueuedMessages", () => {
	it("renders steering then follow-up in one threaded group", () => {
		const { container } = render(
			<QueuedMessages queue={{ steering: ["Change tone"], followUp: ["Add sources"] }} />,
		);
		const text = container.textContent ?? "";
		expect(text.indexOf("Change tone")).toBeLessThan(text.indexOf("Add sources"));
		expect(screen.getByText(/Steering\b/i)).toBeInTheDocument();
		expect(screen.getByText(/Follow-up\b/i)).toBeInTheDocument();
		expect(screen.getAllByText(/Ctrl\+↑ to edit all queued messages/i)).toHaveLength(1);
		expect(screen.getByTestId("queued-thread").className).toMatch(/border-l/);
	});

	it("renders nothing for an empty queue", () => {
		const { container } = render(<QueuedMessages queue={{ steering: [], followUp: [] }} />);
		expect(container).toBeEmptyDOMElement();
	});
});
