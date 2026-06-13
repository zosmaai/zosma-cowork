import type { UseAppUpdate } from "@/hooks/useAppUpdate";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UpdateSettingsRow } from "./UpdateSettingsRow";

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

describe("UpdateSettingsRow", () => {
	it("offers a Check for updates button when idle and triggers a check", () => {
		const update = makeUpdate({ status: "idle" });
		render(<UpdateSettingsRow update={update} />);
		const btn = screen.getByRole("button", { name: /check for updates/i });
		fireEvent.click(btn);
		expect(update.checkNow).toHaveBeenCalledTimes(1);
	});

	it("shows a checking state", () => {
		render(<UpdateSettingsRow update={makeUpdate({ status: "checking" })} />);
		expect(screen.getByText(/checking/i)).toBeInTheDocument();
	});

	it("shows up to date", () => {
		render(<UpdateSettingsRow update={makeUpdate({ status: "uptodate" })} />);
		expect(screen.getByText(/up to date/i)).toBeInTheDocument();
	});

	it("offers Install & Restart when an update is available", () => {
		const update = makeUpdate({
			status: "available",
			info: { version: "2.0.0", currentVersion: "1.0.0" },
		});
		render(<UpdateSettingsRow update={update} />);
		expect(screen.getByText(/2\.0\.0/)).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: /install & restart/i }));
		expect(update.installAndRestart).toHaveBeenCalledTimes(1);
	});

	it("shows download progress", () => {
		render(<UpdateSettingsRow update={makeUpdate({ status: "downloading", progress: 73 })} />);
		expect(screen.getByText(/73%/)).toBeInTheDocument();
	});

	it("shows a managed-channel notice instead of a self-update button", () => {
		const update = makeUpdate({
			status: "managed",
			info: { version: "2.0.0", currentVersion: "1.0.0" },
			policy: { canSelfUpdate: false, managed: true, reason: "managed by your package manager" },
		});
		render(<UpdateSettingsRow update={update} />);
		expect(screen.getByText(/package manager/i)).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /install & restart/i })).not.toBeInTheDocument();
	});

	it("shows an error message", () => {
		render(<UpdateSettingsRow update={makeUpdate({ status: "error", error: "boom" })} />);
		expect(screen.getByText(/boom/)).toBeInTheDocument();
	});
});
