# Phase 5: Unified DeepSeek-Style Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace three separate settings modals (Models, Plugins, Skills) with a single responsive, blurred-backdrop, two-column DeepSeek-style settings modal that also surfaces theme, language, and default preference controls.

**Architecture:** Create a `SettingsShell` component that provides the shared modal chrome (blurred backdrop, header, two-column body, mobile single-column). Extract inner content from each existing config component as new `*Content` exports (keeping existing modal exports intact for backward compat). Wire AppShell to open a single unified settings modal with category navigation. Preserve all existing async state, OAuth/API-key flows, model config, plugin operations, skill toggles, and validation.

**Tech Stack:** React (client components), TypeScript, existing CSS variable system, `useTheme` hook, `useI18n` hook, Node test runner with source-text assertions.

**Roadmap:** `docs/superpowers/roadmaps/2026-08-22-deepseek-style-zosma-dashboard-roadmap.md`

**Phase:** Phase 5: Unified DeepSeek-Style Settings

---

## File Map

```
Create:
  components/SettingsShell.tsx         — unified settings modal shell + category navigation

Modify:
  components/ModelsConfig.tsx          — add ModelsContent export (inner content without outer modal)
  components/PluginsConfig.tsx         — add PluginsContent export (inner content without outer modal)
  components/SkillsConfig.tsx          — add SkillsContent export (inner content without outer modal)
  components/AppShell.tsx              — replace 3 modal states with 1 unified settings state
  app/globals.css                      — add settings modal blurred backdrop + category nav styles
  lib/i18n/messages/en.ts             — add category label i18n keys

Test:
  components/SettingsShell.test.mjs    — source-text assertions for category nav, ARIA, escape, focus
  components/ModelsConfig.test.mjs     — verify ModelsContent export exists
```

---

## Task 1: Add i18n Keys for Settings Categories

**Files:**
- Modify: `lib/i18n/messages/en.ts`

- [ ] **Step 1: Add category label keys**

Append after the existing `"common.plugins": "Plugins"` line:

```ts
"common.settings": "Settings",
"settings.categories.models": "Models & Providers",
"settings.categories.plugins": "Plugins",
"settings.categories.skills": "Skills",
"settings.categories.appearance": "Appearance",
"settings.categories.language": "Language",
"settings.categories.defaults": "Defaults",
```

- [ ] **Step 2: Verify no duplicate keys**

Run: `grep -c "settings.categories" lib/i18n/messages/en.ts`
Expected: `6`

- [ ] **Step 3: Commit**

```bash
git add lib/i18n/messages/en.ts
git commit -m "feat: add i18n keys for unified settings categories"
```

---

## Task 2: Extract ModelsConfig Inner Content

**Files:**
- Modify: `components/ModelsConfig.tsx` — add `ModelsContent` export at bottom, before `ModelsConfig`

The strategy: The existing `ModelsConfig` renders its own outer `<div>` (fixed backdrop) and inner modal. We add a new `ModelsContent` export that renders only the header + body + footer (no outer fixed div). This is done by extracting the existing return JSX into a helper function, then having both `ModelsConfig` and `ModelsContent` use it.

- [ ] **Step 1: Add ModelsContent export**

At the end of `ModelsConfig.tsx`, after the closing `}` of `ModelsConfig`, add:

```tsx
/**
 * Inner content of ModelsConfig without the outer fixed-position modal wrapper.
 * Used by SettingsShell to render inside the unified settings modal.
 */
export function ModelsContent({ onClose }: { onClose: () => void }) {
  // ModelsConfig's entire body is self-contained — reuse it directly.
  // The outer modal wrapper in ModelsConfig renders a fixed backdrop div;
  // ModelsContent omits that wrapper and renders the same content tree.
  return <ModelsConfig onClose={onClose} />;
}
```

This is the minimal approach: `ModelsContent` delegates to `ModelsConfig` which already works. The outer wrapper in `ModelsConfig` is a fixed-position div that `SettingsShell` will replace. Since `ModelsConfig` renders its own modal, and `SettingsShell` renders its own modal, we need `ModelsContent` to NOT render the outer modal.

**Better approach:** Refactor `ModelsConfig` to accept an optional `embedded` prop:

In the `ModelsConfig` function signature, add `embedded?: boolean`:

```tsx
export function ModelsConfig({ onClose, embedded }: { onClose: () => void; embedded?: boolean }) {
```

Then wrap the outer fixed-position `<div>` in a conditional:

```tsx
  const modalContent = (
    <>
      {/* Header */}
      <div style={{ ... }}>...</div>
      {/* Body */}
      <div style={{ ... }}>...</div>
      {/* Footer */}
      <div style={{ ... }}>...</div>
    </>
  );

  if (embedded) return modalContent;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ ... }}>
        {modalContent}
      </div>
      {pickerOpen && <AddProviderPicker ... />}
    </div>
  );
}
```

And add the `ModelsContent` alias:

```tsx
export const ModelsContent = ModelsConfig;
```

- [ ] **Step 2: Verify ModelsContent export exists**

Run: `grep "ModelsContent" components/ModelsConfig.tsx`
Expected: matches found

- [ ] **Step 3: Run existing test**

Run: `npm test -- --test-name-pattern "ModelsConfig" 2>&1 || node --experimental-strip-types --test components/ModelsConfig.test.mjs`
Expected: PASS (source-text checks still work)

- [ ] **Step 4: Commit**

```bash
git add components/ModelsConfig.tsx
git commit -m "feat: add embedded prop and ModelsContent export to ModelsConfig"
```

---

## Task 3: Extract PluginsConfig Inner Content

**Files:**
- Modify: `components/PluginsConfig.tsx` — add `embedded` prop + `PluginsContent` export

Same pattern as Task 2.

- [ ] **Step 1: Add embedded prop to PluginsConfig**

Change signature:
```tsx
export function PluginsConfig({
  cwd,
  sessionId,
  onClose,
  onReloaded,
  embedded,
}: {
  cwd: string;
  sessionId: string | null;
  onClose: () => void;
  onReloaded?: () => void;
  embedded?: boolean;
}) {
```

Extract the modal content (header + body + footer) into a local JSX block, then conditionally render the outer wrapper:

```tsx
  const modalContent = (
    <>
      {/* Header */}
      <div style={{ ... }}>...</div>
      {/* Warning banner */}
      {!projectResourcesLoaded && <div ... />}
      {/* Body */}
      <div style={{ ... }}>...</div>
      {/* Footer */}
      <div style={{ ... }}>...</div>
    </>
  );

  if (embedded) return modalContent;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, ... }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ ... }}>
        {modalContent}
      </div>
    </div>
  );
```

Add alias:
```tsx
export const PluginsContent = PluginsConfig;
```

- [ ] **Step 2: Verify export**

Run: `grep "PluginsContent" components/PluginsConfig.tsx`
Expected: matches found

- [ ] **Step 3: Commit**

```bash
git add components/PluginsConfig.tsx
git commit -m "feat: add embedded prop and PluginsContent export to PluginsConfig"
```

---

## Task 4: Extract SkillsConfig Inner Content

**Files:**
- Modify: `components/SkillsConfig.tsx` — add `embedded` prop + `SkillsContent` export

Same pattern.

- [ ] **Step 1: Add embedded prop to SkillsConfig**

Change signature:
```tsx
export function SkillsConfig({
  cwd,
  onClose,
  embedded,
}: {
  cwd: string;
  onClose: () => void;
  embedded?: boolean;
}) {
```

Extract modal content, conditionally render outer wrapper, add alias:
```tsx
export const SkillsContent = SkillsConfig;
```

- [ ] **Step 2: Verify export**

Run: `grep "SkillsContent" components/SkillsConfig.tsx`
Expected: matches found

- [ ] **Step 3: Commit**

```bash
git add components/SkillsConfig.tsx
git commit -m "feat: add embedded prop and SkillsContent export to SkillsConfig"
```

---

## Task 5: Create SettingsShell Component

**Files:**
- Create: `components/SettingsShell.tsx`

This is the core new component. It provides:
- Blurred backdrop (`backdrop-filter: blur(8px)`)
- Header with title + close button
- Two-column body: left category nav, right content pane
- Mobile single-column: categories stacked above content
- Escape/backdrop click to close
- Category active state with `aria-current`
- Keyboard navigation (arrow keys in category list)

- [ ] **Step 1: Create SettingsShell.tsx**

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { ModelsContent } from "./ModelsConfig";
import { PluginsContent } from "./PluginsConfig";
import { SkillsContent } from "./SkillsConfig";

export type SettingsCategory =
  | "models"
  | "plugins"
  | "skills"
  | "appearance"
  | "language"
  | "defaults";

interface SettingsShellProps {
  onClose: () => void;
  /** The cwd for skill/plugin operations. */
  cwd: string;
  /** Current session ID for plugin reload. */
  sessionId: string | null;
  /** Called when plugin reload completes. */
  onReloaded?: () => void;
  /** Called after any auth/config change that should refresh models. */
  onModelsRefresh?: () => void;
  /** Initial category to show when modal opens. */
  initialCategory?: SettingsCategory;
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

function AppearanceSection() {
  const { preference, toggleTheme } = useTheme();
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
              onClick={() => {
                if (preference !== opt.value) toggleTheme();
              }}
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
}: SettingsShellProps) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>(initialCategory);
  const categoryListRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Save and restore focus
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    return () => {
      previousFocusRef.current?.focus();
    };
  }, []);

  // Escape key closes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Category keyboard navigation
  const handleCategoryKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const idx = CATEGORIES.findIndex((c) => c.id === activeCategory);
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        const next = CATEGORIES[(idx + 1) % CATEGORIES.length];
        setActiveCategory(next.id);
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        const prev = CATEGORIES[(idx - 1 + CATEGORIES.length) % CATEGORIES.length];
        setActiveCategory(prev.id);
      }
    },
    [activeCategory],
  );

  const renderContent = () => {
    switch (activeCategory) {
      case "models":
        return <ModelsContent onClose={onClose} embedded />;
      case "plugins":
        return (
          <PluginsContent
            cwd={cwd}
            sessionId={sessionId}
            onClose={onClose}
            onReloaded={onReloaded}
            embedded
          />
        );
      case "skills":
        return <SkillsContent cwd={cwd} onClose={onClose} embedded />;
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
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t("common.settings")}
    >
      <div className={`settings-modal ${isMobile ? "settings-modal--mobile" : ""}`}>
        {/* Header */}
        <div className="settings-modal-header">
          <span className="settings-modal-title">{t("common.settings")}</span>
          <button
            onClick={onClose}
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
```

- [ ] **Step 2: Verify component compiles**

Run: `node_modules/.bin/tsc --noEmit 2>&1 | head -20`
Expected: no errors (or only pre-existing errors)

- [ ] **Step 3: Commit**

```bash
git add components/SettingsShell.tsx
git commit -m "feat: add SettingsShell unified settings modal component"
```

---

## Task 6: Add Settings Modal CSS

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Append settings modal styles**

Add at the end of `globals.css`:

```css
/* ── Settings modal ────────────────────────────────────────────────────────── */

.settings-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
}

@media (prefers-reduced-motion: reduce) {
  .settings-modal-backdrop {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}

.settings-modal {
  width: 860px;
  max-width: calc(100vw - 32px);
  height: 78vh;
  max-height: calc(100dvh - 32px);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.22);
  overflow: hidden;
}

.settings-modal--mobile {
  width: calc(100vw - 16px);
  height: calc(100dvh - 16px);
  max-height: calc(100dvh - 16px);
  border-radius: 10px;
}

.settings-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.settings-modal-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
}

.settings-modal-close {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 22px;
  line-height: 1;
  padding: 2px 8px;
  border-radius: 4px;
  transition: background 0.12s, color 0.12s;
}

.settings-modal-close:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.settings-modal-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* Left: category navigation */
.settings-categories {
  width: 200px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  background: var(--bg-panel);
  display: flex;
  flex-direction: column;
  padding: 8px 6px;
  overflow-y: auto;
}

.settings-categories--mobile {
  width: 100%;
  flex-direction: row;
  border-right: none;
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
  overflow-y: hidden;
  padding: 6px;
  gap: 4px;
}

.settings-category-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-radius: 7px;
  border: none;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 13px;
  text-align: left;
  width: 100%;
  transition: background 0.12s, color 0.12s;
  white-space: nowrap;
}

.settings-categories--mobile .settings-category-item {
  width: auto;
  padding: 7px 12px;
  font-size: 12px;
}

.settings-category-item:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.settings-category-item--active {
  background: var(--bg-selected);
  color: var(--text);
  font-weight: 600;
}

.settings-category-item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.settings-category-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.settings-category-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Right: content pane */
.settings-content-pane {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  min-width: 0;
}

@media (max-width: 640px) {
  .settings-content-pane {
    padding: 16px;
  }
}
```

- [ ] **Step 2: Verify no CSS syntax errors**

Run: `cat app/globals.css | grep -c "settings-"`
Expected: >20

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "style: add settings modal blurred backdrop and category navigation CSS"
```

---

## Task 7: Wire SettingsShell into AppShell

**Files:**
- Modify: `components/AppShell.tsx`

- [ ] **Step 1: Add unified settings state**

Replace the three separate config states:
```tsx
const [modelsConfigOpen, setModelsConfigOpen] = useState(false);
const [skillsConfigOpen, setSkillsConfigOpen] = useState(false);
const [pluginsConfigOpen, setPluginsConfigOpen] = useState(false);
```

With a single state:
```tsx
const [settingsOpen, setSettingsOpen] = useState(false);
const [settingsInitialCategory, setSettingsInitialCategory] = useState<"models" | "plugins" | "skills">("models");
```

- [ ] **Step 2: Update sidebar button handlers**

Find the three button onClick handlers:
```tsx
onClick: () => setModelsConfigOpen(true),
onClick: () => setSkillsConfigOpen(true),
onClick: () => setPluginsConfigOpen(true),
```

Replace with:
```tsx
onClick: () => { setSettingsInitialCategory("models"); setSettingsOpen(true); },
onClick: () => { setSettingsInitialCategory("skills"); setSettingsOpen(true); },
onClick: () => { setSettingsInitialCategory("plugins"); setSettingsOpen(true); },
```

- [ ] **Step 3: Replace old modal renders with SettingsShell**

Find the three modal renders:
```tsx
{modelsConfigOpen && <ModelsConfig onClose={() => { setModelsConfigOpen(false); setModelsRefreshKey((k) => k + 1); }} />}
{skillsConfigOpen && projectTrustCwd && (
  <SkillsConfig cwd={projectTrustCwd} onClose={() => setSkillsConfigOpen(false)} />
)}
{pluginsConfigOpen && projectTrustCwd && (
  <PluginsConfig
    cwd={projectTrustCwd}
    sessionId={selectedSession?.id ?? null}
    onClose={() => setPluginsConfigOpen(false)}
    onReloaded={() => setSessionKey((k) => k + 1)}
  />
)}
```

Replace with:
```tsx
{settingsOpen && projectTrustCwd && (
  <SettingsShell
    onClose={() => setSettingsOpen(false)}
    cwd={projectTrustCwd}
    sessionId={selectedSession?.id ?? null}
    onReloaded={() => setSessionKey((k) => k + 1)}
    onModelsRefresh={() => setModelsRefreshKey((k) => k + 1)}
    initialCategory={settingsInitialCategory}
  />
)}
```

Note: We need to add `initialCategory` prop to `SettingsShell` (add to the interface and use as initial state).

- [ ] **Step 4: Add SettingsShell import**

Add to the imports at the top:
```tsx
import { SettingsShell } from "./SettingsShell";
```

- [ ] **Step 5: Verify no unused imports**

Run: `grep "ModelsConfig\|PluginsConfig\|SkillsConfig" components/AppShell.tsx | grep import`
Expected: no import lines for these (they're no longer used directly in AppShell)

- [ ] **Step 6: Run TypeScript check**

Run: `node_modules/.bin/tsc --noEmit 2>&1 | head -20`
Expected: no new errors

- [ ] **Step 7: Commit**

```bash
git add components/AppShell.tsx components/SettingsShell.tsx
git commit -m "feat: wire SettingsShell into AppShell, replace three config modals"
```

---

## Task 8: Add SettingsShell Tests

**Files:**
- Create: `components/SettingsShell.test.mjs`

- [ ] **Step 1: Create test file**

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("./SettingsShell.tsx", import.meta.url),
  "utf8",
);

test("SettingsShell renders blurred backdrop", () => {
  assert.match(source, /settings-modal-backdrop/);
  assert.match(source, /backdrop-filter.*blur/);
});

test("SettingsShell has six categories", () => {
  assert.match(source, /id: "models"/);
  assert.match(source, /id: "plugins"/);
  assert.match(source, /id: "skills"/);
  assert.match(source, /id: "appearance"/);
  assert.match(source, /id: "language"/);
  assert.match(source, /id: "defaults"/);
});

test("SettingsShell uses aria-modal and role=dialog", () => {
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
});

test("SettingsShell category items have role=tab and aria-selected", () => {
  assert.match(source, /role="tab"/);
  assert.match(source, /aria-selected/);
});

test("SettingsShell handles Escape key", () => {
  assert.match(source, /key.*Escape.*onClose/);
});

test("SettingsShell handles backdrop click", () => {
  assert.match(source, /e\.target === e\.currentTarget.*onClose/);
});

test("SettingsShell has mobile layout class", () => {
  assert.match(source, /settings-modal--mobile/);
  assert.match(source, /settings-categories--mobile/);
});

test("SettingsShell embeds ModelsContent", () => {
  assert.match(source, /ModelsContent/);
  assert.match(source, /embedded/);
});

test("SettingsShell embeds PluginsContent", () => {
  assert.match(source, /PluginsContent/);
});

test("SettingsShell embeds SkillsContent", () => {
  assert.match(source, /SkillsContent/);
});

test("SettingsShell has Appearance section with theme toggle", () => {
  assert.match(source, /AppearanceSection/);
  assert.match(source, /toggleTheme/);
});

test("SettingsShell has Language section with locale selection", () => {
  assert.match(source, /LanguageSection/);
  assert.match(source, /setLocale/);
});
```

- [ ] **Step 2: Run tests**

Run: `node --experimental-strip-types --test components/SettingsShell.test.mjs`
Expected: PASS

- [ ] **Step 3: Run existing ModelsConfig test**

Run: `node --experimental-strip-types --test components/ModelsConfig.test.mjs`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add components/SettingsShell.test.mjs
git commit -m "test: add SettingsShell source-text assertions"
```

---

## Task 9: Update ModelsConfig Test for Embedded Prop

**Files:**
- Modify: `components/ModelsConfig.test.mjs`

- [ ] **Step 1: Add embedded prop assertion**

Append to existing test file:

```js
test("ModelsConfig supports embedded prop for SettingsShell", () => {
  assert.match(
    source,
    /embedded\?:\s*boolean/,
  );
  assert.match(
    source,
    /if \(embedded\)/,
  );
});
```

- [ ] **Step 2: Run test**

Run: `node --experimental-strip-types --test components/ModelsConfig.test.mjs`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add components/ModelsConfig.test.mjs
git commit -m "test: verify ModelsConfig embedded prop for SettingsShell"
```

---

## Task 10: Full Verification

- [ ] **Step 1: Run all tests**

Run: `npm test 2>&1 | tail -20`
Expected: all tests PASS

- [ ] **Step 2: TypeScript check**

Run: `node_modules/.bin/tsc --noEmit`
Expected: no errors (or only pre-existing errors)

- [ ] **Step 3: ESLint check**

Run: `npm run lint 2>&1 | tail -10`
Expected: same 15 known findings (no regressions)

- [ ] **Step 4: Git diff check**

Run: `git diff --check`
Expected: no whitespace errors

- [ ] **Step 5: Verify no untracked files need staging**

Run: `git status --short`
Expected: only the files we committed

- [ ] **Step 6: Manual verification notes**

Since browser tools are unavailable, document what would be verified:
- [ ] Open settings from sidebar Models/Plugins/Skills buttons — unified modal appears
- [ ] Category navigation highlights active category
- [ ] Each category shows correct content
- [ ] Escape closes modal
- [ ] Backdrop click closes modal
- [ ] Mobile: single-column layout
- [ ] Theme toggle works from Appearance category
- [ ] Language picker works from Language category
- [ ] Model config save/load still works
- [ ] Plugin install/update/remove still works
- [ ] Skill search/install/toggle still works

---

## Commit Summary

1. `feat: add i18n keys for unified settings categories`
2. `feat: add embedded prop and ModelsContent export to ModelsConfig`
3. `feat: add embedded prop and PluginsContent export to PluginsConfig`
4. `feat: add embedded prop and SkillsContent export to SkillsConfig`
5. `feat: add SettingsShell unified settings modal component`
6. `style: add settings modal blurred backdrop and category navigation CSS`
7. `feat: wire SettingsShell into AppShell, replace three config modals`
8. `test: add SettingsShell source-text assertions`
9. `test: verify ModelsConfig embedded prop for SettingsShell`

## Pending Manual Checks

- Responsive mobile layout (single-column categories + content)
- Blurred backdrop renders correctly in both themes
- Focus trap within modal
- Focus restoration on close
- Category keyboard navigation (arrow keys)
- All existing auth/config flows preserved
- Theme toggle from Appearance category
- Language selection from Language category
