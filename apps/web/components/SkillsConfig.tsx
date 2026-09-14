"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { skillsService } from "@/services/skills.service";
import { TAGS } from "@/services/tags";
import type {
  SkillInfo as Skill,
  SkillInstallScope,
  SkillSearchResult,
  SkillsResponse,
  SkillUpdateResult,
} from "@/lib/api-types";

function shortenPath(p: string): string {
  // Match common home dir patterns: /Users/xxx, /home/xxx
  return p.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

function sourceLabel(skill: Skill): string {
  const src = skill.sourceInfo?.source;
  const scope = skill.sourceInfo?.scope;
  if (scope === "user" || src === "user") return "global";
  if (scope === "project" || src === "project") return "project";
  return "path";
}

function skillGroupLabel(skill: Skill): string {
  const source = sourceLabel(skill);
  if (source === "path") return source;
  return skill.install?.skillsShUrl ? `${source} / skills.sh` : source;
}

function updateKey(skill: Skill): string | null {
  return skill.install
    ? `${skill.install.scope}\0${skill.install.package}`
    : null;
}

function shortVersion(version?: string): string {
  return version ? version.slice(0, 8) : "unknown";
}

function Toggle({
  enabled,
  loading,
  onToggle,
}: {
  enabled: boolean;
  loading: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      onClick={onToggle}
      disabled={loading}
      title={
        enabled
          ? t("i18n.visibleInPrompt")
          : t("i18n.hiddenFromPrompt")
      }
      className={`shrink-0 w-10 h-5.5 rounded-[11px] border-none p-0 relative transition-colors duration-150 outline-none ${loading ? "cursor-wait" : "cursor-pointer"} ${enabled ? "bg-(--accent)" : "bg-(--border)"}`}
    >
      <span
        className={`absolute top-0.75 w-4 h-4 rounded-full bg-(--bg) shadow-[0_1px_4px_rgba(0,0,0,0.22)] transition-[left] duration-[0.18s] ease-in-out ${enabled ? "left-5.25" : "left-0.75"}`}
      />
    </button>
  );
}

function SkillDetail({
  skill,
  cwd,
  onToggle,
  toggling,
  saveError,
  updateStatus,
  checkingUpdate,
  updating,
  updateError,
  onCheckUpdate,
  onUpdate,
}: {
  skill: Skill;
  cwd: string;
  onToggle: (skill: Skill) => void;
  toggling: boolean;
  saveError: string | null;
  updateStatus?: SkillUpdateResult;
  checkingUpdate: boolean;
  updating: boolean;
  updateError: string | null;
  onCheckUpdate: () => void;
  onUpdate: () => void;
}) {
  const { t } = useI18n();
  const label = sourceLabel(skill);
  const enabled = !skill.disableModelInvocation;

  function displayPath(p: string): string {
    if (label === "project" && p.startsWith(cwd)) {
      const rel = p.slice(cwd.length).replace(/^[/\\]/, "");
      return `./${rel}`;
    }
    return shortenPath(p);
  }

  return (
    <div className="flex flex-col gap-20">
      {/* Path + tag + toggle, with a stable status row below. */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-7">
          <span
            className={`text-[11px] py-px px-1.5 rounded-[3px] shrink-0 ${label === "project" ? "bg-indigo-500/15" : "bg-black/10"} ${label === "project" ? "text-indigo-500/80" : "text-(--text-dim)"}`}
          >
            {label}
          </span>
          <span
            className="font-(--font-mono) text-[11px] text-(--text-dim) flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
          >
            {displayPath(skill.filePath)}
          </span>
          <Toggle
            enabled={enabled}
            loading={toggling}
            onToggle={() => onToggle(skill)}
          />
        </div>
        <div
          className="min-h-4 flex items-center justify-end gap-2 flex-wrap text-right"
        >
          {!enabled && (
            <span className="text-[11px] text-(--text-dim)">
              {t("i18n.hiddenButInvocable")}
            </span>
          )}
          {saveError && (
            <span className="text-xs text-(--state-error) wrap-anywhere">
              {saveError}
            </span>
          )}
        </div>
      </div>

      {skill.install?.skillsShUrl && (
        <div className="flex flex-col gap-5">
          <span
            className="text-xs text-(--text-muted) font-medium"
          >
            Source
          </span>
          <a
            href={skill.install.skillsShUrl}
            target="_blank"
            rel="noreferrer"
            title={skill.install.skillsShUrl}
            className="flex items-center gap-2 w-fit max-w-full text-(--accent) no-underline"
          >
            <span
              className="font-(--font-mono) text-xs overflow-hidden text-ellipsis whitespace-nowrap"
            >
              {skill.install.skillsShUrl.replace(/^https?:\/\//, "")} ↗
            </span>
          </a>
        </div>
      )}

      {skill.install && (
        <div className="flex flex-col gap-7">
          <span
            className="text-xs text-(--text-muted) font-medium"
          >
            Version
          </span>
          <div
            className="flex items-center gap-2.5 flex-wrap"
          >
            <span
              className="font-(--font-mono) text-xs text-(--text-muted)"
            >
              {shortVersion(updateStatus?.currentVersion ?? skill.install.versionHash)}
            </span>
            {skill.install.canCheckForUpdates && (
              <button
                onClick={onCheckUpdate}
                disabled={checkingUpdate || updating}
                className={`py-1 px-2.25 border border-(--border) rounded-[5px] bg-none text-(--text-muted) text-[11px] ${checkingUpdate || updating ? "cursor-not-allowed" : "cursor-pointer"} ${checkingUpdate || updating ? "opacity-50" : ""}`}
              >
                 {t("i18n.check")}
              </button>
            )}
            {updateStatus?.state === "update-available" && (
              <span
                className="font-(--font-mono) text-xs text-(--state-warning)"
              >
                {shortVersion(updateStatus.latestVersion)}
              </span>
            )}
            {(checkingUpdate ||
              (updateStatus && updateStatus.state !== "update-available")) && (
              <span
                className="text-xs"
                style={{
                  color: checkingUpdate
                    ? "var(--accent)"
                    : updateStatus?.state === "up-to-date"
                      ? "var(--state-success)"
                      : updateStatus?.state === "error"
                          ? "var(--state-error)"
                          : "var(--text-dim)",
                }}
              >
                {checkingUpdate
                   ? t("i18n.checking")
                  : updateStatus?.state === "up-to-date"
                     ? t("i18n.upToDate")
                    : updateStatus?.state === "unsupported"
                         ? t("i18n.automaticChecksUnavailable")
                         : updateStatus?.message || t("i18n.checkFailed")}
              </span>
            )}
            {updateStatus?.state === "update-available" && (
              <button
                onClick={onUpdate}
                disabled={updating || checkingUpdate}
                className={`py-1 px-2.5 border-none rounded-[5px] bg-(--accent) text-white text-[11px] font-semibold ${updating || checkingUpdate ? "cursor-not-allowed" : "cursor-pointer"} ${updating || checkingUpdate ? "opacity-50" : ""}`}
              >
                 {updating ? t("i18n.updating") : t("i18n.update")}
              </button>
            )}
          </div>
          {updateError && (
            <span className="text-xs text-(--state-error) leading-normal">{updateError}</span>
          )}
        </div>
      )}

      <div className="flex flex-col gap-5">
        <span
          className="text-xs text-(--text-muted) font-medium"
        >
          Name
        </span>
        <span
          className="font-(--font-mono) text-sm text-(--text)"
        >
          {skill.name}
        </span>
      </div>

      <div className="flex flex-col gap-5">
        <span
          className="text-xs text-(--text-muted) font-medium"
        >
          Description
        </span>
        <span
          className="text-sm text-(--text-muted) leading-[1.6px]"
        >
          {skill.description}
        </span>
      </div>
    </div>
  );
}

function AddSkillPanel({
  cwd,
  installedPackages,
  projectResourcesLoaded,
  onInstalled,
}: {
  cwd: string;
  installedPackages: Record<SkillInstallScope, ReadonlySet<string>>;
  projectResourcesLoaded: boolean;
  onInstalled: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SkillSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [newlyInstalledPkgs, setNewlyInstalledPkgs] = useState<Set<string>>(
    new Set(),
  );
  const [scope, setScope] = useState<"global" | "project">("global");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setSearching(true);
    setSearchError(null);
    setResults([]);
    try {
      const res = await fetch("/api/skills/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q.trim() }),
      });
      const d = (await res.json()) as {
        results?: SkillSearchResult[];
        error?: string;
      };
      if (d.error) {
        setSearchError(d.error);
        return;
      }
      setResults(d.results ?? []);
      if ((d.results ?? []).length === 0) setSearchError("No skills found");
    } catch (e) {
      setSearchError(String(e));
    } finally {
      setSearching(false);
    }
  }, []);

  const install = useCallback(
    async (pkg: string) => {
      setInstalling(pkg);
      setInstallError(null);
      try {
        const res = await fetch("/api/skills/install", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ package: pkg, scope, cwd }),
        });
        const d = (await res.json()) as { success?: boolean; error?: string };
        if (!res.ok || d.error) {
          setInstallError(d.error ?? `HTTP ${res.status}`);
          return;
        }
        setNewlyInstalledPkgs((prev) =>
          new Set(prev).add(`${scope}:${pkg}`),
        );
        onInstalled();
      } catch (e) {
        setInstallError(String(e));
      } finally {
        setInstalling(null);
      }
    },
    [onInstalled, scope, cwd],
  );

  const installPath =
    scope === "global"
      ? "~/.pi/agent/skills/"
      : `${shortenPath(cwd)}/.pi/skills/`;

  return (
    <div className="flex flex-col h-full">
      {/* ── Header area ── */}
      <div
        className="flex flex-col gap-3 mb-5"
      >
        <div className="text-sm font-semibold text-(--text)">
           {t("i18n.addSkill")}
        </div>

        {/* Search row */}
        <div className="flex gap-8">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") search(query);
            }}
             placeholder={t("i18n.skillSearchPlaceholder")}
            className="flex-1 py-1.75 px-2.5 text-[13px] bg-(--bg-panel) border border-(--border) rounded-md text-(--text) outline-none"
          />
          <button
            onClick={() => search(query)}
            disabled={searching || !query.trim()}
            className={`py-1.75 px-4 text-[13px] rounded-md border-none bg-(--accent) text-white shrink-0 ${searching || !query.trim() ? "cursor-not-allowed" : "cursor-pointer"} ${searching || !query.trim() ? "opacity-50" : ""}`}
          >
             {searching ? t("i18n.searching") : t("i18n.search")}
          </button>
        </div>

        {/* Scope + install path row */}
        <div className="flex items-center gap-10">
          <div
            className="flex rounded-[5px] border border-(--border) overflow-hidden text-xs shrink-0"
          >
            {(["global", "project"] as const).map((s) => (
              <button
                key={s}
                onClick={() => {
                  if (s === "global" || projectResourcesLoaded) setScope(s);
                }}
                disabled={s === "project" && !projectResourcesLoaded}
                title={s === "project" && !projectResourcesLoaded ? t("trust.projectScopeUnavailable") : undefined}
                className={`py-0.75 px-2.5 border-none ${s === "project" && !projectResourcesLoaded ? "cursor-not-allowed" : "cursor-pointer"} ${scope === s ? "bg-(--bg-selected)" : "bg-none"} ${scope === s ? "text-(--text)" : "text-(--text-dim)"} ${scope === s ? "font-semibold" : ""} ${s === "project" && !projectResourcesLoaded ? "opacity-[0.45]" : ""} ${s === "global" ? "border-r border-(--border)" : "border-r-0"}`}
              >
                {s}
              </button>
            ))}
          </div>
          <span
            className="text-xs text-(--text-dim) font-(--font-mono) overflow-hidden text-ellipsis whitespace-nowrap"
          >
            → {installPath}
          </span>
        </div>

        {/* Errors */}
        {searchError && (
          <div className="text-xs text-(--state-error)">{searchError}</div>
        )}
        {installError && (
          <div
            className="text-xs text-(--state-error) wrap-break-word"
          >
            {installError}
          </div>
        )}
      </div>

      {/* ── Results list ── */}
      {results.length > 0 ? (
        <div className="flex-1 overflow-y-auto">
          {results.map((r) => {
            const isInstalled =
              installedPackages[scope].has(r.package) ||
              newlyInstalledPkgs.has(`${scope}:${r.package}`);
            const isInstalling = installing === r.package;
            // split "owner/repo@skill" for cleaner display
            const atIdx = r.package.indexOf("@");
            const repopart = atIdx > -1 ? r.package.slice(0, atIdx) : r.package;
            const skillpart = atIdx > -1 ? r.package.slice(atIdx + 1) : null;
            return (
              <div
                key={r.package}
                className="flex items-center gap-3.5 py-3 px-0 border-b border-(--border)"
              >
                <div className="flex-1 min-w-0">
                  {/* skill name prominent */}
                  <div
                    className="text-[13px] font-semibold text-(--text) mb-0.75"
                  >
                    {skillpart ?? repopart}
                  </div>
                  {/* repo + installs + link row */}
                  <div
                    className="flex items-center gap-2.5 flex-wrap"
                  >
                    <span
                      className="font-(--font-mono) text-[11px] text-(--text-dim)"
                    >
                      {repopart}
                    </span>
                    <span
                      className="text-xs text-(--text-muted) font-medium"
                    >
                      {r.installs}
                    </span>
                    {r.url && (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-(--accent) no-underline"
                      >
                        skills.sh ↗
                      </a>
                    )}
                  </div>
                </div>
                <button
                  onClick={() =>
                    !isInstalled && !isInstalling && install(r.package)
                  }
                  disabled={isInstalled || isInstalling || installing !== null}
                  className="shrink-0 px-3.5 py-1.25 text-xs font-medium rounded-[5px] border border-(--border) transition-colors duration-120"
                  style={{
                    cursor:
                      isInstalled || isInstalling || installing !== null
                        ? "not-allowed"
                        : "pointer",
                    background: isInstalled ? "rgba(34,197,94,0.1)" : "none",
                    color: isInstalled
                      ? "var(--state-success)"
                      : isInstalling
                        ? "var(--accent)"
                        : "var(--text-muted)",
                  }}
                >
                  {isInstalled
                     ? `✓ ${t("i18n.installed")}`
                    : isInstalling
                       ? t("i18n.installing")
                       : t("i18n.install")}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        !searchError &&
        !searching && (
          <div
            className="text-[13px] text-(--text-dim) leading-[1.8px]"
          >
            Search{" "}
            <a
              href="https://skills.sh"
              target="_blank"
              rel="noreferrer"
              className="text-(--accent) no-underline"
            >
              skills.sh
            </a>{" "}
            to discover and install skills for your agent.
          </div>
        )
      )}
    </div>
  );
}

export function SkillsConfig({
  cwd,
  onClose,
}: {
  cwd: string;
  onClose: () => void;
}) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const {
    data: queryData,
    isFetching,
    error: queryError,
    refetch,
  } = useQuery(skillsService.byCwdQueryOptions(cwd));
  const skills = useMemo(() => queryData?.skills ?? [], [queryData?.skills]);
  const loading = isFetching;
  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : String(queryError)
    : null;
  const [selected, setSelected] = useState<string | null>(null);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [updateStatuses, setUpdateStatuses] = useState<Record<string, SkillUpdateResult>>({});
  const [checkingUpdates, setCheckingUpdates] = useState<Set<string>>(new Set());
  const [checkingAll, setCheckingAll] = useState(false);
  const [updatingSkill, setUpdatingSkill] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [projectResourcesLoaded, setProjectResourcesLoaded] = useState(true);
  const [dormantGroupsOpen, setDormantGroupsOpen] = useState<Record<string, boolean>>({});

  const loadSkills = useCallback(() => {
    void refetch();
  }, [refetch]);

  // Auto-select first skill + project scope flags once the (cached) list
  // arrives. Fetch itself lives in the TanStack Query cache.
  useEffect(() => {
    setUpdateStatuses({});
    setUpdateError(null);
  }, [cwd]);

  useEffect(() => {
    if (!queryData) return;
    setProjectResourcesLoaded(queryData.projectResourcesLoaded ?? true);
    const list = queryData.skills ?? [];
    if (list.length > 0 && !selected) {
      const initialSkill = list.find((skill) => !skill.disableModelInvocation) ?? list[0];
      setSelected(initialSkill.filePath);
      if (initialSkill.disableModelInvocation) {
        setDormantGroupsOpen((current) => ({
          ...current,
          [skillGroupLabel(initialSkill)]: true,
        }));
      }
    }
  }, [queryData, selected]);

  const checkForUpdates = useCallback(async (skill?: Skill) => {
    const targets = skill
      ? [skill]
      : skills.filter((item) => Boolean(item.install));
    const keys = targets
      .map(updateKey)
      .filter((key): key is string => Boolean(key));
    if (keys.length === 0) return;

    setUpdateError(null);
    setCheckingUpdates((current) => new Set([...current, ...keys]));
    if (!skill) setCheckingAll(true);
    try {
      const res = await fetch("/api/skills/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd,
          package: skill?.install?.package,
          scope: skill?.install?.scope,
        }),
      });
      const data = (await res.json()) as {
        updates?: SkillUpdateResult[];
        error?: string;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setUpdateStatuses((current) => {
        const next = { ...current };
        for (const update of data.updates ?? []) {
          next[`${update.scope}\0${update.package}`] = update;
        }
        return next;
      });
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCheckingUpdates((current) => {
        const next = new Set(current);
        for (const key of keys) next.delete(key);
        return next;
      });
      if (!skill) setCheckingAll(false);
    }
  }, [cwd, skills]);

  const updateInstalledSkill = useCallback(async (skill: Skill) => {
    if (!skill.install) return;
    const key = updateKey(skill)!;
    setUpdatingSkill(key);
    setUpdateError(null);
    try {
      const res = await fetch("/api/skills/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd,
          package: skill.install.package,
          scope: skill.install.scope,
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        skill?: Skill;
        error?: string;
      };
      if (!res.ok || data.error || !data.success) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      await loadSkills();
      const versionHash = data.skill?.install?.versionHash;
      setUpdateStatuses((current) => ({
        ...current,
        [key]: {
          package: skill.install!.package,
          scope: skill.install!.scope,
          state: "up-to-date",
          currentVersion: versionHash,
          latestVersion: versionHash,
        },
      }));
    } catch (e) {
      setUpdateError(e instanceof Error ? e.message : String(e));
    } finally {
      setUpdatingSkill(null);
    }
  }, [cwd, loadSkills]);

  const toggle = useCallback(async (skill: Skill) => {
    const next = !skill.disableModelInvocation;
    setToggling((s) => new Set(s).add(skill.filePath));
    setSaveError(null);
    try {
      const res = await fetch("/api/skills", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: skill.filePath,
          disableModelInvocation: next,
        }),
      });
      const d = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || d.error) {
        setSaveError(d.error ?? `HTTP ${res.status}`);
        return;
      }
      // sync into the query cache so the list stays fresh on remount
      queryClient.setQueryData<SkillsResponse>(TAGS.skills.byCwd(cwd), (prev) =>
        prev
          ? {
              ...prev,
              skills: prev.skills.map((s) =>
                s.filePath === skill.filePath
                  ? { ...s, disableModelInvocation: next }
                  : s,
              ),
            }
          : prev,
      );
      if (next) {
        setDormantGroupsOpen((current) => ({
          ...current,
          [skillGroupLabel(skill)]: true,
        }));
      }
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setToggling((s) => {
        const n = new Set(s);
        n.delete(skill.filePath);
        return n;
      });
    }
  }, [cwd, queryClient]);

  const selectedSkill = skills.find((s) => s.filePath === selected) ?? null;

  return (
    <div
      className="fixed inset-0 z-1000 bg-black/35 flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="max-w-[calc(100vw-16px)] max-h-[calc(100dvh-16px)] bg-(--bg) border border-(--border) rounded-[10px] flex flex-col shadow-[0_8px_32px_rgba(0,0,0,0.18)] overflow-hidden"
        style={{
          width: isMobile ? "calc(100vw - 16px)" : 860,
          height: isMobile ? "calc(100dvh - 16px)" : "78vh",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between py-3 px-4.5 border-b border-(--border) shrink-0"
        >
          <div className="flex items-baseline gap-10">
            <span
              className="text-[15px] font-bold text-(--text)"
            >
               {t("common.skills")}
            </span>
            <code
              className="text-[11px] text-(--text-muted) font-(--font-mono) max-w-[320px] overflow-hidden text-ellipsis whitespace-nowrap"
            >
              {shortenPath(cwd)}
            </code>
          </div>
          <button
            onClick={onClose}
            className="bg-none border-none text-(--text-muted) cursor-pointer text-xl leading-none py-0.5 px-1.5"
          >
            ×
          </button>
        </div>

        {!projectResourcesLoaded && (
          <div
            role="status"
            className="py-2 px-4.5 border-b border-(--border) bg-(--bg-panel) text-(--text-muted) text-xs"
          >
            {t("trust.skillsNotLoaded")}
          </div>
        )}

        {/* Body */}
        <div className={`flex-1 flex overflow-hidden ${isMobile ? "flex-col" : "flex-row"}`}>
          {/* Left: skill list */}
          <div
            className="flex flex-col shrink-0 bg-(--bg-panel)"
            style={{
              width: isMobile ? "100%" : 210,
              maxHeight: isMobile ? "40vh" : undefined,
              borderRight: isMobile ? "none" : "1px solid var(--border)",
              borderBottom: isMobile ? "1px solid var(--border)" : "none",
            }}
          >
            <div className="flex-1 overflow-y-auto py-2 px-1.5">
              {loading ? (
                <div
                  className="py-2.5 px-2 text-xs text-(--text-muted)"
                >
                   {t("i18n.loading")}
                </div>
              ) : error ? (
                <div
                  className="py-2.5 px-2 text-[11px] text-(--state-error)"
                >
                  {error}
                </div>
              ) : skills.length === 0 ? (
                <div
                  className="py-2.5 px-2 text-[11px] text-(--text-dim)"
                >
                   {t("i18n.noSkills")}
                </div>
              ) : (
                (() => {
                  const groups: { label: string; skills: typeof skills }[] = [];
                  const groupDefinitions = [
                    {
                      label: "project / skills.sh",
                      matches: (skill: Skill) =>
                        sourceLabel(skill) === "project" &&
                        Boolean(skill.install?.skillsShUrl),
                    },
                    {
                      label: "project",
                      matches: (skill: Skill) =>
                        sourceLabel(skill) === "project" &&
                        !skill.install?.skillsShUrl,
                    },
                    {
                      label: "global / skills.sh",
                      matches: (skill: Skill) =>
                        sourceLabel(skill) === "global" &&
                        Boolean(skill.install?.skillsShUrl),
                    },
                    {
                      label: "global",
                      matches: (skill: Skill) =>
                        sourceLabel(skill) === "global" &&
                        !skill.install?.skillsShUrl,
                    },
                    {
                      label: "path",
                      matches: (skill: Skill) => sourceLabel(skill) === "path",
                    },
                  ];
                  for (const { label, matches } of groupDefinitions) {
                    const grpSkills = skills.filter(matches);
                    if (grpSkills.length > 0)
                      groups.push({ label, skills: grpSkills });
                  }
                  const renderSkillRow = (skill: Skill) => {
                    const isSelected =
                      !addMode && selected === skill.filePath;
                    const disabled = skill.disableModelInvocation;
                    return (
                      <div
                        key={skill.filePath}
                        onClick={() => {
                          setSelected(skill.filePath);
                          setAddMode(false);
                        }}
                        className={`flex items-center gap-1.75 py-2 px-2 rounded-[5px] cursor-pointer ${isSelected ? "bg-(--bg-selected)" : "bg-none"}`}
                        onMouseEnter={(e) => {
                          if (!isSelected)
                            e.currentTarget.style.background =
                              "var(--bg-hover)";
                        }}
                        onMouseLeave={(e) => {
                          if (!isSelected)
                            e.currentTarget.style.background = "none";
                        }}
                      >
                        <span
                          className="shrink-0 w-1.75 h-1.75 rounded-full transition-[background,box-shadow] duration-150"
                          style={{
                            background: disabled
                              ? "var(--border)"
                              : "var(--accent)",
                            boxShadow: disabled
                              ? "none"
                              : "0 0 4px var(--accent)",
                          }}
                        />
                        <span
                          className={`text-xs font-(--font-mono) flex-1 overflow-hidden text-ellipsis whitespace-nowrap ${isSelected ? "font-semibold" : ""} ${disabled ? "text-(--text-dim)" : "text-(--text)"}`}
                        >
                          {skill.name}
                        </span>
                        {(() => {
                          const key = updateKey(skill);
                          const status = key ? updateStatuses[key] : undefined;
                          if (status?.state !== "update-available") return null;
                          return (
                            <span
                               title={t("i18n.updateAvailable")}
                              className="text-(--state-warning) text-[13px] leading-none shrink-0"
                            >
                              ↑
                            </span>
                          );
                        })()}
                      </div>
                    );
                  };
                  return groups.map(
                    ({ label: grpLabel, skills: grpSkills }) => {
                      const activeSkills = grpSkills.filter(
                        (skill) => !skill.disableModelInvocation,
                      );
                      const dormantSkills = grpSkills.filter(
                        (skill) => skill.disableModelInvocation,
                      );
                      const dormantOpen = dormantGroupsOpen[grpLabel] ?? false;
                      return (
                        <div key={grpLabel} className="mb-6">
                          <div
                            className="pt-1 px-2 pb-0.75 text-[11px] font-semibold text-(--text-dim) uppercase tracking-wider"
                          >
                            {grpLabel}
                          </div>
                          {activeSkills.map(renderSkillRow)}
                          {dormantSkills.length > 0 && (
                            <>
                              <div
                                onClick={() =>
                                  setDormantGroupsOpen((current) => ({
                                    ...current,
                                    [grpLabel]: !dormantOpen,
                                  }))
                                }
                                className="flex items-center gap-1.25 pt-1 px-2 pb-0.75 text-[11px] font-semibold text-(--text-dim) uppercase tracking-wider cursor-pointer select-none"
                              >
                                <span className="text-[10px] leading-none">
                                  {dormantOpen ? "▾" : "▸"}
                                </span>
                                {t("i18n.dormant")} ({dormantSkills.length})
                              </div>
                              {dormantOpen && dormantSkills.map(renderSkillRow)}
                            </>
                          )}
                        </div>
                      );
                    },
                  );
                })()
              )}
            </div>
            {/* Add skill button */}
            <div
              className="py-2 px-1.5 border-t border-(--border) shrink-0"
            >
              <div
                onClick={() => setAddMode(true)}
                className={`flex items-center gap-1.5 py-1.75 px-2 rounded-[5px] cursor-pointer text-xs ${addMode ? "bg-(--bg-selected)" : "bg-none"} ${addMode ? "text-(--accent)" : "text-(--text-dim)"}`}
                onMouseEnter={(e) => {
                  if (!addMode)
                    e.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  if (!addMode) e.currentTarget.style.background = "none";
                }}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                 {t("i18n.addSkill")}
              </div>
            </div>
          </div>

          {/* Right: detail or add panel */}
          <div className="flex-1 overflow-y-auto p-5">
            {addMode ? (
              <AddSkillPanel
                cwd={cwd}
                projectResourcesLoaded={projectResourcesLoaded}
                installedPackages={{
                  global: new Set(
                    skills
                      .filter((skill) => skill.install?.scope === "global")
                      .map((skill) => skill.install!.package),
                  ),
                  project: new Set(
                    skills
                      .filter((skill) => skill.install?.scope === "project")
                      .map((skill) => skill.install!.package),
                  ),
                }}
                onInstalled={() => {
                  void loadSkills();
                }}
              />
            ) : loading ? null : selectedSkill ? (
              <SkillDetail
                key={selectedSkill.filePath}
                skill={selectedSkill}
                cwd={cwd}
                onToggle={toggle}
                toggling={toggling.has(selectedSkill.filePath)}
                saveError={saveError}
                updateStatus={
                  updateKey(selectedSkill)
                    ? updateStatuses[updateKey(selectedSkill)!]
                    : undefined
                }
                checkingUpdate={
                  updateKey(selectedSkill)
                    ? checkingUpdates.has(updateKey(selectedSkill)!)
                    : false
                }
                updating={updatingSkill === updateKey(selectedSkill)}
                updateError={updateError}
                onCheckUpdate={() => void checkForUpdates(selectedSkill)}
                onUpdate={() => void updateInstalledSkill(selectedSkill)}
              />
            ) : (
              <div
                className="h-full flex items-center justify-center text-(--text-dim) text-[13px]"
              >
                 {t("i18n.selectSkill")}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between py-2.5 px-4.5 border-t border-(--border) shrink-0"
        >
          <div className="flex items-center gap-10">
            {skills.some((skill) => Boolean(skill.install)) && (
              <button
                onClick={() => void checkForUpdates()}
                disabled={checkingAll || updatingSkill !== null}
                className={`py-1.5 px-3 bg-none border border-(--border) rounded-md text-(--text-muted) text-xs ${checkingAll || updatingSkill !== null ? "cursor-not-allowed" : "cursor-pointer"} ${checkingAll || updatingSkill !== null ? "opacity-50" : ""}`}
              >
                 {checkingAll ? t("i18n.checking") : t("i18n.checkUpdates")}
              </button>
            )}
            {Object.values(updateStatuses).filter(
              (status) => status.state === "update-available",
            ).length > 0 && (
              <span className="text-xs text-(--state-warning)">
                {
                  Object.values(updateStatuses).filter(
                    (status) => status.state === "update-available",
                  ).length
                }{" "}
                {Object.values(updateStatuses).filter(
                  (status) => status.state === "update-available",
                ).length === 1
                   ? t("i18n.update")
                   : t("i18n.updates")}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="py-1.5 px-3.5 bg-none border border-(--border) rounded-md text-(--text-muted) cursor-pointer text-[13px]"
          >
             {t("i18n.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
