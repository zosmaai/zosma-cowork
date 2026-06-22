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
	it("Full access requires NO external extension (everything built-in)", () => {
		expect(requiredExtensions(DEFAULT_PREFS)).toEqual([]);
	});

	it("calendar-only requires NO extension (built-in)", () => {
		expect(requiredExtensions({ ...off, calendar: "full" })).toEqual([]);
	});

	it("gmail-only requires NO extension (built-in)", () => {
		expect(requiredExtensions({ ...off, gmail: "read" })).toEqual([]);
	});

	it("drive/docs/sheets/slides require NO extension (built-in)", () => {
		expect(requiredExtensions({ ...off, sheets: "read" })).toEqual([]);
		expect(requiredExtensions({ ...off, drive: "read" })).toEqual([]);
	});
});

describe("appExtensionStatus", () => {
	it("every product is built-in: nothing required, allInstalled true", () => {
		const s = appExtensionStatus(DEFAULT_PREFS, []);
		expect(s.requirements).toEqual([]);
		expect(s.missing).toEqual([]);
		expect(s.allInstalled).toBe(true);
	});

	it("calendar-only is trivially satisfied (no extensions, allInstalled true)", () => {
		const s = appExtensionStatus({ ...off, calendar: "full" }, []);
		expect(s.allInstalled).toBe(true);
		expect(s.requirements).toEqual([]);
	});

	it("the external-extension registry is empty (all Google products are built-in)", () => {
		expect(GOOGLE_APP_EXTENSIONS).toEqual([]);
	});
});
