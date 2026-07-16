import { afterEach, describe, expect, it, vi } from "vitest";
import { activeLevel, logAt } from "./protocol.js";

const orig = process.env.SIDECAR_LOG_LEVEL;
afterEach(() => {
	if (orig === undefined) delete process.env.SIDECAR_LOG_LEVEL;
	else process.env.SIDECAR_LOG_LEVEL = orig;
	vi.restoreAllMocks();
});

describe("activeLevel", () => {
	it("defaults to info (2) when unset", () => {
		delete process.env.SIDECAR_LOG_LEVEL;
		expect(activeLevel()).toBe(2);
	});
	it("defaults to info on unknown value", () => {
		expect(activeLevel("bogus")).toBe(2);
	});
	it("maps known levels", () => {
		expect(activeLevel("error")).toBe(0);
		expect(activeLevel("warn")).toBe(1);
		expect(activeLevel("info")).toBe(2);
		expect(activeLevel("debug")).toBe(3);
	});
});

describe("logAt", () => {
	it("emits when level <= active threshold", () => {
		process.env.SIDECAR_LOG_LEVEL = "info";
		const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
		logAt("warn", "hello");
		expect(spy).toHaveBeenCalledWith("[sidecar:warn] hello\n");
	});
	it("suppresses when level > active threshold", () => {
		process.env.SIDECAR_LOG_LEVEL = "warn";
		const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
		logAt("info", "quiet");
		logAt("debug", "quieter");
		expect(spy).not.toHaveBeenCalled();
	});
	it("prefixes with the level tag", () => {
		process.env.SIDECAR_LOG_LEVEL = "debug";
		const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
		logAt("debug", "a", "b");
		expect(spy).toHaveBeenCalledWith("[sidecar:debug] a b\n");
	});
});
