import { render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn(async () => null) }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(async () => ({ platform: "macos", isAppImage: false, channel: "direct" })),
}));

import { UpdateProvider, useUpdate } from "./UpdateProvider";

describe("UpdateProvider", () => {
	it("throws when useUpdate is used outside a provider", () => {
		expect(() => renderHook(() => useUpdate())).toThrow(/UpdateProvider/);
	});

	it("provides an update object to consumers", () => {
		function Consumer() {
			const update = useUpdate();
			return <div>status:{update.status}</div>;
		}
		const wrapper = ({ children }: { children: ReactNode }) => (
			<UpdateProvider enabled={false}>{children}</UpdateProvider>
		);
		render(<Consumer />, { wrapper });
		expect(screen.getByText(/status:idle/)).toBeInTheDocument();
	});
});
