import { describe, expect, it } from "vitest";
import { BRAND_LINKS } from "./brand-links";

describe("BRAND_LINKS", () => {
	it("exposes the community Discord invite", () => {
		expect(BRAND_LINKS.discord).toBe("https://discord.gg/c5vadsv9");
	});

	it("points new-issue at the GitHub issue template chooser", () => {
		expect(BRAND_LINKS.newIssue).toBe(
			"https://github.com/zosmaai/zosma-cowork/issues/new/choose",
		);
	});

	it("every link is an absolute https URL", () => {
		for (const url of Object.values(BRAND_LINKS)) {
			expect(url).toMatch(/^https:\/\//);
		}
	});
});
