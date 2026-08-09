export type ArtifactType = "html" | "svg" | "image" | "code" | "unknown";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico"]);

// Well-known filenames without a dot extension that should be treated as code
const KNOWN_CODE_FILES = new Set([
	"Dockerfile",
	"Makefile",
	"Gemfile",
	"Rakefile",
	"Justfile",
	"Procfile",
]);

/**
 * Extract file paths from a tool call result string.
 * - Matches "Written to <path>" and "Written N lines to <path>"
 * - Matches diff headers ("--- a/<path>" / "+++ b/<path>")
 */
export function extractFilePaths(result: string): string[] {
	const paths: string[] = [];

	// Match "Written to <path>" or "Written N lines to <path>"
	// Capture path up to optional parenthesized metadata
	const writtenRegex = /Written\s+(?:\d+\s+lines\s+)?to\s+(.+?)(?:\s+\(|$)/g;
	let writtenMatch: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: regex exec loop pattern
	while ((writtenMatch = writtenRegex.exec(result)) !== null) {
		const path = writtenMatch[1].trim();
		if (!paths.includes(path)) {
			paths.push(path);
		}
	}

	// Match diff headers: "--- a/<path>" and "+++ b/<path>"
	const diffRegex = /^(?:---\s+a\/|\+\+\+\s+b\/)(.+)$/gm;
	let diffMatch: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: regex exec loop pattern
	while ((diffMatch = diffRegex.exec(result)) !== null) {
		const path = diffMatch[1].trim();
		if (!paths.includes(path)) {
			paths.push(path);
		}
	}

	return paths;
}

/**
 * Detect the artifact type from a file path based on extension.
 */
export function detectArtifactType(filePath: string): ArtifactType {
	// Check known code filenames (no extension but still code)
	const filename = filePath.split("/").pop() || filePath;
	if (KNOWN_CODE_FILES.has(filename)) return "code";

	const parts = filePath.split(".");
	// If there's no dot in the filename, there's no extension
	if (parts.length <= 1) return "unknown";
	const ext = parts.pop()?.toLowerCase() || "";

	if (ext === "html" || ext === "htm") return "html";
	if (ext === "svg") return "svg";
	if (IMAGE_EXTENSIONS.has(ext)) return "image";
	if (ext) return "code";
	return "unknown";
}

export function sanitizeSvg(content: string): string | null {
	const document = new DOMParser().parseFromString(content, "image/svg+xml");
	if (document.querySelector("parsererror") || document.documentElement.localName !== "svg") {
		return null;
	}

	for (const element of document.querySelectorAll("script, foreignObject, iframe, style")) {
		element.remove();
	}
	for (const element of document.querySelectorAll("*")) {
		for (const attribute of [...element.attributes]) {
			const name = attribute.name.toLowerCase();
			const value = attribute.value.trim();
			if (
				name.startsWith("on") ||
				(name === "style" && /url\s*\(/i.test(value)) ||
				((name === "href" || name === "xlink:href") &&
					!value.startsWith("#") &&
					!value.startsWith("data:image/"))
			) {
				element.removeAttribute(attribute.name);
			}
		}
	}
	return new XMLSerializer().serializeToString(document.documentElement);
}

export function sandboxedHtml(content: string): string {
	const document = new DOMParser().parseFromString(content, "text/html");
	for (const element of document.querySelectorAll("script, base, iframe, object, embed, form")) {
		element.remove();
	}
	for (const meta of document.querySelectorAll("meta[http-equiv]")) {
		if (meta.getAttribute("http-equiv")?.toLowerCase() === "refresh") meta.remove();
	}
	for (const element of document.querySelectorAll("a[href], area[href]")) {
		element.removeAttribute("href");
	}
	for (const element of document.querySelectorAll("[src]")) {
		const src = element.getAttribute("src")?.trim() ?? "";
		if (!src.startsWith("data:image/")) element.removeAttribute("src");
	}
	for (const element of document.querySelectorAll("*")) {
		for (const attribute of [...element.attributes]) {
			if (attribute.name.toLowerCase().startsWith("on")) {
				element.removeAttribute(attribute.name);
			}
		}
	}
	const policy =
		"default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; navigate-to 'none';";
	return `<meta http-equiv="Content-Security-Policy" content="${policy}">${document.documentElement.outerHTML}`;
}

/**
 * Extract directory path from a file path for "Open folder" action.
 */
export function parentDir(filePath: string): string {
	// Normalize Windows backslashes to forward slashes for consistency
	const normalized = filePath.replace(/\\/g, "/");
	const lastSlash = normalized.lastIndexOf("/");
	if (lastSlash === -1) return normalized;
	return normalized.slice(0, lastSlash);
}
