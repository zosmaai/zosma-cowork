import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	BASELINE_PATH,
	countTokenColorStyles,
	scanRepo,
} from "../../scripts/inline-token-style-guardrail.mjs";

/**
 * Guardrail for issue #272: inline `hsl(var(--token))` color styles should be
 * migrated to the Tailwind utilities mapped in `@theme`. This test pins a
 * ratcheting baseline so the count can only ever go *down*.
 */
describe("countTokenColorStyles", () => {
	it("detects an inline hsl(var(--token)) style string", () => {
		const src = `<div style={{ background: "hsl(var(--card))" }} />`;
		expect(countTokenColorStyles(src)).toBe(1);
	});

	it("counts every token reference, including alpha variants", () => {
		const src = `
			<div style={{
				background: "hsl(var(--tool-running-bg))",
				color: "hsl(var(--tool-running-fg))",
				borderColor: "hsl(var(--tool-running-border) / 0.45)",
			}} />`;
		expect(countTokenColorStyles(src)).toBe(3);
	});

	it("ignores Tailwind utility class usage of tokens", () => {
		const src = `<div className="bg-card text-foreground border-border" />`;
		expect(countTokenColorStyles(src)).toBe(0);
	});

	it("does not match plain text that merely mentions a token name", () => {
		const src = "// use the --card token via bg-card, never inline";
		expect(countTokenColorStyles(src)).toBe(0);
	});

	it("returns 0 for a file with no inline token colors", () => {
		const src = `export const x = 1;\nconst y = "hello world";`;
		expect(countTokenColorStyles(src)).toBe(0);
	});
});

describe("inline token-color style ratchet", () => {
	const baseline = JSON.parse(readFileSync(fileURLToPath(BASELINE_PATH), "utf8"));
	const result = scanRepo();

	it("has a committed baseline", () => {
		expect(typeof baseline.total).toBe("number");
		expect(baseline.files).toBeTypeOf("object");
	});

	it("never exceeds the committed total baseline", () => {
		expect(result.total).toBeLessThanOrEqual(baseline.total);
	});

	it("does not regress any individual file above its baseline", () => {
		const regressions: string[] = [];
		for (const [file, count] of Object.entries(result.files)) {
			const allowed = baseline.files[file] ?? 0;
			if ((count as number) > allowed) {
				regressions.push(`${file}: ${count} > baseline ${allowed}`);
			}
		}
		expect(regressions, `Inline token-color regressions:\n${regressions.join("\n")}`).toEqual([]);
	});

	it("baseline is not stale: no baseline entry exceeds current reality", () => {
		// Encourage updating the baseline downward after migrations.
		const stale: string[] = [];
		for (const [file, allowed] of Object.entries(baseline.files)) {
			const current = result.files[file] ?? 0;
			if ((allowed as number) > current) {
				stale.push(`${file}: baseline ${allowed} > current ${current}`);
			}
		}
		expect(
			stale,
			`Baseline is stale — run \`pnpm run lint:styles -- --update\`:\n${stale.join("\n")}`,
		).toEqual([]);
	});
});
