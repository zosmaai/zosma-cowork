"use client";

import { useCallback, useEffect, useState } from "react";
import { useZosmaAuth } from "@/hooks/useZosmaAuth";
import { ZOSMA_SIGNED_OUT_EVENT } from "@/hooks/useZosmaGate";

/** One-shot landing notice from the callback redirect (?zosma=success|error). */
export interface ZosmaNotice {
  status: "success" | "error";
  message?: string;
  models?: number;
}

export interface ZosmaStatus {
  configured: boolean;
  signedIn?: boolean;
  pending: boolean;
  modelCount: number;
  baseUrl: string | null;
  authBaseUrl: string;
  routerBaseUrl: string;
}

/** Router status, shared by the provider-list row and the detail pane. */
export function useZosmaRouterStatus() {
  const [status, setStatus] = useState<ZosmaStatus | null>(null);
  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/zosma/status");
      if (res.ok) setStatus((await res.json()) as ZosmaStatus);
    } catch {
      // Non-fatal — the detail pane falls back to flow state.
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { status, reload };
}

interface Props {
  status: ZosmaStatus | null;
  /** Re-fetch the status after anything that changes it. */
  onStatusChange: () => void | Promise<void>;
  onRefresh: () => void;
  /** One-shot landing notice from the callback redirect. */
  notice?: ZosmaNotice | null;
}

const inputClass =
  "w-full py-1.5 px-[9px] bg-(--bg) border border-(--border) rounded-[5px] text-(--text) text-[13px] outline-none font-(--font-mono) box-border";
const primaryBtn =
  "py-[5px] px-3.5 bg-(--accent) border-none rounded-[5px] text-white cursor-pointer text-[13px] font-semibold whitespace-nowrap";
const ghostBtn =
  "py-[5px] px-3 bg-none border border-(--border) rounded-[5px] text-(--text-muted) cursor-pointer text-[13px] whitespace-nowrap inline-flex items-center gap-1.5";
const dangerBtn =
  "py-[5px] px-3 bg-none border border-red-500/30 rounded-[5px] text-(--state-error) cursor-pointer text-[13px] whitespace-nowrap";

function Spinner() {
  return (
    <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Zosma Router detail pane (shown when "Zosma Router" is selected in the
 * Models provider list, like the OAuth/API-key providers).
 *
 *  - not configured → "Sign in with Zosma"
 *  - waiting_browser → spinner + cancel + manual-paste fallback
 *  - completing → spinner
 *  - configured → model count + Re-sign in / Refresh models / Disconnect
 *  - landing notice → one-shot success/error line from the callback redirect
 */
export function ZosmaRouterDetail({ status, onStatusChange, onRefresh, notice: noticeProp }: Props) {
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

  useEffect(() => {
    void onStatusChange();
  }, [phase, onStatusChange]);

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

  const configured = status?.configured ?? false;
  const working = phase === "starting" || phase === "completing";
  const idle = phase === "idle" || phase === "error";

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
      void onStatusChange();
    }
  };

  const disconnect = async () => {
    await fetch("/api/auth/zosma/disconnect", { method: "POST" });
    reset();
    void onStatusChange();
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
    void onStatusChange();
  };

  const saveApiKey = async () => {
    const res = await fetch("/api/auth/zosma/api-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: apiKeyInput }),
    });
    if (res.ok) {
      setApiKeyInput("");
      void onStatusChange();
      onRefresh();
    }
  };

  const startSignIn = () => {
    setLandingNotice(null);
    void start();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold text-(--text-dim) uppercase tracking-[0.06em] mb-0.5">
          Zosma Router
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`w-[7px] h-[7px] rounded-full inline-block ${configured ? "bg-(--state-success)" : "bg-(--border)"}`} />
          <span className={`text-[11px] ${configured ? "text-(--state-success)" : "text-(--text-dim)"}`}>
            {configured ? "Connected" : "Not connected"}
          </span>
        </div>
      </div>

      <div className="min-h-[48px] flex flex-col gap-2">
        <p className="m-0 text-[13px] text-(--text-muted) leading-[1.5]">
          {configured
            ? `${status?.modelCount ?? 0} models via ${status?.baseUrl}. Re-signing in issues a new router key.`
            : "Sign in to route models through your Zosma account."}
        </p>
        {shownError && effectivePhase === "error" && (
          <p className="m-0 text-[13px] text-(--state-error)">{shownError}</p>
        )}
        {!shownError && successText && (
          <p className="m-0 text-[13px] text-(--state-success)">{successText}</p>
        )}
        {working && (
          <p className="m-0 flex items-center gap-2 text-[13px] text-(--text-muted)">
            <Spinner />
            {phase === "starting" ? "Opening sign-in..." : "Loading your models..."}
          </p>
        )}
        {phase === "waiting_browser" && (
          <div className="flex flex-col gap-2.5">
            <p className="m-0 flex items-center gap-2 text-[13px] text-(--text)">
              <Spinner />
              Complete sign-in in your browser
            </p>
            <details>
              <summary className="cursor-pointer text-[13px] text-(--text-muted)">
                Trouble? Paste the result URL
              </summary>
              <div className="flex gap-1.5 mt-2">
                <input
                  type="text"
                  value={pastedUrl}
                  onChange={(e) => setPastedUrl(e.target.value)}
                  placeholder="http://…/callback?code=…&state=…"
                  className={inputClass}
                />
                <button type="button" onClick={() => void submitManual(pastedUrl)} className={`${primaryBtn} shrink-0`}>
                  Submit
                </button>
              </div>
            </details>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {phase === "waiting_browser" && (
          <button type="button" onClick={() => void cancel()} className={ghostBtn}>
            Cancel
          </button>
        )}
        {idle && (
          <button type="button" onClick={startSignIn} className={primaryBtn}>
            {configured ? "Re-sign in" : "Sign in with Zosma"}
          </button>
        )}
        {configured && phase === "idle" && (
          <>
            <button
              type="button"
              onClick={() => void refreshModels()}
              disabled={refreshing}
              className={`${ghostBtn} ${refreshing ? "opacity-50" : ""}`}
            >
              {refreshing && <Spinner />}
              Refresh models
            </button>
            <button type="button" onClick={() => void disconnect()} className={dangerBtn}>
              Disconnect
            </button>
          </>
        )}
      </div>

      <details
        onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}
        className="pt-3 border-t border-(--border)"
      >
        <summary className="cursor-pointer text-[13px] text-(--text-muted)">Self-hosted router</summary>
        {showAdvanced && status && (
          <div className="mt-3 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-[12px] text-(--text-muted) font-medium">
              Auth URL
              <input
                type="text"
                value={advancedAuthUrl || status.authBaseUrl}
                onChange={(e) => setAdvancedAuthUrl(e.target.value)}
                placeholder="https://router.example.com"
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-(--text-muted) font-medium">
              Router URL
              <input
                type="text"
                value={advancedRouterUrl || status.routerBaseUrl}
                onChange={(e) => setAdvancedRouterUrl(e.target.value)}
                placeholder="https://router.example.com/v1"
                className={inputClass}
              />
            </label>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void saveConfig()} className={primaryBtn}>
                Save
              </button>
              {savedConfig && <span className="text-[13px] text-(--text-muted)">Saved</span>}
            </div>
            <label className="flex flex-col gap-1 text-[12px] text-(--text-muted) font-medium">
              Router key
              <div className="flex gap-1.5">
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="Paste router key (sk-…)"
                  className={inputClass}
                />
                <button type="button" onClick={() => void saveApiKey()} className={`${primaryBtn} shrink-0`}>
                  Use key
                </button>
              </div>
            </label>
          </div>
        )}
      </details>
    </div>
  );
}
