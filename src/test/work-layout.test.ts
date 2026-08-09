import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..", "..");
const css = readFileSync(resolve(root, "src/App.css"), "utf8");
const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");

describe("Work responsive layout contract", () => {
	it("uses a named content container and exact wide rail dimensions", () => {
		expect(css).toContain("container-name: work-session");
		expect(css).toContain("@container work-session (min-width: 1280px)");
		expect(css).toContain("304px");
	});

	it("caps the drawer and defines narrow overlay behavior", () => {
		expect(css).toContain("max-width: 320px");
		expect(css).toContain("@media (max-width: 767px)");
	});

	it("does not branch layout from JavaScript viewport APIs", () => {
		expect(app).not.toMatch(/innerWidth|matchMedia|ResizeObserver/);
	});

	it("removes transitions under reduced motion", () => {
		expect(css).toMatch(/prefers-reduced-motion[\s\S]*work-panel/);
	});
});
