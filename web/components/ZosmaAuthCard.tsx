"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useZosmaAuth } from "@/hooks/useZosmaAuth";

/** One-shot landing notice from the callback redirect (?zosma=success|error). */
export interface ZosmaNotice {
  status: "success" | "error";
  message?: string;
  models?: number;
}

interface ZosmaStatus {
  configured: boolean;
  pending: boolean;
  modelCount: number;
  baseUrl: string | null;
  authBaseUrl: string;
  routerBaseUrl: string;
}

interface Props {
  onRefresh: () => void;
  /** One-shot landing notice (Task 11B wires it from the URL params). */
  notice?: ZosmaNotice | null;
}

// App styling idiom: inline styles over globals.css design tokens
// (ModelsConfig uses zero className; shadcn/Tailwind token utilities are
// not defined in this app — do not add them).
const cardStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--bg-subtle)",
  padding: 14,
};
const primaryBtnStyle: CSSProperties = {
  width: "100%",
  marginTop: 12,
  padding: "8px 16px",
  borderRadius: 6,
  border: "none",
  background: "var(--accent)",
  color: "#fff",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
const ghostBtnStyle: CSSProperties = {
  padding: "5px 10px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-muted)",
  fontSize: 12,
  cursor: "pointer",
};
const fieldStyle: CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg-panel)",
  color: "var(--text)",
  fontSize: 12,
  boxSizing: "border-box",
};

function Spinner() {
  // Same inline-SVG + `animate-spin` idiom as AppShell's loading spinners.
  return (
    <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Zosma Router sign-in card for the Models panel.
 *
 * States:
 *  - not configured → "Sign in with Zosma"
 *  - waiting_browser → spinner + cancel + manual-paste fallback
 *  - completing → spinner
 *  - configured (no pending flow) → model count + Refresh / Disconnect
 *  - landing notice → one-shot success/error line from the callback redirect
 */
export function ZosmaAuthCard({ onRefresh, notice: noticeProp }: Props) {
  const [status, setStatus] = useState<ZosmaStatus | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advancedAuthUrl, setAdvancedAuthUrl] = useState("");
  const [advancedRouterUrl, setAdvancedRouterUrl] = useState("");
  const [savedConfig, setSavedConfig] = useState(false);
  const [pastedUrl, setPastedUrl] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [landingNotice, setLandingNotice] = useState<ZosmaNotice | null>(noticeProp ?? null);
  const { phase, error, start, cancel, reset, submitManual } = useZosmaAuth({
    onCompleted: () => onRefresh(),
  });

  const effectivePhase = landingNotice?.status === "error" && phase === "idle" ? "error" : phase;
  const shownError =
    error ??
    (effectivePhase === "error"
      ? landingNotice?.message ?? "Sign-in failed. Please try again."
      : null);
  const successText =
    landingNotice?.status === "success"
      ? landingNotice.models
        ? `Signed in — ${landingNotice.models} models available.`
        : "Signed in — Zosma Router configured."
      : null;

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/zosma/status");
      if (res.ok) setStatus((await res.json()) as ZosmaStatus);
    } catch {
      // Non-fatal — the card falls back to flow state.
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus, phase]);

  const configured = status?.configured ?? false;
  const working = phase === "starting" || phase === "completing";

  const saveConfig = async () => {
    setSavedConfig(false);
    const res = await fetch("/api/auth/zosma/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authBaseUrl: advancedAuthUrl || status?.authBaseUrl,
        routerBaseUrl: advancedRouterUrl || status?.routerBaseUrl,
      }),
    });
    if (res.ok) {
      setSavedConfig(true);
      void loadStatus();
    }
  };

  const disconnect = async () => {
    await fetch("/api/auth/zosma/disconnect", { method: "POST" });
    reset();
    void loadStatus();
    onRefresh();
  };

  const refreshModels = async () => {
    setRefreshing(true);
    try {
      await fetch("/api/auth/zosma/refresh", { method: "POST" });
    } finally {
      setRefreshing(false);
    }
    onRefresh();
    void loadStatus();
  };

  const saveApiKey = async () => {
    const res = await fetch("/api/auth/zosma/api-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: apiKeyInput }),
    });
    if (res.ok) {
      setApiKeyInput("");
      void loadStatus();
      onRefresh();
    }
  };

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Zosma Router</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {configured
              ? `${status?.modelCount ?? 0} models via ${status?.baseUrl}`
              : "Sign in to route models through your Zosma account"}
          </div>
        </div>
        {configured && phase === "idle" && (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => void refreshModels()}
              disabled={refreshing}
              style={{
                ...ghostBtnStyle,
                opacity: refreshing ? 0.5 : 1,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {refreshing && <Spinner />}
              Refresh
            </button>
            <button type="button" onClick={() => void disconnect()} style={ghostBtnStyle}>
              Disconnect
            </button>
          </div>
        )}
      </div>

      {shownError && effectivePhase === "error" && (
        <div style={{ marginTop: 10, fontSize: 12, color: "var(--state-error)" }}>{shownError}</div>
      )}

      {!shownError && successText && (
        <div style={{ marginTop: 10, fontSize: 12, color: "var(--state-success)" }}>{successText}</div>
      )}

      {phase === "waiting_browser" && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text)" }}>
            <Spinner />
            Complete sign-in in your browser
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" onClick={() => void cancel()} style={ghostBtnStyle}>
              Cancel
            </button>
            <details style={{ flex: 1 }}>
              <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--text-muted)" }}>
                Trouble? Paste the result URL
              </summary>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <input
                  type="text"
                  value={pastedUrl}
                  onChange={(e) => setPastedUrl(e.target.value)}
                  placeholder="http://…/callback?code=…&state=…"
                  style={fieldStyle}
                />
                <button
                  type="button"
                  onClick={() => void submitManual(pastedUrl)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 6,
                    border: "none",
                    background: "var(--accent)",
                    color: "#fff",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  Submit
                </button>
              </div>
            </details>
          </div>
        </div>
      )}

      {working && (
        <div
          style={{
            marginTop: 12,
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          <Spinner />
          {phase === "starting" ? "Opening sign-in..." : "Loading your models..."}
        </div>
      )}

      {(phase === "idle" || phase === "error") && (
        <button
          type="button"
          onClick={() => {
            setLandingNotice(null);
            void start();
          }}
          style={{
            ...primaryBtnStyle,
            background: configured ? "transparent" : "var(--accent)",
            color: configured ? "var(--text)" : "#fff",
            border: configured ? "1px solid var(--border)" : "none",
            fontWeight: configured ? 500 : 600,
          }}
        >
          {configured ? "Re-sign in (rotate key)" : "Sign in with Zosma"}
        </button>
      )}

      <details
        onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}
        style={{ marginTop: 12 }}
      >
        <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--text-muted)" }}>
          Self-hosted router
        </summary>
        {showAdvanced && status && (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              type="text"
              value={advancedAuthUrl || status.authBaseUrl}
              onChange={(e) => setAdvancedAuthUrl(e.target.value)}
              placeholder="https://router.example.com"
              style={fieldStyle}
            />
            <input
              type="text"
              value={advancedRouterUrl || status.routerBaseUrl}
              onChange={(e) => setAdvancedRouterUrl(e.target.value)}
              placeholder="https://router.example.com/v1"
              style={fieldStyle}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                onClick={() => void saveConfig()}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: "none",
                  background: "var(--accent)",
                  color: "#fff",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Save
              </button>
              {savedConfig && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Saved</span>}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="Paste router key (sk-…)"
                style={fieldStyle}
              />
              <button
                type="button"
                onClick={() => void saveApiKey()}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: "none",
                  background: "var(--accent)",
                  color: "#fff",
                  fontSize: 12,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                Use key
              </button>
            </div>
          </div>
        )}
      </details>
    </div>
  );
}
