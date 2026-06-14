import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BRAND_LINKS } from "@/lib/brand-links";
import { About } from "./About";

// About reads the update context (Tauri IPC); stub to an idle no-op.
vi.mock("@/contexts/UpdateProvider", () => ({
	useUpdate: () => ({
		status: "idle",
		info: null,
		progress: 0,
		policy: null,
		error: null,
		checkNow: vi.fn(),
		installAndRestart: vi.fn(),
		dismiss: vi.fn(),
	}),
}));

function hrefs() {
	return Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href"));
}

describe("About page — get help & connect", () => {
	it("links to the community Discord", () => {
		render(<About />);
		expect(hrefs()).toContain(BRAND_LINKS.discord);
	});

	it("offers a way to report an issue / request a feature", () => {
		render(<About />);
		expect(hrefs()).toContain(BRAND_LINKS.newIssue);
		expect(screen.getByText("Report an issue")).toBeDefined();
	});

	it("links to the showcase gallery", () => {
		render(<About />);
		expect(hrefs()).toContain(BRAND_LINKS.gallery);
	});

	it("still surfaces the source repository", () => {
		render(<About />);
		expect(hrefs()).toContain(BRAND_LINKS.repo);
	});
});
