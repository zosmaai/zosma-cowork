import { describe, expect, it, test } from "vitest";
import { type ArtifactType, detectArtifactType, extractFilePaths, parentDir } from "./artifacts";

// ─── extractFilePaths ───────────────────────────────────────────────

describe("extractFilePaths", () => {
	it("extracts file path from 'Written to ...' result", () => {
		const result = "Written to /home/user/project/index.html (1234 bytes)";
		expect(extractFilePaths(result)).toEqual(["/home/user/project/index.html"]);
	});

	it("extracts file path from 'Written N lines to ...' result", () => {
		const result = "Written 42 lines to src/App.tsx (1234 bytes)";
		expect(extractFilePaths(result)).toContain("src/App.tsx");
	});

	it("returns [] when no file path found", () => {
		expect(extractFilePaths("Just some text output without file paths")).toEqual([]);
	});

	it("extracts file paths from diff headers (--- a/...)", () => {
		const result = `--- a/src/App.tsx
+++ b/src/App.tsx
@@ -1,5 +1,6 @@
-const x = 1;
+const x = 2;`;
		const paths = extractFilePaths(result);
		expect(paths).toContain("src/App.tsx");
	});

	it("extracts file paths from diff headers (+++ b/...)", () => {
		const result = `--- a/src/utils.ts
+++ b/src/utils.ts`;
		const paths = extractFilePaths(result);
		expect(paths).toContain("src/utils.ts");
	});

	it("returns empty array for empty input", () => {
		expect(extractFilePaths("")).toEqual([]);
	});

	it("deduplicates repeated paths", () => {
		const result = `Written to /tmp/file.html (100 bytes)
Written to /tmp/file.html (100 bytes)`;
		expect(extractFilePaths(result)).toEqual(["/tmp/file.html"]);
	});

	it("extracts path with spaces", () => {
		const result = "Written to /home/user/my project/file.html (500 bytes)";
		expect(extractFilePaths(result)).toEqual(["/home/user/my project/file.html"]);
	});
});

// ─── detectArtifactType ─────────────────────────────────────────────

describe("detectArtifactType", () => {
	const testCases: [string, ArtifactType][] = [
		["index.html", "html"],
		["page.HTML", "html"],
		["index.htm", "html"],
		["logo.svg", "svg"],
		["image.png", "image"],
		["photo.jpg", "image"],
		["photo.JPEG", "image"],
		["animation.gif", "image"],
		["file.webp", "image"],
		["icon.ico", "image"],
		["image.bmp", "image"],
		["script.ts", "code"],
		["component.tsx", "code"],
		["styles.css", "code"],
		["data.json", "code"],
		["readme.md", "code"],
		["Dockerfile", "code"],
		["main.rs", "code"],
		[".env", "code"],
		[".gitignore", "code"],
		["noext", "unknown"],
		["file", "unknown"],
	];

	it.each(testCases)("detects %s as %s", (path, expected) => {
		expect(detectArtifactType(path)).toBe(expected);
	});
});

// ─── parentDir ──────────────────────────────────────────────────────

describe("parentDir", () => {
	it("extracts dir from file path", () => {
		expect(parentDir("/home/user/project/index.html")).toBe("/home/user/project");
	});

	it("handles relative paths", () => {
		expect(parentDir("src/components/App.tsx")).toBe("src/components");
	});

	it("returns same path for root-level file", () => {
		expect(parentDir("file.txt")).toBe("file.txt");
	});

	// Windows paths are normalized to forward slashes for Tauri compatibility
	test("normalizes Windows backslashes to forward slashes", () => {
		expect(parentDir("C:\\Users\\arjun\\file.txt")).toBe("C:/Users/arjun");
	});
});
