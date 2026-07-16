import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SplashScreen } from "./SplashScreen";

describe("SplashScreen", () => {
	it("renders the Zosma Commercial CoWork branding and logo mark", () => {
		render(<SplashScreen />);
		expect(screen.getByText("Zosma Commercial CoWork")).toBeDefined();
		const logo = screen.getByAltText("Zosma Commercial CoWork") as HTMLImageElement;
		expect(logo).toBeDefined();
		expect(logo.getAttribute("src")).toContain("zosma-mark.png");
	});

	it("shows the default loading message", () => {
		render(<SplashScreen />);
		expect(screen.getByText("Starting up…")).toBeDefined();
	});

	it("shows a custom message when provided", () => {
		render(<SplashScreen message="Booting the engine…" />);
		expect(screen.getByText("Booting the engine…")).toBeDefined();
		expect(screen.queryByText("Starting up…")).toBeNull();
	});

	it("renders a spinner element", () => {
		const { container } = render(<SplashScreen />);
		expect(container.querySelector(".animate-spin")).not.toBeNull();
	});
});
