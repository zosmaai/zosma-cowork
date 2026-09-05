"use client";

/**
 * Thin adapter components that extract the inner content of each config modal
 * without the outer fixed-position backdrop wrapper.
 *
 * Each adapter renders the original component inside an embedded host.
 * Since modifying the massive existing components is risky, CSS overrides
 * hide their outer modal chrome while preserving existing behavior.
 */

import { ModelsConfig } from "./ModelsConfig";
import type { ZosmaNotice } from "./ZosmaAuthCard";
import { PluginsConfig } from "./PluginsConfig";
import { SkillsConfig } from "./SkillsConfig";

/**
 * Wraps an existing config modal so its outer fixed-position backdrop is hidden,
 * allowing SettingsShell to provide its own unified modal.
 */
function EmbeddedWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="settings-embedded-host">
      {children}
    </div>
  );
}

export function ModelsContent({
  onClose,
  zosmaNotice,
}: {
  onClose: () => void;
  zosmaNotice?: ZosmaNotice | null;
}) {
  return (
    <EmbeddedWrapper>
      <ModelsConfig onClose={onClose} zosmaNotice={zosmaNotice} />
    </EmbeddedWrapper>
  );
}

export function PluginsContent({
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
  return (
    <EmbeddedWrapper>
      <PluginsConfig
        cwd={cwd}
        sessionId={sessionId}
        onClose={onClose}
        onReloaded={onReloaded}
      />
    </EmbeddedWrapper>
  );
}

export function SkillsContent({
  cwd,
  onClose,
}: {
  cwd: string;
  onClose: () => void;
}) {
  return (
    <EmbeddedWrapper>
      <SkillsConfig cwd={cwd} onClose={onClose} />
    </EmbeddedWrapper>
  );
}
