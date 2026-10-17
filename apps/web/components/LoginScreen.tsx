"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import { isTauri, useZosmaAuth } from "@/hooks/useZosmaAuth";

interface Props {
  /** Called once the PKCE flow lands a key and `status` reports configured. */
  onSignedIn: () => void;
}

// App styling idiom: inline styles over the globals.css design tokens.
const fieldStyle: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg-panel)",
  color: "var(--text)",
  fontSize: 12,
  boxSizing: "border-box",
};

/**
 * LoginScreen — full-screen Google sign-in gate for the whole app.
 *
 * Reuses the existing Zosma Router PKCE flow (useZosmaAuth): the "Continue
 * with Google" button asks the auth server for an authorization URL, opens
 * it in the system browser, then waits. Completion arrives by loopback
 * callback (/api/auth/zosma/callback), Tauri deep link, or manual paste.
 *
 * A router-key field is always offered too: the auth server rejects
 * `redirect_uri`, so a plain browser that cannot receive the app deep link
 * would otherwise have no way to finish signing in.
 */
export function LoginScreen({ onSignedIn }: Props) {
  const { t } = useI18n();
  const { phase, error, start, cancel, submitManual, submitApiKey } = useZosmaAuth({
    onCompleted: onSignedIn,
  });
  const [pasted, setPasted] = useState("");
  const [routerKey, setRouterKey] = useState("");
  // Resolved after mount so SSR and the first client render agree on the copy.
  const [inTauri, setInTauri] = useState(false);
  useEffect(() => setInTauri(typeof window !== "undefined" && isTauri(window)), []);

  const working = phase === "starting" || phase === "completing";

  return (
    <div
      role="main"
      className="flex min-h-screen w-full flex-col items-center justify-center gap-5 bg-(--bg) p-6"
    >
      <div className="workspace-placeholder-brand flex flex-col items-center gap-2">
        <span className="workspace-placeholder-logo zosma-brand" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="zosma-brand-mark" src="/zosma-logo.png" alt="" width={42} height={42} />
        </span>
        <span className="workspace-placeholder-name">{t("auth.brand")}</span>
      </div>

      <div
        className="flex w-full max-w-90 flex-col gap-3 rounded-lg border border-(--border) bg-(--bg-subtle) p-5"
      >
        <div className="text-center">
          <div className="text-[15px] font-semibold text-(--text)">{t("auth.signInTitle")}</div>
          <div className="mt-1 text-xs text-(--text-muted)">{t("auth.signInSubtitle")}</div>
        </div>

        {error && phase === "error" && (
          <div role="alert" className="text-xs text-(--state-error)">
            {error}
          </div>
        )}

        {working && (
          <div role="status" className="flex flex-col items-center gap-2 text-xs text-(--text-muted)">
            <span className="workspace-placeholder-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            {phase === "starting"
              ? (inTauri ? t("auth.openingBrowser") : t("auth.openingLink"))
              : t("auth.completing")}
          </div>
        )}

        {phase === "waiting_browser" && (
          <>
            <div role="status" className="text-center text-xs text-(--text)">
              {t("auth.waitingBrowser")}
            </div>
            <button
              type="button"
              onClick={() => void cancel()}
              className="cursor-pointer rounded-md border border-(--border) bg-transparent py-1.5 px-3 text-xs text-(--text-muted)"
            >
              {t("auth.cancel")}
            </button>
            <details>
              <summary className="cursor-pointer text-xs text-(--text-muted)">
                {t("auth.troublePaste")}
              </summary>
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  aria-label={t("auth.pastePlaceholder")}
                  value={pasted}
                  onChange={(event) => setPasted(event.target.value)}
                  placeholder={t("auth.pastePlaceholder")}
                  style={fieldStyle}
                />
                <button
                  type="button"
                  onClick={() => void submitManual(pasted)}
                  className="cursor-pointer rounded-md border-none bg-(--accent) py-1.5 px-3 text-xs whitespace-nowrap text-white"
                >
                  {t("auth.submit")}
                </button>
              </div>
            </details>
          </>
        )}

        {(phase === "idle" || phase === "error") && (
          <button
            type="button"
            onClick={() => void start()}
            disabled={working}
            className="w-full cursor-pointer rounded-md border-none bg-(--accent) py-2.5 px-4 text-[13px] font-semibold text-white"
          >
            {t("auth.continueWithGoogle")}
          </button>
        )}

        {(phase === "idle" || phase === "error") && (
          <details>
            <summary className="cursor-pointer text-center text-xs text-(--text-muted)">
              {t("auth.keyFallback")}
            </summary>
            <div className="mt-2 flex gap-2">
              <input
                type="password"
                aria-label={t("auth.keyPlaceholder")}
                value={routerKey}
                onChange={(event) => setRouterKey(event.target.value)}
                placeholder={t("auth.keyPlaceholder")}
                style={fieldStyle}
              />
              <button
                type="button"
                onClick={() => void submitApiKey(routerKey)}
                className="cursor-pointer rounded-md border border-(--border) bg-transparent py-1.5 px-3 text-xs whitespace-nowrap text-(--text)"
              >
                {t("auth.submit")}
              </button>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}