"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useZosmaAuth — Zosma Router sign-in state machine (web version).
 *
 * idle → starting → waiting_browser → completing → done
 *                          ↘ error          ↑
 *              cancel → idle └──────────────┘
 *
 * Delivery paths for code+state:
 *  1. Loopback: auth server redirects the browser to
 *     /api/auth/zosma/callback — the server completes the flow itself and
 *     bounces to /; this hook's parent re-renders from the URL params.
 *  2. Tauri deep link: ai.zosma.cowork://oauth/callback?code&state →
 *     onOpenUrl listener → complete().
 *  3. Manual paste: submitManual(raw) — universal fallback.
 *
 * Security: never surface PKCE verifier, raw code, or state in error text.
 */

export type ZosmaAuthPhase =
  | "idle"
  | "starting"
  | "waiting_browser"
  | "completing"
  | "done"
  | "error";

export interface ZosmaAuthResult {
  providerId: string;
  selectedModelId: string;
  modelCount: number;
}

export interface UseZosmaAuthOptions {
  onCompleted?: (result: ZosmaAuthResult) => void;
  /** Loopback callback base — defaults to this page's origin. */
  redirectUri?: string;
}

export function isTauri(win: Window | Record<string, unknown>): boolean {
  return Boolean((win as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

export interface ParsedCallback {
  code: string;
  state?: string;
}

/**
 * Extract { code, state? } from a deep link, redirect URL, or bare code.
 * Pure + exported for tests.
 */
export function parseCallbackUrl(raw: string): ParsedCallback | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return null;
    }
    // Deep links: only the app's own scheme. http(s): any host (loopback or
    // whatever the auth server sent back).
    if (
      parsed.protocol !== "http:" &&
      parsed.protocol !== "https:" &&
      parsed.protocol !== "ai.zosma.cowork:"
    ) {
      return null;
    }
    if (parsed.searchParams.getAll("code").length !== 1) return null;
    if (parsed.searchParams.getAll("state").length > 1) return null;
    const code = parsed.searchParams.get("code");
    const state = parsed.searchParams.get("state") ?? undefined;
    if (!code) return null;
    return state ? { code, state } : { code };
  }

  // Bare code (no scheme): accept a single unreserved token.
  if (/^[A-Za-z0-9._~-]{1,512}$/.test(trimmed)) {
    return { code: trimmed };
  }
  return null;
}

export function safeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("no pending") || msg.includes("expired")) {
    return "Sign-in session expired. Please try again.";
  }
  if (msg.includes("state mismatch")) {
    return "Something went wrong. Please try signing in again.";
  }
  if (msg.includes("timeout")) {
    return "Request timed out. Please check your connection and try again.";
  }
  return msg;
}

async function openInSystemBrowser(url: string): Promise<void> {
  const win = window as Window & {
    __TAURI_INTERNALS__?: { invoke: (cmd: string, args: object) => Promise<unknown> };
  };
  if (win.__TAURI_INTERNALS__?.invoke) {
    try {
      await win.__TAURI_INTERNALS__.invoke("open_url", { url });
      return;
    } catch {
      // Fall through to window.open (command missing → user sees a tab).
    }
  }
  window.open(url, "_blank", "noopener");
}

export function useZosmaAuth(options: UseZosmaAuthOptions = {}) {
  const [phase, setPhase] = useState<ZosmaAuthPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ZosmaAuthResult | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);
  const deliveredRef = useRef(false);
  const onCompletedRef = useRef(options.onCompleted);
  onCompletedRef.current = options.onCompleted;
  const redirectUriRef = useRef(options.redirectUri);
  redirectUriRef.current = options.redirectUri;

  const complete = useCallback(async (code: string, state: string) => {
    setPhase("completing");
    setError(null);
    try {
      const res = await fetch("/api/auth/zosma/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, state }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `complete returned ${res.status}`);
      const result = body as ZosmaAuthResult;
      setResult(result);
      setPhase("done");
      onCompletedRef.current?.(result);
    } catch (err) {
      setError(safeError(err));
      setPhase("error");
    }
  }, []);

  // ── Tauri deep-link listener ─────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function listen() {
      const win = window as Window & { __TAURI_INTERNALS__?: unknown };
      if (!win.__TAURI_INTERNALS__) return;
      try {
        const mod = await import("@tauri-apps/plugin-deep-link");
        if (cancelled) return;
        unlistenRef.current = await mod.onOpenUrl((urls: string[]) => {
          if (deliveredRef.current) return;
          for (const url of urls) {
            const parsed = parseCallbackUrl(url);
            if (parsed?.state) {
              deliveredRef.current = true;
              void complete(parsed.code, parsed.state);
              return;
            }
          }
        });
      } catch {
        // Browser / plugin unavailable — manual paste still works.
      }
    }
    void listen();
    return () => {
      cancelled = true;
      unlistenRef.current?.();
      unlistenRef.current = null;
    };
  }, [complete]);

  const start = useCallback(async () => {
    setPhase("starting");
    setError(null);
    deliveredRef.current = false;
    try {
      const redirectUri =
        redirectUriRef.current ??
        (typeof window !== "undefined"
          ? `${window.location.origin}/api/auth/zosma/callback`
          : undefined);
      const res = await fetch("/api/auth/zosma/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(redirectUri ? { redirectUri } : {}),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `start returned ${res.status}`);
      await openInSystemBrowser(body.authorizationUrl);
      setPhase("waiting_browser");
    } catch (err) {
      setError(safeError(err));
      setPhase("error");
    }
  }, []);

  /**
   * Universal fallback: paste the full redirect URL from the address bar.
   * Requires both code and state (state is checked server-side).
   */
  const submitManual = useCallback(
    async (raw: string) => {
      const parsed = parseCallbackUrl(raw);
      if (!parsed || !parsed.state) {
        setError("That doesn't look like a sign-in result URL — it needs both code and state. Paste the full address-bar URL.");
        setPhase("error");
        return;
      }
      deliveredRef.current = true;
      await complete(parsed.code, parsed.state);
    },
    [complete],
  );

  const cancel = useCallback(async () => {
    try {
      await fetch("/api/auth/zosma/cancel", { method: "POST" });
    } catch {
      // Best-effort — the pending tx expires in 10 minutes anyway.
    }
    setPhase("idle");
    setError(null);
  }, []);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setResult(null);
  }, []);

  return { phase, error, result, start, cancel, reset, complete, submitManual };
}
