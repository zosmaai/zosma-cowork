import { authClient } from "@/lib/auth-client";
import { tokenStore } from "@/lib/token-store";
import type { ZosmaUser } from "@/types/auth";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { useCallback, useEffect, useState } from "react";

export const useZosmaAuth = () => {
	const [user, setUser] = useState<ZosmaUser | null>(null);
	const [loading, setLoading] = useState(true);

	// ── Startup: restore session from OS keychain ────────────────────────────
	useEffect(() => {
		let cancelled = false;
		const restore = async () => {
			const token = await tokenStore.load();
			if (!token) {
				if (!cancelled) setLoading(false);
				return;
			}
			const { data } = await authClient.getSession();
			if (cancelled) return;
			if (data?.user) {
				setUser(data.user as ZosmaUser);
			} else {
				await tokenStore.clear();
			}
			setLoading(false);
		};
		restore();
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
			const raw = urls[0];
			if (!raw) return;
			try {
				const deepLink = new URL(raw);
				const token = deepLink.searchParams.get("token");
				if (!token) return;
				await tokenStore.save(token);
				const { data } = await authClient.getSession();
				if (data?.user) {
					setUser(data.user as ZosmaUser);
				} else {
					// Token rejected or session expired — clear it and let LoginScreen
					// reset its spinner so the user can try again.
					await tokenStore.clear();
					window.dispatchEvent(new CustomEvent("zosma-auth-failed"));
				}
			} catch (err) {
				console.error("[ZosmaAuth] Deep-link callback failed", err);
				window.dispatchEvent(new CustomEvent("zosma-auth-failed"));
			}
		}).then((fn) => {
			unlistenFn = fn;
		});

		return () => {
			unlistenFn?.();
		};
	}, []);

	// ── B10: React to mid-session 401 (token revoked) ───────────────────────
	useEffect(() => {
		const handle = () => setUser(null);
		window.addEventListener("zosma-unauthorized", handle);
		return () => window.removeEventListener("zosma-unauthorized", handle);
	}, []);

	// ── Sign out ─────────────────────────────────────────────────────────────
	const signOut = useCallback(async (): Promise<void> => {
		await authClient.signOut();
		await tokenStore.clear();
		setUser(null);
	}, []);

	return {
		user,
		isAuthenticated: !!user,
		loading,
		signOut,
	};
};
