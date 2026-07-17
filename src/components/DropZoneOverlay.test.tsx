import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DropZoneOverlay } from "./DropZoneOverlay";

describe("DropZoneOverlay", () => {
	it("renders upload prompt when isVisible is true", () => {
		render(<DropZoneOverlay isVisible={true} />);
		expect(screen.getByText(/Drop files here/)).toBeInTheDocument();
		expect(screen.getByText(/Attach to your message/)).toBeInTheDocument();
	});

	it("does not render anything when isVisible is false", () => {
		const { container } = render(<DropZoneOverlay isVisible={false} />);
		expect(container.innerHTML).toBe("");
	});
});
