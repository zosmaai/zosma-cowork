import { runNpx } from "../../lib/npx";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "../../lib/file-access";
import { getProjectTrustStatus } from "../../lib/project-trust";
import {
  buildSkillUpdateArgs,
  checkSkillUpdates,
} from "../../lib/skill-updates";
import { loadSkillsWithInstallInfo } from "../../lib/skills-service";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type {
  SkillInstallInfo,
  SkillSearchResult,
  SkillUpdateResult,
  SkillsResponse,
} from "../../lib/api-types";
import type {
  SkillCheckInput,
  SkillCheckResponse,
  SkillInstallInput,
  SkillInstallResponse,
  SkillSearchInput,
  SkillSearchResponse,
  SkillUpdateInput,
  SkillUpdateResponse,
} from "./contracts";
import { BackendError } from "./errors";

const ANSI_RE = /\x1B\[[0-9;]*m/g;

// Enumerate installed skills for a project (cwd) through the transport-neutral
// pi-backend boundary (ZOS-82, slice 1). Reuses the loader-backed skills
// service, which reports project-trust status in the response — it does not
// deny, so no filesystem probe is required (parity with the models catalog).
export async function listSkillsFromServices(cwd?: string): Promise<SkillsResponse> {
  return loadSkillsWithInstallInfo(cwd ?? process.cwd());
}

// --- Slice 2: install / update / check / search (spawn + project-trust gated) ---

// Install a skill. Project installs are gated on the file-access roots and
// project-trust, matching the in-app /api/skills/install semantics; global
// installs (no trusted cwd needed) run without those checks.
export async function installSkillFromServices(
  input: SkillInstallInput,
): Promise<SkillInstallResponse> {
  const { package: pkg, scope, cwd } = input;
  if (!pkg?.trim()) throw new BackendError("invalid_request", "package required");

  const isGlobal = scope !== "project";
  if (!isGlobal) {
    if (!cwd) throw new BackendError("cwd_required", "cwd required for project install");
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      throw new BackendError("access_denied", "Access denied");
    }
    if (!getProjectTrustStatus(cwd, getAgentDir()).trusted) {
      throw new BackendError(
        "access_denied",
        "Project resources must be trusted before installing project skills",
      );
    }
  }

  const args = ["skills", "add", pkg.trim(), "-y", "--agent", "pi"] as string[];
  if (isGlobal) args.push("-g");

  let stdout = "";
  let stderr = "";
  try {
    ({ stdout, stderr } = await runNpx(args, {
      timeout: 60_000,
      cwd: !isGlobal && cwd ? cwd : undefined,
      env: { ...process.env, FORCE_COLOR: "0" },
    }));
  } catch (e) {
    const detail = e as { stdout?: string; stderr?: string; message?: string };
    const output = ((detail.stdout ?? "") + (detail.stderr ?? "")).replace(ANSI_RE, "");
    throw new BackendError("skill_install_failed", output || (detail.message ?? String(e)), {
      stdout: detail.stdout,
      stderr: detail.stderr,
    });
  }

  const output = (stdout + stderr).replace(ANSI_RE, "");
  const success = /Installation complete|Installed \d+ skill/.test(output);
  if (!success) {
    throw new BackendError("skill_install_failed", output.slice(-300) || "Install failed");
  }
  return { success: true, output };
}

// Check update availability for installed skills. Project installs are gated on
// the file-access roots. Optional package/scope narrows to a single install;
// omit both to check all installed skills.
export async function checkSkillUpdatesFromServices(
  input: SkillCheckInput,
): Promise<SkillCheckResponse> {
  const { cwd, package: pkg, scope } = input;
  if (!cwd) throw new BackendError("cwd_required", "cwd required");
  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
    throw new BackendError("access_denied", "Access denied");
  }
  if ((pkg && !scope) || (!pkg && scope)) {
    throw new BackendError("invalid_request", "package and scope must be provided together");
  }

  const { skills } = await loadSkillsWithInstallInfo(cwd);
  const installs = skills
    .map((skill) => skill.install)
    .filter((install): install is SkillInstallInfo => Boolean(install))
    .filter((install) => !pkg || (install.package === pkg && install.scope === scope));

  if (pkg && installs.length === 0) {
    throw new BackendError("skill_not_found", "Installed skill not found");
  }

  let updates: SkillUpdateResult[] = [];
  try {
    updates = await checkSkillUpdates(installs, {
      githubToken: process.env.GITHUB_TOKEN || process.env.GH_TOKEN,
    });
  } catch (e) {
    throw new BackendError(
      "skill_check_failed",
      e instanceof Error ? e.message : String(e),
    );
  }
  return { updates };
}

// Update an installed skill to its latest version.
export async function updateSkillFromServices(
  input: SkillUpdateInput,
): Promise<SkillUpdateResponse> {
  const { cwd, package: pkg, scope } = input;
  if (!cwd || !pkg || !scope) {
    throw new BackendError("invalid_request", "cwd, package, and scope are required");
  }
  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
    throw new BackendError("access_denied", "Access denied");
  }

  const { skills } = await loadSkillsWithInstallInfo(cwd);
  const skill = skills.find(
    (item) => item.install?.package === pkg && item.install.scope === scope,
  );
  if (!skill?.install) {
    throw new BackendError("skill_not_found", "Installed skill not found");
  }
  if (!skill.install.canCheckForUpdates) {
    throw new BackendError("invalid_request", "This skill cannot be updated automatically");
  }

  try {
    const { stdout, stderr } = await runNpx(buildSkillUpdateArgs(skill.install), {
      timeout: 60_000,
      cwd: scope === "project" ? cwd : undefined,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    const refreshed = await loadSkillsWithInstallInfo(cwd);
    const updatedSkill = refreshed.skills.find(
      (item) => item.install?.package === pkg && item.install.scope === scope,
    );
    return { success: true, skill: updatedSkill, output: `${stdout}${stderr}`.slice(-500) };
  } catch (e) {
    const detail = e as { stdout?: string; stderr?: string; message?: string };
    const output = `${detail.stdout ?? ""}${detail.stderr ?? ""}`;
    throw new BackendError("skill_update_failed", output || (detail.message ?? String(e)), {
      stdout: detail.stdout,
      stderr: detail.stderr,
    });
  }
}

// Search the skills catalog. Prefers the skills.sh search API and falls back to
// the `skills find` command. No project-trust gate: this is an external query.
const DEFAULT_LIMIT = 50;
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;
const SEARCH_API_BASE = process.env.SKILLS_API_URL || "https://skills.sh";

export async function searchSkillsFromServices(
  input: SkillSearchInput,
): Promise<SkillSearchResponse> {
  const { query, limit: rawLimit } = input;
  if (!query?.trim()) throw new BackendError("invalid_request", "query required");
  const limit = clampLimit(rawLimit);

  try {
    const results = await searchSkillsApi(query.trim(), limit);
    return { results };
  } catch {
    const { stdout, stderr } = await runNpx(["skills", "find", query.trim()], {
      timeout: 20_000,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    const results = parseSearchOutput(stdout + stderr).slice(0, limit);
    if (results.length > 0) return { results };
    throw new BackendError("skill_search_failed", "Search failed");
  }
}

export function clampLimit(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.floor(num)));
}

async function searchSkillsApi(query: string, limit: number): Promise<SkillSearchResult[]> {
  const url = `${SEARCH_API_BASE}/api/search?q=${encodeURIComponent(query)}&limit=${limit}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`skills.sh search failed: HTTP ${res.status}`);

  const data = (await res.json()) as {
    skills?: { name?: string; source?: string; id?: string; installs?: number }[];
  };
  return (data.skills ?? [])
    .map((skill) => {
      const name = skill.name?.trim();
      const source = skill.source?.trim();
      const slug = skill.id?.trim();
      if (!name || (!source && !slug)) return null;

      const pkg = `${source || slug}@${name}`;
      return {
        package: pkg,
        installs: formatInstalls(skill.installs),
        url: slug ? `${SEARCH_API_BASE}/${slug}` : "",
      } as SkillSearchResult;
    })
    .filter((skill): skill is SkillSearchResult => skill !== null)
    .sort((a, b) => parseInstallCount(b.installs) - parseInstallCount(a.installs));
}

export function parseSearchOutput(raw: string): SkillSearchResult[] {
  const clean = raw.replace(ANSI_RE, "");
  const results: SkillSearchResult[] = [];
  const lines = clean.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const pkgMatch = line.match(/^([\w.\-]+\/[\w.\-@:]+)\s+([\d.,]+[KMB]?\s+installs)$/);
    if (pkgMatch) {
      const urlLine = lines[i + 1]?.trim().replace(/^└\s*/, "");
      results.push({
        package: pkgMatch[1],
        installs: pkgMatch[2],
        url: urlLine?.startsWith("https://") ? urlLine : "",
      });
    }
  }
  return results;
}

export function formatInstalls(count?: number): string {
  if (!count || count <= 0) return "";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M installs`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}K installs`;
  return `${count} install${count === 1 ? "" : "s"}`;
}

export function parseInstallCount(installs: string): number {
  const match = installs.match(/^([\d.]+)([KMB])?\s+installs?$/);
  if (!match) return 0;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return 0;
  const multiplier =
    match[2] === "B" ? 1_000_000_000 : match[2] === "M" ? 1_000_000 : match[2] === "K" ? 1_000 : 1;
  return value * multiplier;
}
