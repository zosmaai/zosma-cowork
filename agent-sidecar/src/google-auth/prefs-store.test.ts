import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	clearGooglePrefs,
	type CoworkGooglePaths,
	defaultCoworkGooglePaths,
	readByoClient,
	readScopePrefs,
	writeByoClient,
	writeScopePrefs,
} from "./prefs-store.js";
import { DEFAULT_PREFS, type ScopePrefs } from "./scopes.js";

let zosmaDir: string;
let paths: CoworkGooglePaths;

beforeEach(() => {
	zosmaDir = mkdtempSync(join(tmpdir(), "cowork-google-"));
	paths = defaultCoworkGooglePaths(zosmaDir);
});

afterEach(() => {
	rmSync(zosmaDir, { recursive: true, force: true });
});

describe("defaultCoworkGooglePaths", () => {
	it("nests both files under cowork/google-workspace (never a pi dir)", () => {
		expect(paths.scopePrefs).toContain(join("cowork", "google-workspace", "scope-prefs.json"));
		expect(paths.byoClient).toContain(join("cowork", "google-workspace", "byo-client.json"));
		expect(paths.scopePrefs).not.toContain(".pi");
	});
});

describe("scope prefs", () => {
	it("returns DEFAULT_PREFS when no file exists", () => {
		expect(readScopePrefs(paths)).toEqual(DEFAULT_PREFS);
	});

	it("round-trips a custom selection at 0600", () => {
		const prefs: ScopePrefs = {
			drive: "file",
			gmail: "read",
			calendar: "off",
			docs: "off",
			sheets: "off",
			slides: "off",
		};
		writeScopePrefs(paths, prefs);
		expect(readScopePrefs(paths)).toEqual(prefs);
		expect(statSync(paths.scopePrefs).mode & 0o777).toBe(0o600);
	});

	it("fills missing products with Off and ignores unknown keys", () => {
		writeScopePrefs(paths, { drive: "full", bogus: "x" } as unknown as ScopePrefs);
		const got = readScopePrefs(paths);
		expect(got.drive).toBe("full");
		expect(got.gmail).toBe("off");
		expect((got as Record<string, string>).bogus).toBeUndefined();
	});
});

describe("BYO client", () => {
	it("is null when unset", () => {
		expect(readByoClient(paths)).toBeNull();
	});

	it("round-trips id + secret at 0600", () => {
		writeByoClient(paths, { clientId: "my-id", clientSecret: "my-secret" });
		expect(readByoClient(paths)).toEqual({ clientId: "my-id", clientSecret: "my-secret" });
		expect(statSync(paths.byoClient).mode & 0o777).toBe(0o600);
	});

	it("rejects an empty client id", () => {
		expect(() => writeByoClient(paths, { clientId: "", clientSecret: "s" })).toThrow();
	});
});

describe("clearGooglePrefs", () => {
	it("removes both files and reports what it deleted", () => {
		writeScopePrefs(paths, DEFAULT_PREFS);
		writeByoClient(paths, { clientId: "id", clientSecret: "s" });
		const removed = clearGooglePrefs(paths);
		expect(existsSync(paths.scopePrefs)).toBe(false);
		expect(existsSync(paths.byoClient)).toBe(false);
		expect(removed).toContain(paths.scopePrefs);
		expect(removed).toContain(paths.byoClient);
	});

	it("is a no-op when nothing is stored", () => {
		expect(clearGooglePrefs(paths)).toEqual([]);
	});
});
