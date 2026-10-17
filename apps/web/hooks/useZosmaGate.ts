"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * useZosmaGate — may this *browser* use the app?
 *
 * "Signed in" == this browser holds a Zosma session cookie issued when the
 * OAuth flow completed. The machine also has to be configured (a router key
 * lives in models.json); the server only reports signedIn when both are
 * true. A browser that never completed the flow stays on the login screen
 * even if another browser on this machine already signed in.
 *
 * Reads the same status endpoint the Models panel uses, so both agree.
 */

export type ZosmaGateState = "loading" | "signed-out" | "signed-in";

/** Pure gate decision — exported for tests. */
export function resolveZosmaGate(input: { loading: boolean; signedIn: boolean }): ZosmaGateState {
  if (input.loading) return "loading";
  return input.signedIn ? "signed-in" : "signed-out";
}

/** Broadcast from anywhere that signs the browser out (e.g. Disconnect). */
export const ZOSMA_SIGNED_OUT_EVENT = "zosma:signed-out";

export function useZosmaGate() {
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/zosma/status", { cache: "no-store" });
      const body = res.ok ? ((await res.json()) as { signedIn?: boolean }) : null;
      setSignedIn(Boolean(body?.signedIn));
    } catch {
      setSignedIn(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onSignedOut = () => void refresh();
    window.addEventListener(ZOSMA_SIGNED_OUT_EVENT, onSignedOut);
    return () => window.removeEventListener(ZOSMA_SIGNED_OUT_EVENT, onSignedOut);
  }, [refresh]);

  return { state: resolveZosmaGate({ loading, signedIn }), refresh };
}