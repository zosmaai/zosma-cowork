"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { ModelsContent, PluginsContent, SkillsContent } from "./SettingsContent";
import type { ZosmaNotice } from "./ZosmaAuthCard";

export type SettingsCategory =
  | "models"
  | "plugins"
  | "skills"
  | "appearance"
  | "language"
  | "defaults";

interface SettingsShellProps {
  onClose: () => void;
  cwd: string;
  sessionId: string | null;
  onReloaded?: () => void;
  onModelsRefresh?: () => void;
  initialCategory?: SettingsCategory;
  zosmaNotice?: ZosmaNotice | null;
}

const CATEGORIES: { id: SettingsCategory; icon: React.ReactNode }[] = [
  {
    id: "models",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" />
        <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
        <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
        <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
        <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
      </svg>
    ),
  },
  {
    id: "plugins",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 7V2" /><path d="M15 7V2" />
        <path d="M6 13V8a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v5a6 6 0 0 1-12 0Z" />
        <path d="M12 19v3" />
      </svg>
    ),
  },
  {
    id: "skills",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    ),
  },
  {
    id: "appearance",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2" /><path d="M12 20v2" /><path d="M4.93 4.93l1.41 1.41" />
        <path d="M17.66 17.66l1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" />
        <path d="M6.34 17.66l-1.41 1.41" /><path d="M19.07 4.93l-1.41 1.41" />
      </svg>
    ),
  },
  {
    id: "language",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m5 8 6 6" /><path d="m4 14 6-6 2-3" />
        <path d="M2 5h12" /><path d="M7 2h1" />
        <path d="m22 22-5-10-5 10" /><path d="M14 18h6" />
      </svg>
    ),
  },
  {
    id: "defaults",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    ),
  },
];

const FOCUSABLE_SELECTOR = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

function AppearanceSection() {
  const { preference, setTheme } = useTheme();
  const { t } = useI18n();
  const options: { value: typeof preference; label: string }[] = [
    { value: "light", label: t("theme.light") },
    { value: "dark", label: t("theme.dark") },
    { value: "auto", label: t("theme.auto") },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
        {t("settings.categories.appearance")}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Theme</div>
        <div style={{ display: "flex", gap: 8 }}>
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => preference !== opt.value && setTheme(opt.value)}
              style={{
                padding: "8px 16px",
                borderRadius: 6,
                border: `1px solid ${preference === opt.value ? "var(--accent)" : "var(--border)"}`,
                background: preference === opt.value ? "var(--accent)" : "var(--bg-panel)",
                color: preference === opt.value ? "#fff" : "var(--text-muted)",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: preference === opt.value ? 600 : 400,
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function LanguageSection() {
  const { locale, setLocale, t, supportedLocales } = useI18n();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
        {t("settings.categories.language")}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {supportedLocales.map((plugin) => (
          <button
            key={plugin.id}
            onClick={() => setLocale(plugin.id as typeof locale)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 12px",
              borderRadius: 6,
              border: `1px solid ${locale === plugin.id ? "var(--accent)" : "var(--border)"}`,
              background: locale === plugin.id ? "var(--bg-selected)" : "var(--bg-panel)",
              color: locale === plugin.id ? "var(--text)" : "var(--text-muted)",
              cursor: "pointer",
              fontSize: 12,
              textAlign: "left",
              width: "100%",
            }}
          >
            <span style={{ fontWeight: locale === plugin.id ? 600 : 400 }}>
              {plugin.label}
            </span>
            {locale === plugin.id && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: "auto" }}>
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function DefaultsSection() {
  const { t } = useI18n();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
        {t("settings.categories.defaults")}
      </div>
      <p style={{ margin: 0, fontSize: 12, color: "var(--text-dim)", lineHeight: 1.6 }}>
        Default model, thinking level, and tool preset preferences are configured per-session in the composer. Session-level settings override these defaults.
      </p>
    </div>
  );
}

export function SettingsShell({
  onClose,
  cwd,
  sessionId,
  onReloaded,
  onModelsRefresh,
  initialCategory = "models",
  zosmaNotice,
}: SettingsShellProps) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>(initialCategory);
  const categoryListRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const handleClose = useCallback(() => {
    onModelsRefresh?.();
    onClose();
  }, [onClose, onModelsRefresh]);

  // Focus dialog on open and restore previous focus on close.
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    const frame = requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      previousFocusRef.current?.focus();
    };
  }, []);

  // Escape key closes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [handleClose]);

  const handleDialogKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      .filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) {
      e.preventDefault();
    } else if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  // Category keyboard navigation
  const handleCategoryKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const idx = CATEGORIES.findIndex((c) => c.id === activeCategory);
      let nextIdx: number | undefined;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        nextIdx = (idx + 1) % CATEGORIES.length;
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        nextIdx = (idx - 1 + CATEGORIES.length) % CATEGORIES.length;
      } else if (e.key === "Home") {
        nextIdx = 0;
      } else if (e.key === "End") {
        nextIdx = CATEGORIES.length - 1;
      }
      if (nextIdx === undefined) return;
      e.preventDefault();
      setActiveCategory(CATEGORIES[nextIdx].id);
      categoryListRef.current?.querySelectorAll<HTMLButtonElement>("[role='tab']")[nextIdx]?.focus();
    },
    [activeCategory],
  );

  const renderContent = () => {
    switch (activeCategory) {
      case "models":
        return <ModelsContent onClose={handleClose} zosmaNotice={zosmaNotice} />;
      case "plugins":
        return (
          <PluginsContent
            cwd={cwd}
            sessionId={sessionId}
            onClose={handleClose}
            onReloaded={onReloaded}
          />
        );
      case "skills":
        return <SkillsContent cwd={cwd} onClose={handleClose} />;
      case "appearance":
        return <AppearanceSection />;
      case "language":
        return <LanguageSection />;
      case "defaults":
        return <DefaultsSection />;
      default:
        return null;
    }
  };

  return (
    <div
      className="settings-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`settings-modal ${isMobile ? "settings-modal--mobile" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={t("common.settings")}
        onKeyDown={handleDialogKeyDown}
      >
        {/* Header */}
        <div className="settings-modal-header">
          <span className="settings-modal-title">{t("common.settings")}</span>
          <button
            onClick={handleClose}
            className="settings-modal-close"
            aria-label={t("i18n.close")}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="settings-modal-body">
          {/* Left: category nav */}
          <nav
            ref={categoryListRef}
            className={`settings-categories ${isMobile ? "settings-categories--mobile" : ""}`}
            role="tablist"
            aria-label={t("common.settings")}
            onKeyDown={handleCategoryKeyDown}
          >
            {CATEGORIES.map((cat) => {
              const isActive = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  role="tab"
                  aria-selected={isActive}
                  aria-current={isActive ? "page" : undefined}
                  tabIndex={isActive ? 0 : -1}
                  className={`settings-category-item ${isActive ? "settings-category-item--active" : ""}`}
                  onClick={() => setActiveCategory(cat.id)}
                >
                  <span className="settings-category-icon">{cat.icon}</span>
                  <span className="settings-category-label">
                    {t(`settings.categories.${cat.id}`)}
                  </span>
                </button>
              );
            })}
          </nav>

          {/* Right: content pane */}
          <div
            className="settings-content-pane"
            role="tabpanel"
            aria-label={t(`settings.categories.${activeCategory}`)}
          >
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  );
}
