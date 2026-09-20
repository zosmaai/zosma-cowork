"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useZosmaAuth } from "@/hooks/useZosmaAuth";
import { ZOSMA_SIGNED_OUT_EVENT } from "@/hooks/useZosmaGate";

/** One-shot landing notice from the callback redirect (?zosma=success|error). */
export interface ZosmaNotice {
  status: "success" | "error";
  message?: string;
  models?: number;
}

interface ZosmaStatus {
  configured: boolean;
  signedIn?: boolean;
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
    // The server cleared this browser's session cookie — send the app back
    // to the login screen instead of leaving it on dead API calls.
    window.dispatchEvent(new Event(ZOSMA_SIGNED_OUT_EVENT));
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
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[13px] font-semibold text-(--text)">Zosma Router</div>
          <div className="text-xs text-(--text-muted)">
            {configured
              ? `${status?.modelCount ?? 0} models via ${status?.baseUrl}`
              : "Sign in to route models through your Zosma account"}
          </div>
        </div>
        {configured && phase === "idle" && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void refreshModels()}
              disabled={refreshing}
              className={`py-[5px] px-2.5 rounded-md border border-(--border) bg-transparent text-(--text-muted) text-xs cursor-pointer inline-flex items-center gap-1.5 ${refreshing ? "opacity-50" : ""}`}
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
        <div className="mt-2.5 text-xs text-(--state-error)">{shownError}</div>
      )}

      {!shownError && successText && (
        <div className="mt-2.5 text-xs text-(--state-success)">{successText}</div>
      )}

      {phase === "waiting_browser" && (
        <div className="mt-3">
          <div className="flex items-center gap-2 text-xs text-(--text)">
            <Spinner />
            Complete sign-in in your browser
          </div>
          <div className="flex gap-2 mt-2">
            <button type="button" onClick={() => void cancel()} style={ghostBtnStyle}>
              Cancel
            </button>
            <details className="flex-1">
              <summary className="cursor-pointer text-xs text-(--text-muted)">
                Trouble? Paste the result URL
              </summary>
              <div className="flex gap-2 mt-2">
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
                  className="py-1.5 px-3 rounded-md border-none bg-(--accent) text-white text-xs cursor-pointer"
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
          className="mt-3 flex items-center gap-2 text-xs text-(--text-muted)"
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
          className={`w-full mt-3 py-2 px-4 rounded-md border-none bg-(--accent) text-white text-[13px] font-semibold cursor-pointer ${configured ? "bg-transparent" : "bg-(--accent)"} ${configured ? "text-(--text)" : "text-white"} ${configured ? "border border-(--border)" : "border-none"} ${configured ? "font-medium" : "font-semibold"}`}
        >
          {configured ? "Re-sign in (rotate key)" : "Sign in with Zosma"}
        </button>
      )}

      <details
        onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}
        className="mt-3"
      >
        <summary className="cursor-pointer text-xs text-(--text-muted)">
          Self-hosted router
        </summary>
        {showAdvanced && status && (
          <div className="mt-2 flex flex-col gap-2">
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
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void saveConfig()}
                className="py-1.5 px-3 rounded-md border-none bg-(--accent) text-white text-xs cursor-pointer"
              >
                Save
              </button>
              {savedConfig && <span className="text-xs text-(--text-muted)">Saved</span>}
            </div>
            <div className="flex gap-2">
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
                className="py-1.5 px-3 rounded-md border-none bg-(--accent) text-white text-xs cursor-pointer whitespace-nowrap"
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
