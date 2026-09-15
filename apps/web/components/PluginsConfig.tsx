"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sendAgentCommand } from "@/lib/agent-client";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { PluginPackageInfo, PluginsResponse } from "@/lib/api-types";
import { useI18n } from "@/hooks/useI18n";
import { pluginsService } from "@/services/plugins.service";
import { TAGS } from "@/services/tags";

type PluginScope = PluginPackageInfo["scope"];
type PluginAction = "install" | "remove" | "update" | "disable" | "enable";

function shortenPath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+/, "~");
}

function normalizePluginSourceInput(value: string): string {
  const match = value.trim().match(/^\$?\s*pi\s+install\s+(\S+)\s*$/);
  return match?.[1] ?? value;
}

function packageKey(pkg: Pick<PluginPackageInfo, "source" | "scope">): string {
  return `${pkg.scope}\0${pkg.source}`;
}

function resourceSummary(pkg: PluginPackageInfo, t: ReturnType<typeof useI18n>["t"]): string {
  if (pkg.disabled) return t("i18n.disabled");
  const parts = [
    pkg.counts.extensions ? t("i18n.resourceCount", { count: pkg.counts.extensions, label: t("i18n.extensionShort") }) : "",
    pkg.counts.skills ? t("i18n.resourceCount", { count: pkg.counts.skills, label: t("i18n.skillShort") }) : "",
    pkg.counts.prompts ? t("i18n.resourceCount", { count: pkg.counts.prompts, label: t("i18n.promptShort") }) : "",
    pkg.counts.themes ? t("i18n.resourceCount", { count: pkg.counts.themes, label: t("i18n.themeShort") }) : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : t("i18n.noResources");
}

function versionSummary(pkg: PluginPackageInfo, t: ReturnType<typeof useI18n>["t"]): string {
  const parts = [];
  if (pkg.version) parts.push(t("i18n.installedVersion", { version: pkg.version }));
  if (pkg.configuredVersion) parts.push(t("i18n.configuredVersion", { version: pkg.configuredVersion }));
  return parts.length ? parts.join(" · ") : t("i18n.unknown");
}

function installLocation(scope: PluginScope, cwd: string): string {
  return scope === "project"
    ? `${shortenPath(cwd)}/.pi/agent/{npm,git}`
    : "~/.pi/agent/{npm,git}";
}

function findInstalledPackage(
  packages: PluginPackageInfo[],
  source: string,
  scope: PluginScope,
): PluginPackageInfo | undefined {
  const trimmed = source.trim();
  const withoutNpmPrefix = trimmed.startsWith("npm:") ? trimmed.slice(4) : trimmed;
  return packages.find((pkg) => pkg.scope === scope && pkg.source === trimmed)
    ?? packages.find((pkg) => pkg.scope === scope && pkg.source === `npm:${withoutNpmPrefix}`)
    ?? packages.find((pkg) => pkg.scope === scope && pkg.source.endsWith(trimmed));
}

function statusColor(status: PluginPackageInfo["status"]): string {
  if (status === "loaded") return "var(--accent)";
  if (status === "installed") return "#f59e0b";
  if (status === "disabled") return "var(--text-dim)";
  return "var(--state-error)";
}

function ResourceList({ pkg }: { pkg: PluginPackageInfo }) {
  const { t } = useI18n();
  const groups = ([
    ["extension", t("i18n.extensions")],
    ["skill", t("i18n.skills")],
    ["prompt", t("i18n.prompts")],
    ["theme", t("i18n.themes")],
  ] as const)
    .map(([kind, label]) => ({
      kind,
      label,
      resources: pkg.resources.filter((resource) => resource.kind === kind),
    }))
    .filter((group) => group.resources.length > 0);

  if (groups.length === 0) {
    return (
      <div className="text-xs text-(--text-dim)">
        {pkg.disabled ? t("i18n.packageDisabled") : t("i18n.noResolvedResources")}
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-3"
    >
      {groups.map((group, groupIndex) => (
        <div
          key={group.kind}
          className={`${groupIndex === 0 ? "border-t-0" : "border-t border-(--border)"} ${groupIndex === 0 ? "pt-0" : "pt-3"}`}
        >
          <div
            className="text-[11px] font-bold text-(--text-dim) uppercase tracking-[0.04em] mb-1.5"
          >
            {group.label}
          </div>
          <div className="flex flex-col gap-6">
            {group.resources.map((resource) => (
              <div key={`${resource.kind}:${resource.path}`} className="min-w-0">
                <div
                  className="text-xs text-(--text) font-(--font-mono) overflow-hidden text-ellipsis whitespace-nowrap"
                  title={resource.path}
                >
                  {resource.name}
                </div>
                <div
                  className="text-[11px] text-(--text-dim) font-(--font-mono) overflow-hidden text-ellipsis whitespace-nowrap mt-0.5"
                  title={resource.path}
                >
                  {resource.relativePath}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ScopeTag({ scope }: { scope: PluginScope }) {
  return (
    <span
      className={`text-[11px] py-[1px] px-1.5 rounded-[3px] shrink-0 ${scope === "project" ? "bg-indigo-500/15" : "bg-black/10"} ${scope === "project" ? "text-indigo-500/85" : "text-(--text-dim)"}`}
    >
      {scope}
    </span>
  );
}

function buttonStyle(disabled?: boolean, danger?: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    background: danger ? "rgba(239,68,68,0.08)" : "none",
    border: "1px solid var(--border)",
    borderRadius: 6,
    color: danger ? "var(--state-error)" : "var(--text-muted)",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 12,
    opacity: disabled ? 0.5 : 1,
  };
}

function Toggle({
  enabled,
  loading,
  onToggle,
  label,
}: {
  enabled: boolean;
  loading: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={loading}
      title={label}
      aria-label={label}
      aria-pressed={enabled}
      className={`shrink-0 w-[40px] h-[22px] rounded-[11px] border-none p-0 relative transition-colors duration-150 outline-none ${loading ? "cursor-wait" : "cursor-pointer"} ${enabled ? "bg-(--accent)" : "bg-(--border)"} ${loading ? "opacity-[0.65]" : ""}`}
    >
      <span
        className={`absolute top-[3px] w-[16px] h-[16px] rounded-full bg-(--bg) shadow-[0_1px_4px_rgba(0,0,0,0.22)] transition-[left] duration-[0.18s] ease-[cubic-bezier(.4,0,.2,1)] ${enabled ? "left-[21px]" : "left-[3px]"}`}
      />
    </button>
  );
}

function SegmentedScope({
  value,
  projectResourcesLoaded,
  onChange,
}: {
  value: PluginScope;
  projectResourcesLoaded: boolean;
  onChange: (scope: PluginScope) => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className="inline-flex border border-(--border) rounded-[7px] overflow-hidden h-[30px]"
    >
      {(["global", "project"] as PluginScope[]).map((scope) => {
        const active = value === scope;
        const disabled = scope === "project" && !projectResourcesLoaded;
        return (
          <button
            key={scope}
            onClick={() => {
              if (!disabled) onChange(scope);
            }}
            disabled={disabled}
            title={disabled ? t("trust.projectScopeUnavailable") : undefined}
            className={`w-[76px] border-none text-xs ${scope === "global" ? "border-r border-(--border)" : "border-r-0"} ${active ? "bg-(--bg-selected)" : "bg-none"} ${active ? "text-(--text)" : "text-(--text-muted)"} ${disabled ? "cursor-not-allowed" : "cursor-pointer"} ${disabled ? "opacity-[0.45]" : ""}`}
          >
            {scope}
          </button>
        );
      })}
    </div>
  );
}

function AddPluginPanel({
  cwd,
  source,
  scope,
  projectResourcesLoaded,
  busy,
  actionError,
  onSourceChange,
  onScopeChange,
  onInstall,
}: {
  cwd: string;
  source: string;
  scope: PluginScope;
  projectResourcesLoaded: boolean;
  busy: boolean;
  actionError: string | null;
  onSourceChange: (value: string) => void;
  onScopeChange: (scope: PluginScope) => void;
  onInstall: () => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const examples = ["npm:@scope/pi-plugin", "git:https://github.com/user/repo", "/absolute/path/to/plugin"];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="flex flex-col gap-[18px] max-w-[660px] min-h-full">
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm font-bold text-(--text)">
            {t("i18n.addPlugin")}
          </div>
          <a
            href="https://pi.dev/packages"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-[5px] text-(--accent) text-xs no-underline whitespace-nowrap"
          >
            <svg width="28" height="28" viewBox="0 0 800 800" aria-hidden="true" focusable="false" className="shrink-0">
              <path
                fill="#000"
                fillRule="evenodd"
                d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"
              />
              <path fill="#000" d="M517.36 400H634.72V634.72H517.36Z" />
            </svg>
            pi.dev/packages
          </a>
        </div>
        <div className="text-xs text-(--text-dim) font-(--font-mono)">
          {installLocation(scope, cwd)}
        </div>
      </div>

      <div className="flex flex-col gap-7">
        <label htmlFor="plugin-source" className="text-xs font-semibold text-(--text-muted)">
          Source
        </label>
        <input
          id="plugin-source"
          ref={inputRef}
          value={source}
          onChange={(e) => onSourceChange(e.target.value)}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text");
            const normalized = normalizePluginSourceInput(pasted);
            if (normalized === pasted) return;
            e.preventDefault();
            onSourceChange(normalized);
          }}
          onBlur={(e) => onSourceChange(normalizePluginSourceInput(e.currentTarget.value))}
          placeholder="npm:@scope/package"
          className="w-full h-[36px] py-0 px-[11px] border border-(--border) rounded-md bg-(--bg-panel) text-(--text) font-(--font-mono) text-[13px] outline-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && source.trim() && !busy) onInstall();
          }}
        />
      </div>

      <div className="flex items-center gap-2.5 flex-wrap">
        <SegmentedScope
          value={scope}
          projectResourcesLoaded={projectResourcesLoaded}
          onChange={onScopeChange}
        />
        <button
          type="button"
          onClick={onInstall}
          disabled={busy || !source.trim()}
          style={{
            ...buttonStyle(busy || !source.trim()),
            background: "var(--accent)",
            color: "white",
            borderColor: "var(--accent)",
          }}
        >
          {busy ? t("i18n.installing") : t("i18n.install")}
        </button>
      </div>

      <div className="flex flex-col gap-7">
        <div className="text-xs font-semibold text-(--text-muted)">
          Examples
        </div>
        <div className="flex flex-col gap-6">
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => onSourceChange(example)}
              className="w-full min-h-[30px] text-left py-1.5 px-[9px] border border-(--border) rounded-md bg-(--bg-panel) text-(--text-dim) cursor-pointer font-(--font-mono) text-[11px]"
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text-muted)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--bg-panel)";
                e.currentTarget.style.color = "var(--text-dim)";
              }}
            >
              {example}
            </button>
          ))}
        </div>
      </div>

      {actionError && (
        <div className="text-xs text-(--state-error) whitespace-pre-wrap leading-[1.5]">
          {actionError}
        </div>
      )}
    </div>
  );
}

function PackageDetail({
  pkg,
  cwd,
  busyKey,
  actionError,
  actionMessage,
  sessionId,
  onAction,
  onReloadSession,
}: {
  pkg: PluginPackageInfo;
  cwd: string;
  busyKey: string | null;
  actionError: string | null;
  actionMessage: string | null;
  sessionId: string | null;
  onAction: (action: PluginAction, pkg: PluginPackageInfo) => void;
  onReloadSession: () => void;
}) {
  const { t } = useI18n();
  const key = packageKey(pkg);
  const busy = busyKey?.endsWith(key) ?? false;
  const reloadBusy = busyKey === "reload";
  const enabled = !pkg.disabled;

  return (
    <div className="flex flex-col gap-20 max-w-[680px]">
      <div className="flex items-start justify-between gap-3 min-w-0 flex-wrap">
        <div className="flex items-center gap-2 min-w-[180px] flex-1">
          <Toggle
            enabled={enabled}
            loading={busy || reloadBusy}
            onToggle={() => onAction(pkg.disabled ? "enable" : "disable", pkg)}
            label={pkg.disabled ? t("i18n.enablePackage") : t("i18n.disablePackage")}
          />
          <ScopeTag scope={pkg.scope} />
          {pkg.disabled ? (
            <span
              className="text-[11px] py-[1px] px-[5px] rounded-[3px] bg-black/10 text-(--text-dim)"
            >
              {t("i18n.disabled")}
            </span>
          ) : pkg.filtered && (
            <span
              className="text-[11px] py-[1px] px-[5px] rounded-[3px] bg-amber-500/15 text-(--state-warning)"
            >
              {t("i18n.filtered")}
            </span>
          )}
          <span
            className="font-(--font-mono) text-xs text-(--text) overflow-hidden text-ellipsis whitespace-nowrap"
          >
            {pkg.source}
          </span>
        </div>

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => onAction("update", pkg)}
            disabled={busy || reloadBusy}
            style={buttonStyle(busy || reloadBusy)}
          >
             {busyKey === `update:${key}` ? t("i18n.updating") : t("i18n.update")}
          </button>
          <button
            onClick={onReloadSession}
            disabled={!sessionId || reloadBusy || busy}
            style={buttonStyle(!sessionId || reloadBusy || busy)}
             title={sessionId ? t("i18n.reloadSession") : t("i18n.openSessionToReload")}
          >
             {reloadBusy ? t("i18n.reloading") : t("i18n.reloadSession")}
          </button>
          <button
            onClick={() => onAction("remove", pkg)}
            disabled={busy || reloadBusy}
            style={buttonStyle(busy || reloadBusy, true)}
          >
             {busyKey === `remove:${key}` ? t("i18n.removing") : t("i18n.remove")}
          </button>
        </div>
      </div>

      <div
        className="grid grid-cols-[minmax(96px,_130px)_minmax(0,_1fr)] gap-y-[9px] gap-x-3.5 text-xs leading-[1.45]"
      >
        <div className="text-(--text-dim)">{t("i18n.status")}</div>
        <div style={{ color: statusColor(pkg.status), textTransform: "capitalize" }}>{pkg.status}</div>
        <div className="text-(--text-dim)">{t("i18n.version")}</div>
         <div className="text-(--text-muted) font-(--font-mono)">{versionSummary(pkg, t)}</div>
        <div className="text-(--text-dim)">{t("i18n.package")}</div>
        <div className="text-(--text-muted) font-(--font-mono) [overflow-wrap:anywhere]">
          {pkg.packageName ?? t("i18n.unknown")}
        </div>
        <div className="text-(--text-dim)">{t("i18n.resources")}</div>
         <div className="text-(--text-muted)">{resourceSummary(pkg, t)}</div>
        <div className="text-(--text-dim)">{t("i18n.installedPath")}</div>
        <div
          className={`font-(--font-mono) [overflow-wrap:anywhere] ${pkg.installedPath ? "text-(--text-muted)" : "text-(--state-error)"}`}
        >
          {pkg.installedPath ? shortenPath(pkg.installedPath) : t("i18n.notFound")}
        </div>
        <div className="text-(--text-dim)">{t("i18n.cwd")}</div>
        <div className="text-(--text-dim) font-(--font-mono) [overflow-wrap:anywhere]">
          {shortenPath(cwd)}
        </div>
      </div>

      <div className="flex flex-col gap-8">
        <div className="text-xs font-bold text-(--text)">
          {t("i18n.resolvedResources")}
        </div>
        <ResourceList pkg={pkg} />
      </div>

      {actionMessage && (
        <div className="text-xs text-(--state-success)">
          {actionMessage}
        </div>
      )}
      {actionError && (
        <div className="text-xs text-(--state-error) whitespace-pre-wrap leading-[1.5]">
          {actionError}
        </div>
      )}
    </div>
  );
}

export function PluginsConfig({
  cwd,
  sessionId,
  onClose,
  onReloaded,
}: {
  cwd: string;
  sessionId: string | null;
  onClose: () => void;
  onReloaded?: () => void;
}) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const {
    data,
    isFetching,
    error: queryError,
    refetch,
  } = useQuery(pluginsService.byCwdQueryOptions(cwd));
  const loading = isFetching;
  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : String(queryError)
    : null;
  const [selected, setSelected] = useState<string | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [installSource, setInstallSource] = useState("");
  const [installScope, setInstallScope] = useState<PluginScope>("global");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const packages = useMemo(() => data?.packages ?? [], [data?.packages]);
  const selectedPackage = packages.find((pkg) => packageKey(pkg) === selected) ?? null;
  const projectResourcesLoaded = data?.projectResourcesLoaded ?? true;

  const groupedPackages = useMemo(() => {
    return (["project", "global"] as PluginScope[])
      .map((scope) => ({ scope, packages: packages.filter((pkg) => pkg.scope === scope) }))
      .filter((group) => group.packages.length > 0);
  }, [packages]);

  const loadPlugins = useCallback(() => {
    void refetch();
  }, [refetch]);

  // Selection / add-mode defaults once the (cached) list arrives. Fetch
  // itself lives in the TanStack Query cache — remounts are instant.
  useEffect(() => {
    if (!data) return;
    setAddMode((current) => data.packages.length === 0 || current);
    setSelected((current) => {
      if (current && data.packages.some((pkg) => packageKey(pkg) === current)) return current;
      return data.packages[0] ? packageKey(data.packages[0]) : null;
    });
  }, [data]);

  const writePlugins = useCallback(
    (next: PluginsResponse) => {
      queryClient.setQueryData(TAGS.plugins.byCwd(cwd), next);
    },
    [queryClient, cwd],
  );

  const runAction = useCallback(async (action: PluginAction, pkg: PluginPackageInfo) => {
    const key = packageKey(pkg);
    setBusyKey(`${action}:${key}`);
    setActionError(null);
    setActionMessage(null);
    try {
      const res = await fetch("/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, source: pkg.source, scope: pkg.scope, cwd }),
      });
      const next = (await res.json()) as PluginsResponse & { error?: string };
      if (!res.ok || next.error) throw new Error(next.error ?? `HTTP ${res.status}`);
      writePlugins(next);
      if (action === "remove") {
        setSelected(next.packages[0] ? packageKey(next.packages[0]) : null);
        if (next.packages.length === 0) setAddMode(true);
        setActionMessage("Package removed.");
      } else {
        const messages: Record<Exclude<PluginAction, "remove">, string> = {
          install: "Package installed.",
          update: "Package updated.",
          disable: "Package disabled.",
          enable: "Package enabled.",
        };
        setActionMessage(messages[action]);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }, [cwd, writePlugins]);

  const installPlugin = useCallback(async () => {
    const source = normalizePluginSourceInput(installSource).trim();
    if (!source) return;
    setInstallSource(source);
    const key = `${installScope}\0${source}`;
    setBusyKey(`install:${key}`);
    setActionError(null);
    setActionMessage(null);
    try {
      const res = await fetch("/api/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "install", source, scope: installScope, cwd }),
      });
      const next = (await res.json()) as PluginsResponse & { error?: string };
      if (!res.ok || next.error) throw new Error(next.error ?? `HTTP ${res.status}`);
      writePlugins(next);
      const installed = findInstalledPackage(next.packages, source, installScope);
      setSelected(installed ? packageKey(installed) : key);
      setAddMode(false);
      setInstallSource("");
      setActionMessage("Package installed.");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }, [cwd, installScope, installSource, writePlugins]);

  const reloadSession = useCallback(async () => {
    if (!sessionId) return;
    setBusyKey("reload");
    setActionError(null);
    setActionMessage(null);
    try {
      await sendAgentCommand(sessionId, { type: "reload" });
      onReloaded?.();
      await loadPlugins();
      setActionMessage("Session reloaded.");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }, [loadPlugins, onReloaded, sessionId]);

  const addBusy = busyKey?.startsWith("install:") ?? false;

  return (
    <div
      className="fixed inset-0 z-[1000] bg-black/35 flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: isMobile ? "calc(100vw - 16px)" : 860,
          maxWidth: "calc(100vw - 16px)",
          height: isMobile ? "calc(100dvh - 16px)" : "76vh",
          maxHeight: "calc(100dvh - 16px)",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          overflow: "hidden",
        }}
      >
        <div
          className="flex items-center justify-between py-3 px-[18px] border-b border-(--border) shrink-0"
        >
          <div className="flex items-baseline gap-10 min-w-0">
            <span className="text-[15px] font-bold text-(--text)">
              {t("common.plugins")}
            </span>
            <code
              className="text-[11px] text-(--text-muted) font-(--font-mono) overflow-hidden text-ellipsis whitespace-nowrap"
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
            className="py-2 px-[18px] border-b border-(--border) bg-(--bg-panel) text-(--text-muted) text-xs"
          >
            {t("trust.pluginsNotLoaded")}
          </div>
        )}

        <div className={`flex-1 flex overflow-hidden ${isMobile ? "flex-col" : "flex-row"}`}>
          <div
            style={{
              width: isMobile ? "100%" : 245,
              maxHeight: isMobile ? "40vh" : undefined,
              borderRight: isMobile ? "none" : "1px solid var(--border)",
              borderBottom: isMobile ? "1px solid var(--border)" : "none",
              display: "flex",
              flexDirection: "column",
              flexShrink: 0,
              background: "var(--bg-panel)",
            }}
          >
            <div className="flex-1 overflow-y-auto py-2 px-1.5">
              {loading ? (
                <div className="py-2.5 px-2 text-xs text-(--text-muted)">
                  Loading...
                </div>
              ) : error ? (
                <div className="py-2.5 px-2 text-[11px] text-(--state-error)">
                  {error}
                </div>
              ) : packages.length === 0 ? (
                <div className="py-2.5 px-2 text-[11px] text-(--text-dim)">
                  No plugins configured
                </div>
              ) : (
                groupedPackages.map((group) => (
                  <div key={group.scope} className="mb-6">
                    <div
                      className="pt-1 px-2 pb-[3px] text-[11px] font-semibold text-(--text-dim) uppercase"
                    >
                      {group.scope}
                    </div>
                    {group.packages.map((pkg) => {
                      const key = packageKey(pkg);
                      const isSelected = !addMode && selected === key;
                      return (
                        <div
                          key={key}
                          onClick={() => {
                            setSelected(key);
                            setAddMode(false);
                            setActionError(null);
                            setActionMessage(null);
                          }}
                          className={`flex items-center gap-[7px] py-2 px-2 rounded-[5px] cursor-pointer ${isSelected ? "bg-(--bg-selected)" : "bg-none"}`}
                          onMouseEnter={(e) => {
                            if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)";
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) e.currentTarget.style.background = "none";
                          }}
                        >
                          <span
                            style={{
                              flexShrink: 0,
                              width: 7,
                              height: 7,
                              borderRadius: "50%",
                              background: statusColor(pkg.status),
                            }}
                          />
                          <div className="min-w-0 flex-1">
                            <div
                              className={`text-xs text-(--text) font-(--font-mono) overflow-hidden text-ellipsis whitespace-nowrap ${isSelected ? "font-semibold" : ""}`}
                            >
                              {pkg.source}
                            </div>
                            <div
                              className="text-[11px] text-(--text-dim) overflow-hidden text-ellipsis whitespace-nowrap mt-0.5"
                            >
                              {resourceSummary(pkg, t)}
                            </div>
                            {(pkg.version || pkg.configuredVersion) && (
                              <div
                                className="text-[11px] text-(--text-dim) overflow-hidden text-ellipsis whitespace-nowrap mt-0.5"
                              >
                                 {versionSummary(pkg, t)}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
            <div className="py-2 px-1.5 border-t border-(--border) shrink-0">
              <button
                type="button"
                onClick={() => {
                  setAddMode(true);
                  setActionError(null);
                  setActionMessage(null);
                }}
                className={`flex items-center gap-1.5 py-[7px] px-2 rounded-[5px] border-none w-full cursor-pointer text-xs ${addMode ? "bg-(--bg-selected)" : "bg-none"} ${addMode ? "text-(--accent)" : "text-(--text-dim)"}`}
                onMouseEnter={(e) => {
                  if (!addMode) e.currentTarget.style.background = "var(--bg-hover)";
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
                 {t("i18n.addPlugin")}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {addMode ? (
              <AddPluginPanel
                cwd={cwd}
                source={installSource}
                scope={installScope}
                projectResourcesLoaded={projectResourcesLoaded}
                busy={addBusy}
                actionError={actionError}
                onSourceChange={setInstallSource}
                onScopeChange={setInstallScope}
                onInstall={installPlugin}
              />
            ) : loading ? null : selectedPackage ? (
              <PackageDetail
                key={packageKey(selectedPackage)}
                pkg={selectedPackage}
                cwd={cwd}
                busyKey={busyKey}
                actionError={actionError}
                actionMessage={actionMessage}
                sessionId={sessionId}
                onAction={runAction}
                onReloadSession={reloadSession}
              />
            ) : (
              <div
                className="h-full flex items-center justify-center text-(--text-dim) text-[13px]"
              >
                {t("i18n.selectPackage")}
              </div>
            )}
          </div>
        </div>

        <div
          className="flex items-center justify-between gap-3 py-2.5 px-[18px] border-t border-(--border) shrink-0"
        >
          <div className="min-w-0 flex-1 text-[11px] text-(--text-dim) overflow-hidden">
            {data?.diagnostics.length ? (
              <span
                title={data.diagnostics.map((d) => `${d.type}: ${d.source ? `${d.source}: ` : ""}${d.message}`).join("\n")}
                className={`${data.diagnostics.some((d) => d.type === "error") ? "text-(--state-error)" : "text-(--state-warning)"}`}
              >
                {data.diagnostics.length} diagnostic{data.diagnostics.length === 1 ? "" : "s"}
              </span>
            ) : (
              <span>
                {data ? `${data.totals.extensions} ext · ${data.totals.skills} skills · ${data.totals.prompts} prompts · ${data.totals.themes} themes` : ""}
              </span>
            )}
          </div>
          <button onClick={() => void loadPlugins()} disabled={loading || busyKey !== null} style={buttonStyle(loading || busyKey !== null)}>
             {t("i18n.refresh")}
          </button>
          <button onClick={onClose} style={buttonStyle(false)}>
             {t("i18n.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
