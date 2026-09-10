import {
  DefaultPackageManager,
  SettingsManager,
  type PackageSource,
  type ResolvedPaths,
  type ResolvedResource,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "../../lib/file-access";
import { getProjectTrustStatus } from "../../lib/project-trust";
import type {
  PluginDiagnostic,
  PluginPackageInfo,
  PluginResourceCounts,
  PluginResourceInfo,
  PluginResourceKind,
  PluginScope,
  PluginsResponse,
} from "../../lib/api-types";
import type { PluginsRequestInput } from "./contracts";
import { BackendError } from "./errors";

// Plugin management surface (extensions/skills/prompts/themes, ZOS-82). This
// ports the SDK-backed plugin machinery in web/app/api/plugins/route.ts into a
// transport-neutral pi-backend service: the route layer stays thin (spawn +
// NextResponse live here, not on the /api/v1 boundary). File-access and
// project-trust gating match the in-app route.

const PLUGIN_ACTIONS = new Set<string>(["install", "remove", "update", "disable", "enable"]);

function emptyCounts(): PluginResourceCounts {
  return { extensions: 0, skills: 0, prompts: 0, themes: 0 };
}

function toPluginScope(scope: unknown): PluginScope {
  return scope === "project" ? "project" : "global";
}

function keyFor(source: string, scope: PluginScope): string {
  return `${scope}\0${source}`;
}

function getPackageSource(entry: PackageSource): string {
  return typeof entry === "string" ? entry : entry.source;
}

function isDisabledPackage(entry: PackageSource): boolean {
  if (typeof entry === "string") return false;
  return (
    Array.isArray(entry.extensions) && entry.extensions.length === 0 &&
    Array.isArray(entry.skills) && entry.skills.length === 0 &&
    Array.isArray(entry.prompts) && entry.prompts.length === 0 &&
    Array.isArray(entry.themes) && entry.themes.length === 0
  );
}

function getDisabledPackages(settingsManager: SettingsManager): Map<string, boolean> {
  const disabled = new Map<string, boolean>();
  for (const entry of settingsManager.getGlobalSettings().packages ?? []) {
    disabled.set(keyFor(getPackageSource(entry), "global"), isDisabledPackage(entry));
  }
  for (const entry of settingsManager.getProjectSettings().packages ?? []) {
    disabled.set(keyFor(getPackageSource(entry), "project"), isDisabledPackage(entry));
  }
  return disabled;
}

function setPackageDisabled(
  settingsManager: SettingsManager,
  source: string,
  scope: PluginScope,
  disabled: boolean,
): void {
  const current =
    scope === "project"
      ? settingsManager.getProjectSettings().packages ?? []
      : settingsManager.getGlobalSettings().packages ?? [];
  const next = current.map((entry): PackageSource => {
    if (getPackageSource(entry) !== source) return entry;
    if (disabled) {
      return {
        ...(typeof entry === "string" ? { source: entry } : entry),
        extensions: [],
        skills: [],
        prompts: [],
        themes: [],
      };
    }
    return getPackageSource(entry);
  });
  if (scope === "project") settingsManager.setProjectPackages(next);
  else settingsManager.setPackages(next);
}

function getResourceName(path: string, kind: PluginResourceKind): string {
  const file = path.split(/[\\/]/).pop() ?? path;
  const ext = file.includes(".") ? file.slice(file.lastIndexOf(".")) : "";
  if (kind === "skill" && file.toLowerCase() === "skill.md") {
    return path.split(/[\\/]/).slice(-2, -1).join("/") || file;
  }
  if (kind === "extension" && /^index\.(ts|js)$/.test(file)) {
    return path.split(/[\\/]/).slice(-2, -1).join("/") || file;
  }
  return ext ? file.slice(0, -ext.length) : file;
}

function getRelativePath(resource: ResolvedResource): string {
  const baseDir = resource.metadata.baseDir;
  if (!baseDir) return resource.path;
  const rel = baseDir === resource.path ? "" : resource.path.slice(baseDir.length).replace(/^[/\\]/, "");
  return rel && !rel.startsWith("..") ? rel : resource.path;
}

function getConfiguredVersion(source: string): string | undefined {
  const npmSpec = source.startsWith("npm:") ? source.slice(4) : undefined;
  if (npmSpec) {
    const lastAt = npmSpec.lastIndexOf("@");
    const packageNameEnd = npmSpec.startsWith("@") ? npmSpec.indexOf("/", 1) : 0;
    if (lastAt > packageNameEnd) return npmSpec.slice(lastAt + 1) || undefined;
    return undefined;
  }
  if (source.startsWith("git:") || /^[a-z]+:\/\//.test(source)) {
    const lastAt = source.lastIndexOf("@");
    const lastSlash = source.lastIndexOf("/");
    const lastColon = source.lastIndexOf(":");
    if (lastAt > Math.max(lastSlash, lastColon)) return source.slice(lastAt + 1) || undefined;
  }
  return undefined;
}

function readPackageMetadata(installedPath?: string): { packageName?: string; version?: string } {
  if (!installedPath) return {};
  try {
  const stats = statSync(installedPath);
  const packageJsonPath = stats.isDirectory()
    ? join(installedPath, "package.json")
    : join(dirname(installedPath), "package.json");
  if (!existsSync(packageJsonPath)) return {};
  const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      name?: unknown;
      version?: unknown;
    };
    return {
      packageName: typeof parsed.name === "string" ? parsed.name : undefined,
      version: typeof parsed.version === "string" ? parsed.version : undefined,
    };
  } catch {
    return {};
  }
}

function collectResource(
  resource: ResolvedResource,
  kind: keyof PluginResourceCounts,
  countsByPackage: Map<string, PluginResourceCounts>,
  resourcesByPackage: Map<string, PluginResourceInfo[]>,
  totals: PluginResourceCounts,
): void {
  if (!resource.enabled || resource.metadata.origin !== "package") return;
  const source = resource.metadata.source;
  const scope = toPluginScope(resource.metadata.scope);
  const key = keyFor(source, scope);
  const counts = countsByPackage.get(key) ?? emptyCounts();
  counts[kind] += 1;
  totals[kind] += 1;
  countsByPackage.set(key, counts);
  const resources = resourcesByPackage.get(key) ?? [];
  const resourceKind =
    kind === "extensions"
      ? "extension"
      : kind === "skills"
        ? "skill"
        : kind === "prompts"
          ? "prompt"
          : "theme";
  resources.push({
    kind: resourceKind,
    name: getResourceName(resource.path, resourceKind),
    path: resource.path,
    relativePath: getRelativePath(resource),
  });
  resourcesByPackage.set(key, resources);
}

function collectResources(paths: ResolvedPaths): {
  countsByPackage: Map<string, PluginResourceCounts>;
  resourcesByPackage: Map<string, PluginResourceInfo[]>;
  totals: PluginResourceCounts;
} {
  const countsByPackage = new Map<string, PluginResourceCounts>();
  const resourcesByPackage = new Map<string, PluginResourceInfo[]>();
  const totals = emptyCounts();
  for (const resource of paths.extensions) collectResource(resource, "extensions", countsByPackage, resourcesByPackage, totals);
  for (const resource of paths.skills) collectResource(resource, "skills", countsByPackage, resourcesByPackage, totals);
  for (const resource of paths.prompts) collectResource(resource, "prompts", countsByPackage, resourcesByPackage, totals);
  for (const resource of paths.themes) collectResource(resource, "themes", countsByPackage, resourcesByPackage, totals);
  return { countsByPackage, resourcesByPackage, totals };
}

// List every configured package and its loaded resources for a project, with
// project-vs-global scope and diagnostics — parity with the in-app plugin
// listing. The file-access + project-trust gate runs first so a dangling or
// untrusted cwd fails deterministically before the SDK resolves anything.
export async function readPluginsFromServices(cwd?: string): Promise<PluginsResponse> {
  if (!cwd) throw new BackendError("cwd_required", "cwd required");
  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
    throw new BackendError("access_denied", "Access denied");
  }
  const agentDir = getAgentDir();
  const projectTrust = getProjectTrustStatus(cwd, agentDir);
  const settingsManager = SettingsManager.create(cwd, agentDir, {
    projectTrusted: projectTrust.trusted,
  });
  const packageManager = new DefaultPackageManager({
    cwd,
    agentDir,
    settingsManager,
  });

  const diagnostics: PluginDiagnostic[] = [];
  let countsByPackage = new Map<string, PluginResourceCounts>();
  let resourcesByPackage = new Map<string, PluginResourceInfo[]>();
  let totals = emptyCounts();
  const disabledByPackage = getDisabledPackages(settingsManager);

  try {
    const resolved = await packageManager.resolve(async (source) => {
      diagnostics.push({
        type: "warning",
        source,
        message: "Package is configured but not installed yet.",
      });
      return "skip";
    });
    ({ countsByPackage, resourcesByPackage, totals } = collectResources(resolved));
  } catch (error) {
    diagnostics.push({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const packages = packageManager.listConfiguredPackages().map((pkg) => {
    const scope = toPluginScope(pkg.scope);
    const key = keyFor(pkg.source, scope);
    const disabled = disabledByPackage.get(key) ?? false;
    const counts = countsByPackage.get(key) ?? emptyCounts();
    const resources = resourcesByPackage.get(key) ?? [];
    const resourceCount = counts.extensions + counts.skills + counts.prompts + counts.themes;
    const packageMetadata = readPackageMetadata(pkg.installedPath);
    if (!pkg.installedPath) {
      diagnostics.push({
        type: "warning",
        source: pkg.source,
        message: "Configured package path was not found.",
      });
    }
    return {
      source: pkg.source,
      scope,
      filtered: pkg.filtered,
      disabled,
      installedPath: pkg.installedPath,
      packageName: packageMetadata.packageName,
      version: packageMetadata.version,
      configuredVersion: getConfiguredVersion(pkg.source),
      counts,
      resources,
      status: disabled
        ? "disabled"
        : resourceCount > 0
          ? "loaded"
          : pkg.installedPath
            ? "installed"
            : "missing",
    } satisfies PluginPackageInfo;
  });

  return {
    packages,
    totals,
    diagnostics,
    projectResourcesLoaded: projectTrust.trusted,
  };
}

// Install / update / remove / disable / enable a plugin, preserving project vs
// global scope, then re-read the updated listing. Gating mirrors the in-app
// route: project-scoped mutations require a trusted, file-access rooted cwd.
export async function managePluginsFromServices(
  input: PluginsRequestInput,
): Promise<PluginsResponse> {
  const { cwd, action, source, scope } = input;
  if (!PLUGIN_ACTIONS.has(action)) {
    throw new BackendError("invalid_request", `unsupported plugin action: ${action}`);
  }
  if (!cwd) throw new BackendError("cwd_required", "cwd required");

  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
    throw new BackendError("access_denied", "Access denied");
  }

  const isGlobal = scope !== "project";
  const agentDir = getAgentDir();
  const projectTrust = getProjectTrustStatus(cwd, agentDir);
  const local = !isGlobal;
  if (!isGlobal && !projectTrust.trusted) {
    throw new BackendError(
      "access_denied",
      "Project resources must be trusted before modifying project plugins",
    );
  }

  const settingsManager = SettingsManager.create(cwd, agentDir, {
    projectTrusted: projectTrust.trusted,
  });
  const packageManager = new DefaultPackageManager({
    cwd,
    agentDir,
    settingsManager,
  });

  try {
    const src = source?.trim();
    if (action === "install" || action === "remove" || action === "disable" || action === "enable") {
      if (!src) throw new BackendError("invalid_request", "source required");
    }
    if (action === "install") {
      await packageManager.installAndPersist(src!, { local });
    } else if (action === "remove") {
      await packageManager.removeAndPersist(src!, { local });
    } else if (action === "update") {
      await packageManager.update(src);
    } else if (action === "disable") {
      setPackageDisabled(settingsManager, src!, scope === "project" ? "project" : "global", true);
      await settingsManager.flush();
    } else if (action === "enable") {
      setPackageDisabled(settingsManager, src!, scope === "project" ? "project" : "global", false);
      await settingsManager.flush();
    }
  } catch (error) {
    throw new BackendError(
      "plugin_action_failed",
      error instanceof Error ? error.message : String(error),
    );
  }

  return readPluginsFromServices(cwd);
}
