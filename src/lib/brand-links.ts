/**
 * Canonical Zosma Cowork outbound links.
 *
 * Centralized so the About page, feedback flows and anywhere else that
 * points users at the project share one source of truth. All of these are
 * external URLs and open in the system browser via the global
 * external-link handler (see `external-links.ts`).
 */
export const BRAND_LINKS = {
	/** Marketing site / landing page. */
	website: "https://zosma.ai",
	/** Public source repository. */
	repo: "https://github.com/zosmaai/zosma-cowork",
	/** All issues (search before filing). */
	issues: "https://github.com/zosmaai/zosma-cowork/issues",
	/** New issue with template picker (bug / feature). */
	newIssue: "https://github.com/zosmaai/zosma-cowork/issues/new/choose",
	/** Latest published release + changelog. */
	releases: "https://github.com/zosmaai/zosma-cowork/releases/latest",
	/** Community chat. */
	discord: "https://discord.gg/c5vadsv9",
	/** Showcase gallery of what Cowork can build. */
	gallery: "https://www.zosma.ai/zosma-cowork/gallery",
	/** The pi engine Cowork is built on. */
	pi: "https://github.com/earendil-works/pi-coding-agent",
} as const;

export type BrandLink = keyof typeof BRAND_LINKS;
