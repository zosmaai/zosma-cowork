import type { UseAppUpdate } from "@/hooks/useAppUpdate";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UpdateBanner } from "./UpdateBanner";

function makeUpdate(overrides: Partial<UseAppUpdate> = {}): UseAppUpdate {
	return {
		status: "idle",
		info: null,
		progress: 0,
		policy: null,
		error: null,
		checkNow: vi.fn(async () => {}),
		installAndRestart: vi.fn(async () => {}),
		dismiss: vi.fn(),
		...overrides,
	};
}

describe("UpdateBanner", () => {
	it("renders nothing when no update is available", () => {
		const { container } = render(<UpdateBanner update={makeUpdate({ status: "idle" })} />);
		expect(container).toBeEmptyDOMElement();
	});

	it("shows the available version with an install action", () => {
		const update = makeUpdate({
			status: "available",
			info: { version: "1.2.3", currentVersion: "1.0.0", notes: "notes" },
		});
		render(<UpdateBanner update={update} />);
		expect(screen.getByText(/1\.2\.3/)).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: /install & restart/i }));
		expect(update.installAndRestart).toHaveBeenCalledTimes(1);
	});

	it("can be dismissed", () => {
		const update = makeUpdate({
			status: "available",
			info: { version: "1.2.3", currentVersion: "1.0.0" },
		});
		render(<UpdateBanner update={update} />);
		fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
		expect(update.dismiss).toHaveBeenCalledTimes(1);
	});

	it("shows a download progress percentage while downloading", () => {
		const update = makeUpdate({ status: "downloading", progress: 42 });
		render(<UpdateBanner update={update} />);
		expect(screen.getByText(/42%/)).toBeInTheDocument();
	});

	it("does not render for a managed-channel build (handled in Settings instead)", () => {
		const { container } = render(
			<UpdateBanner
				update={makeUpdate({
					status: "managed",
					info: { version: "1.2.3", currentVersion: "1.0.0" },
				})}
			/>,
		);
		expect(container).toBeEmptyDOMElement();
	});
});
