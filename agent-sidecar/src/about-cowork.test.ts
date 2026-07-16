/**
 * Tests for the Cowork self-knowledge module (issue #263).
 *
 * Cowork overrides pi's system prompt, which drops pi's built-in
 * "read the docs when asked about yourself" self-knowledge block. We restore
 * that via progressive disclosure: a shipped ABOUT doc written to disk on init
 * + a tiny pointer block in the system prompt. These tests pin the contract:
 *   - the doc is written to a stable path and is idempotent;
 *   - the doc covers core identity + where sessions live;
 *   - the pointer names the absolute path and stays small.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	ABOUT_COWORK_MD,
	ABOUT_DOC_FILENAME,
	coworkSelfKnowledgePointer,
	writeAboutDoc,
} from "./about-cowork.js";

describe("about-cowork", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "zosma-about-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	describe("writeAboutDoc", () => {
		it("writes ABOUT-ZOSMA-COWORK.md and returns its absolute path", () => {
			const p = writeAboutDoc(dir);
			expect(p).toBe(join(dir, ABOUT_DOC_FILENAME));
			expect(existsSync(p)).toBe(true);
			expect(readFileSync(p, "utf-8")).toBe(ABOUT_COWORK_MD);
		});

		it("creates the target directory if it does not exist", () => {
			const nested = join(dir, "cowork");
			const p = writeAboutDoc(nested);
			expect(existsSync(p)).toBe(true);
			expect(p).toBe(join(nested, ABOUT_DOC_FILENAME));
		});

		it("is idempotent — re-running overwrites without throwing", () => {
			const a = writeAboutDoc(dir);
			const b = writeAboutDoc(dir);
			expect(a).toBe(b);
			expect(readFileSync(b, "utf-8")).toBe(ABOUT_COWORK_MD);
		});
	});

	describe("ABOUT_COWORK_MD content", () => {
		it("keeps the Zosma identity", () => {
			expect(ABOUT_COWORK_MD).toMatch(/Zosma Cowork/);
		});

		it("documents where sessions live (pi-native store)", () => {
			expect(ABOUT_COWORK_MD).toMatch(/~\/\.pi\/agent\/sessions/);
		});
	});

	describe("coworkSelfKnowledgePointer", () => {
		const aboutPath = "/home/u/.zosmaai/cowork/ABOUT-ZOSMA-COWORK.md";

		it("names the absolute doc path", () => {
			expect(coworkSelfKnowledgePointer(aboutPath)).toContain(aboutPath);
		});

		it("instructs on-demand reading (progressive disclosure)", () => {
			expect(coworkSelfKnowledgePointer(aboutPath)).toMatch(/read/i);
		});

		it("stays small to avoid bloating initial context (<= 8 lines)", () => {
			const lines = coworkSelfKnowledgePointer(aboutPath).split("\n");
			expect(lines.length).toBeLessThanOrEqual(8);
		});
	});
});
