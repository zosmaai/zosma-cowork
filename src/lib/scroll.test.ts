import { describe, expect, it } from "vitest";
import { isNearBottom } from "./scroll";

describe("isNearBottom — stick-to-bottom decision", () => {
	it("returns true when scrolled exactly to the bottom", () => {
		expect(isNearBottom({ scrollTop: 800, scrollHeight: 1000, clientHeight: 200 })).toBe(true);
	});

	it("returns true when within the default threshold of the bottom", () => {
		// distance from bottom = 1000 - 770 - 200 = 30 (<= 48 default)
		expect(isNearBottom({ scrollTop: 770, scrollHeight: 1000, clientHeight: 200 })).toBe(true);
	});

	it("returns false when the user has scrolled well up", () => {
		// distance from bottom = 1000 - 300 - 200 = 500
		expect(isNearBottom({ scrollTop: 300, scrollHeight: 1000, clientHeight: 200 })).toBe(false);
	});

	it("respects a custom threshold", () => {
		// distance = 1000 - 600 - 200 = 200
		expect(isNearBottom({ scrollTop: 600, scrollHeight: 1000, clientHeight: 200 }, 250)).toBe(true);
		expect(isNearBottom({ scrollTop: 600, scrollHeight: 1000, clientHeight: 200 }, 100)).toBe(
			false,
		);
	});

	it("returns true when content is shorter than the viewport (nothing to scroll)", () => {
		expect(isNearBottom({ scrollTop: 0, scrollHeight: 150, clientHeight: 200 })).toBe(true);
	});
});
