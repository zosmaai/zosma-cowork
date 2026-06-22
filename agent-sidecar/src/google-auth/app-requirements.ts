/**
 * google-auth/app-requirements — which pi EXTENSIONS the Google Workspace app
 * needs for the user's selection, and whether they're installed (#281).
 *
 * "Installing the app" means the underlying pi extensions are present at pi's
 * canonical path so the brokered tokens actually power tools. We gate the
 * Connect/auth step on this: only offer consent once every extension required
 * by the selected products is installed (Calendar is built into the sidecar, so
 * it needs none). Detection + install follow the pi-native principle — read
 * pi's settings.json `packages` and install via the `pi` CLI; we never maintain
 * a parallel registry.
 */

import type { GoogleProduct, ScopePrefs } from "./scopes.js";

export interface AppExtension {
	/** npm package spec passed to `pi install` (and matched in settings.json). */
	pkg: string;
	/** human label for the UI. */
	label: string;
	/** products this extension powers. */
	products: GoogleProduct[];
}

/**
 * The Google Workspace app's external extensions. This list is now EMPTY —
 * every Google product (Calendar, Drive, Docs, Sheets, Slides AND Gmail) is
 * bundled in the sidecar as an owned, broker-aware extension, so none requires
 * an external `pi install`. The brokered tokens in ~/.pi/agent/google-workspace/
 * oauth.json power them all directly (one consent, no client secret on disk).
 *
 * The machinery below (requiredExtensions / appExtensionStatus) is retained so a
 * future external Google product can be re-added without a code change.
 */
export const GOOGLE_APP_EXTENSIONS: AppExtension[] = [];

/** Normalize a pi package source ("npm:@scope/x@1.2.3") to its bare name. */
export function pkgName(spec: string): string {
	const s = spec.startsWith("npm:") ? spec.slice(4) : spec;
	// lastIndexOf('@') > 0 → a trailing @version (index 0 is a scope's own '@').
	const at = s.lastIndexOf("@");
	return at > 0 ? s.slice(0, at) : s;
}

/** Extensions required for the (non-Off) products in this selection. */
export function requiredExtensions(prefs: ScopePrefs): AppExtension[] {
	return GOOGLE_APP_EXTENSIONS.filter((ext) =>
		ext.products.some((p) => (prefs[p] ?? "off") !== "off"),
	);
}

function isInstalled(pkg: string, installedSources: string[]): boolean {
	return installedSources.some((src) => pkgName(src) === pkg);
}

export interface AppExtensionStatus {
	requirements: { pkg: string; label: string; installed: boolean }[];
	/** packages required but not yet installed. */
	missing: string[];
	/** true when every required extension is installed (or none are required). */
	allInstalled: boolean;
}

/**
 * Resolve install status for a selection against pi's installed `packages`.
 * `installedSources` is pi settings.json's `packages` array (via
 * disk-extension-loader.readPiPackages).
 */
export function appExtensionStatus(
	prefs: ScopePrefs,
	installedSources: string[],
): AppExtensionStatus {
	const requirements = requiredExtensions(prefs).map((ext) => ({
		pkg: ext.pkg,
		label: ext.label,
		installed: isInstalled(ext.pkg, installedSources),
	}));
	const missing = requirements.filter((r) => !r.installed).map((r) => r.pkg);
	return { requirements, missing, allInstalled: missing.length === 0 };
}
