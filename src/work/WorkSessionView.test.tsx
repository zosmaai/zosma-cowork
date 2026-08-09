import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkSessionView } from "./WorkSessionView";

describe("WorkSessionView", () => {
	it("renders user directions compactly and assistant content as a document", () => {
		const { container } = render(
			<WorkSessionView
				messages={[
					{ id: "u", role: "user", content: "Research this market", timestamp: 1 },
					{ id: "a", role: "assistant", content: "# Findings\nEvidence", timestamp: 2 },
				]}
				streamingMessage={null}
				isRunning={false}
				models={[]}
				detailsExpanded={false}
				workspaceCwd="/work"
			/>,
		);
		expect(screen.getByText("Research this market").closest("blockquote")).toBeInTheDocument();
		expect(screen.getByRole("heading", { name: "Findings" })).toBeInTheDocument();
		expect(container.querySelector(".work-result-document")).toBeInTheDocument();
		expect(container.querySelector(".chat-bubble")).toBeNull();
	});

	it("shows quiet live activity and keeps detailed tools behind Ctrl+O state", () => {
		const running = {
			id: "a",
			role: "assistant" as const,
			content: "",
			timestamp: 2,
			isStreaming: true,
			toolCalls: [{ id: "t", name: "web_search_exa", args: {}, status: "running" as const }],
		};
		const { rerender } = render(
			<WorkSessionView
				messages={[]}
				streamingMessage={running}
				isRunning
				models={[]}
				detailsExpanded={false}
				workspaceCwd="/work"
			/>,
		);
		expect(screen.getByText(/Searching the web/i)).toBeInTheDocument();
		rerender(
			<WorkSessionView
				messages={[]}
				streamingMessage={running}
				isRunning
				models={[]}
				detailsExpanded
				workspaceCwd="/work"
			/>,
		);
		expect(screen.getAllByText(/web_search_exa/i).length).toBeGreaterThan(0);
	});
});
