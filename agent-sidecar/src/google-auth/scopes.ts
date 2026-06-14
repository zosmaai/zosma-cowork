/**
 * google-auth/scopes — the Google Workspace capability matrix (#281).
 *
 * Replaces the flat union-scope map with a per-product, per-capability model so
 * the user can pick exactly what the Zosma (or their own) OAuth client may do.
 * Pure + filesystem-free so it is trivially unit-testable and shared by the
 * broker (consent scope list), the status probe (granted-vs-requested diff) and
 * the Cowork UI (Advanced scope picker + tier badges).
 *
 * Each product exposes capability LEVELS ordered Off → least → most privileged;
 * every non-Off level maps to the minimal Google scope(s) and carries a TIER
 * (recommended | sensitive | restricted) so the UI can warn honestly about the
 * unverified-app consent screen.
 *
 * Invariant: `resolveScopes(DEFAULT_PREFS)` === today's `UNION_SCOPES` (the
 * one-click "Full access" preset preserves the exact current behaviour).
 */

export type GoogleProduct = "drive" | "gmail" | "calendar" | "docs" | "sheets" | "slides";

export type ScopeTier = "recommended" | "sensitive" | "restricted";

export interface Capability {
	/** stable id stored in scope-prefs ("off" | "read" | "full" | …) */
	id: string;
	/** human label for the UI radio */
	label: string;
	/** minimal Google scope(s); empty for "off" */
	scopes: string[];
	/** consent-sensitivity tier; undefined for "off" */
	tier?: ScopeTier;
}

/** Always requested so we can resolve the connected account email. */
export const IDENTITY_SCOPES = ["openid", "email", "profile"] as const;

const S = (p: string): string => `https://www.googleapis.com/auth/${p}`;

const off: Capability = { id: "off", label: "Off", scopes: [] };

/**
 * Per-product capability levels. Order matters: Off first, then ascending
 * privilege (used by `grantedCapabilities` to pick the highest satisfied
 * level). Tiers follow the Google scope sensitivity classes cited in #281.
 */
export const CAPABILITY_MATRIX: Record<GoogleProduct, Capability[]> = {
	drive: [
		off,
		{ id: "file", label: "App files only", scopes: [S("drive.file")], tier: "recommended" },
		{ id: "read", label: "Read all", scopes: [S("drive.readonly")], tier: "restricted" },
		{ id: "full", label: "Full (read/write/delete)", scopes: [S("drive")], tier: "restricted" },
	],
	gmail: [
		off,
		{ id: "read", label: "Read", scopes: [S("gmail.readonly")], tier: "restricted" },
		{ id: "send", label: "Send", scopes: [S("gmail.send")], tier: "sensitive" },
		{ id: "compose", label: "Compose/drafts", scopes: [S("gmail.compose")], tier: "restricted" },
		{ id: "modify", label: "Labels/modify", scopes: [S("gmail.modify")], tier: "restricted" },
		{ id: "full", label: "Full mailbox", scopes: ["https://mail.google.com/"], tier: "restricted" },
	],
	calendar: [
		off,
		{ id: "read", label: "Read", scopes: [S("calendar.readonly")], tier: "sensitive" },
		{ id: "full", label: "Full (read/write)", scopes: [S("calendar")], tier: "sensitive" },
	],
	docs: [
		off,
		{ id: "read", label: "Read", scopes: [S("documents.readonly")], tier: "sensitive" },
		{ id: "full", label: "Full (read/write)", scopes: [S("documents")], tier: "sensitive" },
	],
	sheets: [
		off,
		{ id: "read", label: "Read", scopes: [S("spreadsheets.readonly")], tier: "sensitive" },
		{ id: "full", label: "Full (read/write)", scopes: [S("spreadsheets")], tier: "sensitive" },
	],
	slides: [
		off,
		{ id: "read", label: "Read", scopes: [S("presentations.readonly")], tier: "sensitive" },
		{ id: "full", label: "Full (read/write)", scopes: [S("presentations")], tier: "sensitive" },
	],
};

export const PRODUCTS = Object.keys(CAPABILITY_MATRIX) as GoogleProduct[];

/** product → selected capability id. */
export type ScopePrefs = Record<GoogleProduct, string>;

/**
 * The one-click "Full access" preset. Deliberately maps Gmail to `modify`
 * (NOT the full-mailbox `https://mail.google.com/` scope) so it equals today's
 * `UNION_SCOPES` exactly — connecting with the default never broadens what the
 * current app already requests. Full-mailbox is opt-in via Advanced.
 */
export const DEFAULT_PREFS: ScopePrefs = {
	drive: "full",
	gmail: "modify",
	calendar: "full",
	docs: "full",
	sheets: "full",
	slides: "full",
};

function capability(product: GoogleProduct, id: string): Capability | undefined {
	return CAPABILITY_MATRIX[product].find((c) => c.id === id);
}

/** All capability levels for a product (UI helper). */
export function capabilitiesFor(product: GoogleProduct): Capability[] {
	return CAPABILITY_MATRIX[product];
}

/**
 * Resolve the consent scope list from a selection: identity scopes + each
 * selected product's capability scope(s). Deduped; never includes Off/empties.
 * Unknown capability ids fall back to Off (safe).
 */
export function resolveScopes(prefs: ScopePrefs): string[] {
	const out = new Set<string>(IDENTITY_SCOPES);
	for (const product of PRODUCTS) {
		const cap = capability(product, prefs[product] ?? "off");
		for (const s of cap?.scopes ?? []) if (s) out.add(s);
	}
	return [...out];
}

const TIER_RANK: Record<ScopeTier, number> = { recommended: 0, sensitive: 1, restricted: 2 };

/** Most severe tier among the selected (non-Off) products, or null if none. */
export function tierOf(prefs: ScopePrefs): ScopeTier | null {
	let worst: ScopeTier | null = null;
	for (const product of PRODUCTS) {
		const cap = capability(product, prefs[product] ?? "off");
		if (!cap?.tier) continue;
		if (worst === null || TIER_RANK[cap.tier] > TIER_RANK[worst]) worst = cap.tier;
	}
	return worst;
}

/**
 * Map a granted scope string (space-separated, as Google returns it) back to
 * the highest capability level each product actually got. Drives the
 * granted-vs-requested status UI and tool-availability gating. A product is
 * granted a level only when ALL of that level's scopes are present; we scan
 * from most→least privileged and take the first satisfied level (else "off").
 */
export function grantedCapabilities(scopeStr: string): Record<GoogleProduct, string> {
	const granted = new Set(scopeStr.split(/\s+/).filter(Boolean));
	const out = {} as Record<GoogleProduct, string>;
	for (const product of PRODUCTS) {
		const levels = CAPABILITY_MATRIX[product];
		let chosen = "off";
		// iterate most→least privileged (skip Off at index 0)
		for (let i = levels.length - 1; i >= 1; i--) {
			const lvl = levels[i];
			if (lvl.scopes.every((s) => granted.has(s))) {
				chosen = lvl.id;
				break;
			}
		}
		out[product] = chosen;
	}
	return out;
}
