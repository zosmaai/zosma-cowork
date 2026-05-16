/**
 * Skill registry helpers — npm and skills.sh metadata fetching.
 */

export interface SkillResult {
	id: string;
	installCount: number;
	url: string;
	npmData?: NpmData | null;
}

export interface InstalledSkill {
	name: string;
	path: string;
	scope: "project" | "global";
	agents: string[];
}

export interface NpmData {
	name: string;
	version: string;
	description: string;
	published: string;
	author: string;
	license: string;
	keywords: string[];
	typeLabel: string;
	unpackedSize: number;
	deps: number;
	peerDeps: number;
	homepage: string;
	repo: string;
}

/** Extract a potential npm package name from a skill ID like "owner/repo@skill" or "package-name" */
function extractNpmName(id: string): string {
	// If there's an @, the part before @ is owner/repo, the part after is skill name
	// Try "skill-name" first (some are published as npm packages)
	const parts = id.split("@");
	if (parts.length >= 2) {
		const skillName = parts[parts.length - 1];
		// Some packages are just the skill name, some have the repo name prefix
		return skillName;
	}
	// Plain names like "pi-superpowers-plus" are likely npm packages
	return id.split("/").pop() || id;
}

/** Fetch npm packument data for a package name. Returns null if not found. */
export async function fetchNpmData(packageName: string): Promise<NpmData | null> {
	try {
		const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`, {
			signal: AbortSignal.timeout(5000),
		});
		if (!res.ok) return null;
		const data = await res.json();
		const versionTag = data["dist-tags"]?.latest;
		if (!versionTag) return null;
		const lv = data.versions?.[versionTag];
		if (!lv) return null;

		const author =
			typeof lv.author === "string"
				? lv.author
				: lv.author?.name || data.maintainers?.[0]?.name || "unknown";

		const keywords = data.keywords || [];
		const hasExtension = keywords.includes("pi-extension");
		const hasSkill = keywords.includes("pi-skill") || keywords.includes("pi-package");
		const typeLabel =
			hasExtension && hasSkill
				? "extension, skill"
				: hasExtension
					? "extension"
					: hasSkill
						? "skill"
						: "package";

		return {
			name: data.name,
			version: versionTag,
			description: data.description || "",
			published: data.time?.[versionTag] || "",
			author,
			license: data.license || "Unknown",
			keywords,
			typeLabel,
			unpackedSize: lv.dist?.unpackedSize || 0,
			deps: lv.dependencies ? Object.keys(lv.dependencies).length : 0,
			peerDeps: lv.peerDependencies ? Object.keys(lv.peerDependencies).length : 0,
			homepage: data.homepage || "",
			repo: data.repository?.url || "",
		};
	} catch {
		return null;
	}
}

/** Try to fetch npm data for a skill ID by trying multiple possible npm package names */
export async function fetchNpmDataForSkill(skillId: string): Promise<NpmData | null> {
	// Try the extracted npm name first
	const name = extractNpmName(skillId);
	const result = await fetchNpmData(name);
	if (result) return result;

	// Try the full ID as a package name (replace / and @ with -)
	const fullName = skillId.replace(/[/@]/g, "-");
	if (fullName !== name) {
		return fetchNpmData(fullName);
	}

	return null;
}

/** Format bytes to human-readable size */
export function formatSize(bytes: number): string {
	if (bytes === 0) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

/** Format a date string to a human-readable format */
export function formatDate(dateStr: string): string {
	if (!dateStr) return "Unknown";
	try {
		const d = new Date(dateStr);
		return d.toLocaleDateString("en-US", {
			year: "numeric",
			month: "short",
			day: "numeric",
		});
	} catch {
		return dateStr;
	}
}

/** Format install count */
export function formatInstallCount(count: number): string {
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
	return String(count);
}
