#!/usr/bin/env node
/**
 * Inline token-color style guardrail (issue #272).
 *
 * Our design tokens are mapped to Tailwind utilities in `src/App.css` via
 * `@theme` (e.g. `bg-card`, `text-foreground`, `border-border`). Despite that,
 * many components still apply the *same* colors as inline style strings such as
 * `style={{ background: "hsl(var(--card))" }}`. Inline styles can't be deduped
 * by Tailwind, bypass `cn()`/`tailwind-merge`, and lose hover/focus/dark
 * variants.
 *
 * This script counts those inline `hsl(var(--token))` references per file and
 * compares them against a committed baseline. The baseline only moves *down*:
 *  - CI fails if any file exceeds its baseline (a regression), and
 *  - CI fails if the baseline is stale (a file dropped below its baseline but
 *    the baseline wasn't regenerated) — nudging contributors to ratchet it.
 *
 * Usage:
 *   node scripts/inline-token-style-guardrail.mjs            # check (CI)
 *   node scripts/inline-token-style-guardrail.mjs --update   # regenerate baseline
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const SRC_DIR = join(REPO_ROOT, "src");

/** Absolute file:// URL of the committed baseline JSON. */
export const BASELINE_PATH = pathToFileURL(
	join(__dirname, "inline-token-style-baseline.json"),
);

/**
 * Matches an inline color reference to a design token, e.g.
 *   hsl(var(--card))
 *   hsl(var(--tool-running-border) / 0.45)
 * In `.tsx` sources these only ever appear inside inline `style` strings —
 * real CSS lives in `.css` files — so a raw occurrence count is a faithful
 * proxy for "inline token-color style".
 */
const TOKEN_COLOR_RE = /hsl\(\s*var\(\s*--[a-z0-9-]+/gi;

/** Count inline token-color style references in a source string. */
export function countTokenColorStyles(source) {
	const matches = source.match(TOKEN_COLOR_RE);
	return matches ? matches.length : 0;
}

/** Recursively collect `.tsx` source files (excluding tests). */
function collectTsxFiles(dir, acc = []) {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const st = statSync(full);
		if (st.isDirectory()) {
			if (entry === "node_modules" || entry === "test") continue;
			collectTsxFiles(full, acc);
		} else if (entry.endsWith(".tsx") && !/\.(test|spec)\.tsx$/.test(entry)) {
			acc.push(full);
		}
	}
	return acc;
}

/**
 * Scan the repository `src/` tree.
 * @returns {{ total: number, files: Record<string, number> }}
 *   `files` is keyed by repo-relative POSIX path and only includes files with
 *   at least one occurrence.
 */
export function scanRepo() {
	const files = {};
	let total = 0;
	for (const abs of collectTsxFiles(SRC_DIR)) {
		const count = countTokenColorStyles(readFileSync(abs, "utf8"));
		if (count > 0) {
			const rel = relative(REPO_ROOT, abs).split("\\").join("/");
			files[rel] = count;
			total += count;
		}
	}
	// Stable, sorted key order for deterministic baseline diffs.
	const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
	return { total, files: sorted };
}

function main() {
	const update = process.argv.includes("--update");
	const baselineFile = fileURLToPath(BASELINE_PATH);
	const result = scanRepo();

	if (update) {
		writeFileSync(baselineFile, `${JSON.stringify(result, null, "\t")}\n`);
		console.log(`✓ Baseline updated: ${result.total} inline token-color styles across ${Object.keys(result.files).length} files.`);
		return;
	}

	const baseline = JSON.parse(readFileSync(baselineFile, "utf8"));
	const regressions = [];
	for (const [file, count] of Object.entries(result.files)) {
		const allowed = baseline.files[file] ?? 0;
		if (count > allowed) regressions.push(`  ${file}: ${count} (baseline ${allowed})`);
	}
	const stale = [];
	for (const [file, allowed] of Object.entries(baseline.files)) {
		const current = result.files[file] ?? 0;
		if (allowed > current) stale.push(`  ${file}: baseline ${allowed} > current ${current}`);
	}

	if (regressions.length > 0) {
		console.error(
			`✗ New inline hsl(var(--token)) color styles detected. Use the Tailwind utility instead (bg-*, text-*, border-*).\n${regressions.join("\n")}`,
		);
		process.exit(1);
	}
	if (stale.length > 0) {
		console.error(
			`✗ Baseline is stale — you reduced inline token styles but didn't ratchet the baseline.\n  Run: pnpm run lint:styles -- --update\n${stale.join("\n")}`,
		);
		process.exit(1);
	}
	console.log(`✓ Inline token-color styles within baseline (${result.total}).`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	main();
}
