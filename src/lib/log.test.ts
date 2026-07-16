import { afterEach, describe, expect, it, vi } from "vitest";
import { log } from "./log";

afterEach(() => vi.restoreAllMocks());

describe("frontend log wrapper", () => {
	it("warn delegates to console.warn (never gated)", () => {
		const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
		log.warn("[scope] problem", 42);
		expect(spy).toHaveBeenCalledWith("[scope] problem", 42);
	});

	it("error delegates to console.error (never gated)", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const err = new Error("boom");
		log.error("[scope] failed:", err);
		expect(spy).toHaveBeenCalledWith("[scope] failed:", err);
	});

	it("debug is callable and matches the DEV gate", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		log.debug("[scope] trace");
		// In test/dev builds import.meta.env.DEV is true, so debug fires;
		// in production it is a no-op. Assert it obeys the gate either way.
		if (import.meta.env.DEV) {
			expect(spy).toHaveBeenCalledWith("[scope] trace");
		} else {
			expect(spy).not.toHaveBeenCalled();
		}
	});
});
