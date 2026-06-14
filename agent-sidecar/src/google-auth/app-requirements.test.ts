import { describe, expect, it } from "vitest";
import {
	appExtensionStatus,
	GOOGLE_APP_EXTENSIONS,
	pkgName,
	requiredExtensions,
} from "./app-requirements.js";
import { DEFAULT_PREFS, type ScopePrefs } from "./scopes.js";

const off: ScopePrefs = {
	drive: "off",
	gmail: "off",
	calendar: "off",
	docs: "off",
	sheets: "off",
	slides: "off",
};

describe("pkgName", () => {
	it("strips the npm: prefix and trailing @version (scoped + unscoped)", () => {
		expect(pkgName("npm:pi-google-workspace")).toBe("pi-google-workspace");
		expect(pkgName("npm:pi-google-workspace@1.0.1")).toBe("pi-google-workspace");
		expect(pkgName("npm:@e9n/pi-gmail")).toBe("@e9n/pi-gmail");
		expect(pkgName("npm:@e9n/pi-gmail@0.2.1")).toBe("@e9n/pi-gmail");
		expect(pkgName("../../local/pkg")).toBe("../../local/pkg");
	});
});

describe("requiredExtensions", () => {
	it("Full access requires both gmail + workspace extensions", () => {
		const pkgs = requiredExtensions(DEFAULT_PREFS).map((e) => e.pkg);
		expect(pkgs).toContain("@e9n/pi-gmail");
		expect(pkgs).toContain("pi-google-workspace");
	});

	it("calendar-only requires NO extension (built-in)", () => {
		const pkgs = requiredExtensions({ ...off, calendar: "full" }).map((e) => e.pkg);
		expect(pkgs).toEqual([]);
	});

	it("gmail-only requires just the gmail extension", () => {
		const pkgs = requiredExtensions({ ...off, gmail: "read" }).map((e) => e.pkg);
		expect(pkgs).toEqual(["@e9n/pi-gmail"]);
	});

	it("any of drive/docs/sheets/slides requires the workspace extension", () => {
		expect(requiredExtensions({ ...off, sheets: "read" }).map((e) => e.pkg)).toEqual([
			"pi-google-workspace",
		]);
	});
});

describe("appExtensionStatus", () => {
	it("flags missing extensions and gates allInstalled", () => {
		const s = appExtensionStatus(DEFAULT_PREFS, ["npm:@e9n/pi-gmail@0.2.1"]);
		expect(s.requirements.find((r) => r.pkg === "@e9n/pi-gmail")?.installed).toBe(true);
		expect(s.requirements.find((r) => r.pkg === "pi-google-workspace")?.installed).toBe(false);
		expect(s.missing).toEqual(["pi-google-workspace"]);
		expect(s.allInstalled).toBe(false);
	});

	it("allInstalled true when every required package is present", () => {
		const s = appExtensionStatus(DEFAULT_PREFS, [
			"npm:@e9n/pi-gmail",
			"npm:pi-google-workspace@1.0.1",
		]);
		expect(s.allInstalled).toBe(true);
		expect(s.missing).toEqual([]);
	});

	it("calendar-only is trivially satisfied (no extensions, allInstalled true)", () => {
		const s = appExtensionStatus({ ...off, calendar: "full" }, []);
		expect(s.allInstalled).toBe(true);
		expect(s.requirements).toEqual([]);
	});

	it("the registry lists every Google product across its extensions", () => {
		const covered = new Set(GOOGLE_APP_EXTENSIONS.flatMap((e) => e.products));
		// calendar is intentionally NOT in any extension (built-in)
		for (const p of ["gmail", "drive", "docs", "sheets", "slides"]) {
			expect(covered.has(p as never)).toBe(true);
		}
		expect(covered.has("calendar" as never)).toBe(false);
	});
});
