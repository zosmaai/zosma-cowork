import { describe, expect, it } from "vitest";
import { UNION_SCOPES } from "./broker.js";
import {
	CAPABILITY_MATRIX,
	DEFAULT_PREFS,
	type GoogleProduct,
	grantedCapabilities,
	IDENTITY_SCOPES,
	resolveScopes,
	type ScopePrefs,
	tierOf,
} from "./scopes.js";

const PRODUCTS: GoogleProduct[] = ["drive", "gmail", "calendar", "docs", "sheets", "slides"];

describe("capability matrix", () => {
	it("exposes every product with an explicit Off capability first", () => {
		for (const p of PRODUCTS) {
			const caps = CAPABILITY_MATRIX[p];
			expect(caps.length).toBeGreaterThan(1);
			expect(caps[0].id).toBe("off");
			expect(caps[0].scopes).toEqual([]);
		}
	});

	it("tags non-off capabilities with a tier", () => {
		for (const p of PRODUCTS) {
			for (const cap of CAPABILITY_MATRIX[p]) {
				if (cap.id === "off") continue;
				expect(cap.scopes.length).toBeGreaterThan(0);
				expect(["recommended", "sensitive", "restricted"]).toContain(cap.tier);
			}
		}
	});
});

describe("resolveScopes", () => {
	it("always includes identity scopes", () => {
		const offPrefs = Object.fromEntries(PRODUCTS.map((p) => [p, "off"])) as ScopePrefs;
		expect(resolveScopes(offPrefs).sort()).toEqual([...IDENTITY_SCOPES].sort());
	});

	it("DEFAULT_PREFS resolves to exactly today's UNION_SCOPES (no behaviour change)", () => {
		expect(resolveScopes(DEFAULT_PREFS).sort()).toEqual([...UNION_SCOPES].sort());
	});

	it("maps a per-product selection to the minimal scope(s)", () => {
		const prefs: ScopePrefs = {
			drive: "file",
			gmail: "read",
			calendar: "read",
			docs: "off",
			sheets: "off",
			slides: "off",
		};
		const scopes = resolveScopes(prefs);
		expect(scopes).toContain("https://www.googleapis.com/auth/drive.file");
		expect(scopes).toContain("https://www.googleapis.com/auth/gmail.readonly");
		expect(scopes).toContain("https://www.googleapis.com/auth/calendar.readonly");
		expect(scopes).not.toContain("https://www.googleapis.com/auth/documents");
		expect(scopes).not.toContain("https://www.googleapis.com/auth/documents.readonly");
		// identity always present
		for (const s of IDENTITY_SCOPES) expect(scopes).toContain(s);
	});

	it("dedupes and never returns Off scopes", () => {
		const scopes = resolveScopes(DEFAULT_PREFS);
		expect(new Set(scopes).size).toBe(scopes.length);
		expect(scopes).not.toContain("");
	});
});

describe("tierOf", () => {
	it("returns the most severe tier among selected products", () => {
		// drive.full is restricted → highest
		expect(tierOf(DEFAULT_PREFS)).toBe("restricted");
		// only recommended selection
		const rec: ScopePrefs = {
			drive: "file",
			gmail: "off",
			calendar: "off",
			docs: "off",
			sheets: "off",
			slides: "off",
		};
		expect(tierOf(rec)).toBe("recommended");
		// nothing selected → null
		const none = Object.fromEntries(PRODUCTS.map((p) => [p, "off"])) as ScopePrefs;
		expect(tierOf(none)).toBeNull();
	});
});

describe("grantedCapabilities", () => {
	it("maps a granted scope string back to the per-product capability id", () => {
		const granted = grantedCapabilities(resolveScopes(DEFAULT_PREFS).join(" "));
		expect(granted.drive).toBe("full");
		expect(granted.gmail).toBe("modify");
		expect(granted.calendar).toBe("full");
	});

	it("reports Off for products with no granted scope", () => {
		const granted = grantedCapabilities(
			"openid email profile https://www.googleapis.com/auth/calendar.readonly",
		);
		expect(granted.calendar).toBe("read");
		expect(granted.gmail).toBe("off");
		expect(granted.drive).toBe("off");
	});
});
