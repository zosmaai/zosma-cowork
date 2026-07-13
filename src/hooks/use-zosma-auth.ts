import { authLog } from "@/lib/auth-log";
import { authClient } from "@/lib/auth-client";
import { tokenStore } from "@/lib/token-store";
import { userCache } from "@/lib/user-cache";
import type { ZosmaUser } from "@/types/auth";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { useCallback, useEffect, useState } from "react";

/**
 * When true (default), startup triggers a background getSession() call that
 * validates the stored bearer token against the auth server and refreshes the
 * cached user profile.
 *
 * Set VITE_AUTH_VALIDATE_ON_STARTUP=false in .env to skip this step during
 * local development when the auth server may not be running.  The app will
 * still restore the session from the local user cache.
 */
const VALIDATE_ON_STARTUP =
	import.meta.env.VITE_AUTH_VALIDATE_ON_STARTUP !== "false";

export const useZosmaAuth = () => {
	const [user, setUser] = useState<ZosmaUser | null>(null);
	const [loading, setLoading] = useState(true);

	// ── Startup: two-phase session restore ───────────────────────────────────
	//
	// Phase 1 (instant, no network): if the keychain holds a token AND the
	//   local user cache has a user object, restore both immediately and set
	//   loading=false so the app shell renders right away.
	//
	// Phase 2 (background, optional): call getSession() to validate the bearer
	//   token and refresh stale profile data.  Three outcomes:
	//   • server returns a user    → update cache + state with fresh data
	//   • server says "no session" → token is stale; clear token + cache + user
	//   • network / HTTP error     → keep cached state, don't clear anything
	//
	useEffect(() => {
		let cancelled = false;

		const restore = async () => {
			authLog("restore() start", { VALIDATE_ON_STARTUP });
			const token = await tokenStore.load();
			authLog("restore(): tokenStore.load result", {
				hasToken: !!token,
				tokenLen: token?.length ?? 0,
			});
			if (!token) {
				authLog("restore(): no token — clearing user cache, will show LoginScreen");
				userCache.clear();
				if (!cancelled) setLoading(false);
				return;
			}

			// Phase 1 — instant restore from local cache
			const cached = userCache.load();
			authLog("restore(): userCache.load result", { hasCachedUser: !!cached });
			if (cached && !cancelled) {
				setUser(cached);
				setLoading(false);
			}

			// Phase 2 — background validation (opt-out via env var for local dev)
			if (VALIDATE_ON_STARTUP) {
				try {
					authLog("restore(): Phase 2 — calling getSession()");
					const { data, error } = await authClient.getSession();
					authLog("restore(): Phase 2 result", {
						hasUser: !!data?.user,
						error: error ? { status: error.status, message: error.message } : null,
					});
					if (cancelled) return;

					if (data?.user) {
						const fresh = data.user as ZosmaUser;
						userCache.save(fresh);
						setUser(fresh);
						authLog("restore(): Phase 2 success", { email: fresh.email });
					} else if (!error) {
						authLog("restore(): Phase 2 — server says no session, clearing token+cache");
						await tokenStore.clear();
						userCache.clear();
						setUser(null);
					} else {
						authLog("restore(): Phase 2 — network/HTTP error, preserving cached state");
					}
				} catch (e) {
					authLog("restore(): Phase 2 THREW", { err: String(e) });
				}
			}

			// If there was no cache we deferred setLoading; resolve it now.
			if (!cancelled && !cached) setLoading(false);
		};

		restore().catch(() => {
			if (!cancelled) setLoading(false);
		});

		return () => {
			cancelled = true;
		};
	}, []);

	// ── Deep-link OAuth callback (Google) ────────────────────────────────────
	// The auth server's hooks.after embeds the bearer token as ?token= in the
	// zosma-cowork:// redirect URL. We extract it directly — no second HTTP call.
	useEffect(() => {
		let unlistenFn: (() => void) | undefined;

		onOpenUrl(async (urls) => {
			authLog("deep-link: onOpenUrl fired", { urls });
			const raw = urls[0];
			if (!raw) {
				authLog("deep-link: empty urls array — aborting");
				return;
			}
			try {
				const deepLink = new URL(raw);
				const token = deepLink.searchParams.get("token");
				authLog("deep-link: parsed URL", {
					scheme: deepLink.protocol,
					path: deepLink.pathname,
					hasToken: !!token,
					tokenLen: token?.length ?? 0,
				});
				if (!token) {
					authLog("deep-link: no ?token= param, ignoring");
					return;
				}
				await tokenStore.save(token);
				authLog("deep-link: token saved, calling getSession()");
				const { data, error } = await authClient.getSession();
				authLog("deep-link: getSession result", {
					hasUser: !!data?.user,
					error: error ? { status: error.status, message: error.message } : null,
				});
				if (data?.user) {
					const u = data.user as ZosmaUser;
					userCache.save(u);
					setUser(u);
					authLog("deep-link: session established", { email: u.email });
				} else {
					authLog("deep-link: no user returned — clearing token+cache");
					await tokenStore.clear();
					userCache.clear();
					window.dispatchEvent(new CustomEvent("zosma-auth-failed"));
				}
			} catch (err) {
				authLog("deep-link: callback THREW", { err: String(err) });
				window.dispatchEvent(new CustomEvent("zosma-auth-failed"));
			}
		}).then((fn) => {
			unlistenFn = fn;
			authLog("deep-link: listener registered");
		});

		return () => {
			unlistenFn?.();
		};
	}, []);

	// ── B10: React to mid-session 401 (token revoked) ───────────────────────
	useEffect(() => {
		const handle = () => {
			userCache.clear();
			setUser(null);
		};
		window.addEventListener("zosma-unauthorized", handle);
		return () => window.removeEventListener("zosma-unauthorized", handle);
	}, []);

	// ── Sign out ─────────────────────────────────────────────────────────────
	const signOut = useCallback(async (): Promise<void> => {
		await authClient.signOut();
		await tokenStore.clear();
		userCache.clear();
		setUser(null);
	}, []);

	return {
		user,
		isAuthenticated: !!user,
		loading,
		signOut,
	};
};
