import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkHeader } from "./WorkHeader";

describe("WorkHeader", () => {
	it("shows task title, Work label, and accessible drawer controls", () => {
		const onOpenSidebar = vi.fn();
		const onOpenPanel = vi.fn();
		render(
			<WorkHeader
				title="Research GPU deployment"
				onOpenSidebar={onOpenSidebar}
				onOpenPanel={onOpenPanel}
			/>,
		);
		expect(screen.getByRole("heading", { name: "Research GPU deployment" })).toBeInTheDocument();
		expect(screen.getByText("Work")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Open session sidebar" }));
		fireEvent.click(screen.getByRole("button", { name: "Open Outputs and Sources" }));
		expect(onOpenSidebar).toHaveBeenCalled();
		expect(onOpenPanel).toHaveBeenCalled();
	});
});
