import { describe, expect, it } from "vitest";
import {
	GOOGLE_APP_EXTENSIONS,
	appExtensionStatus,
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
	it("Full access requires only the gmail extension (workspace is built-in)", () => {
		const pkgs = requiredExtensions(DEFAULT_PREFS).map((e) => e.pkg);
		expect(pkgs).toContain("@e9n/pi-gmail");
		expect(pkgs).not.toContain("pi-google-workspace");
	});

	it("calendar-only requires NO extension (built-in)", () => {
		const pkgs = requiredExtensions({ ...off, calendar: "full" }).map((e) => e.pkg);
		expect(pkgs).toEqual([]);
	});

	it("gmail-only requires just the gmail extension", () => {
		const pkgs = requiredExtensions({ ...off, gmail: "read" }).map((e) => e.pkg);
		expect(pkgs).toEqual(["@e9n/pi-gmail"]);
	});

	it("drive/docs/sheets/slides require NO extension (built-in google-workspace)", () => {
		expect(requiredExtensions({ ...off, sheets: "read" }).map((e) => e.pkg)).toEqual([]);
		expect(requiredExtensions({ ...off, drive: "read" }).map((e) => e.pkg)).toEqual([]);
	});
});

describe("appExtensionStatus", () => {
	it("flags missing gmail extension and gates allInstalled", () => {
		const s = appExtensionStatus(DEFAULT_PREFS, []);
		expect(s.requirements.find((r) => r.pkg === "@e9n/pi-gmail")?.installed).toBe(false);
		expect(s.missing).toEqual(["@e9n/pi-gmail"]);
		expect(s.allInstalled).toBe(false);
	});

	it("allInstalled true when the gmail package is present (workspace built-in)", () => {
		const s = appExtensionStatus(DEFAULT_PREFS, ["npm:@e9n/pi-gmail@0.2.1"]);
		expect(s.allInstalled).toBe(true);
		expect(s.missing).toEqual([]);
	});

	it("calendar-only is trivially satisfied (no extensions, allInstalled true)", () => {
		const s = appExtensionStatus({ ...off, calendar: "full" }, []);
		expect(s.allInstalled).toBe(true);
		expect(s.requirements).toEqual([]);
	});

	it("only Gmail remains an external package; everything else is built-in", () => {
		const covered = new Set(GOOGLE_APP_EXTENSIONS.flatMap((e) => e.products));
		// calendar + drive/docs/sheets/slides are built into the sidecar.
		expect(covered.has("gmail" as never)).toBe(true);
		for (const p of ["calendar", "drive", "docs", "sheets", "slides"]) {
			expect(covered.has(p as never)).toBe(false);
		}
	});
});
