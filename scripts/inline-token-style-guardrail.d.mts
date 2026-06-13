/** Type declarations for the inline token-color style guardrail (issue #272). */

/** Absolute `file://` URL of the committed baseline JSON. */
export const BASELINE_PATH: URL;

/** Count inline `hsl(var(--token))` color style references in a source string. */
export function countTokenColorStyles(source: string): number;

/** Result of scanning the `src/` tree for inline token-color styles. */
export interface ScanResult {
	total: number;
	files: Record<string, number>;
}

/** Scan the repository `src/` tree for inline token-color styles. */
export function scanRepo(): ScanResult;
