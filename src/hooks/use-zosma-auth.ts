/**
 * useZosmaAuth
 *
 * Manages the Zosma account session for the desktop app.
 *
 * Sign-in flow (Google OAuth via system browser):
 *   signInSocial({ authClient, provider: 'google' })   ← called from LoginScreen
 *     → opens system browser → Google consent
 *     → auth.zosma.ai processes callback
 *     → deep-links back to  zosma-cowork://api/auth/callback/google?…
 *     → useBetterAuthTauri catches the deep link, calls authClient.$fetch
 *     → auth-client.ts onResponse saves the set-auth-token to OS keychain
 *     → onSuccess fires → we call getSession() → set user
 *
 * Startup flow:
 *   Load token from OS keychain → getSession() to validate → set user
 *   If the token is missing or invalid the user sees LoginScreen.
 */
import { useBetterAuthTauri } from '@daveyplate/better-auth-tauri/react';
import { useCallback, useEffect, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { tokenStore } from '@/lib/token-store';
import type { ZosmaUser } from '@/types/auth';

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
			// Token is in memory now (tokenStore.load() puts it there).
			// Validate it against the server.
			const { data } = await authClient.getSession();
			if (cancelled) return;
			if (data?.user) {
				setUser(data.user as ZosmaUser);
			} else {
				// Token expired or revoked — clear it.
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
	// useBetterAuthTauri listens for the zosma-cowork:// deep link that the
	// auth server sends back after Google OAuth.  It calls authClient.$fetch
	// to finalise the session.  Our auth-client onResponse handler saves the
	// bearer token to the OS keychain automatically.
	useBetterAuthTauri({
		authClient,
		scheme: 'zosma-cowork',
		onSuccess: async () => {
			const { data } = await authClient.getSession();
			if (data?.user) {
				setUser(data.user as ZosmaUser);
				setLoading(false);
			}
		},
		onError: (error) => {
			console.error('[ZosmaAuth] OAuth deep-link error', error);
			setLoading(false);
		},
	});

	// ── B10: React to mid-session 401 (token revoked) ───────────────────────
	useEffect(() => {
		const handle = () => setUser(null);
		window.addEventListener('zosma-unauthorized', handle);
		return () => window.removeEventListener('zosma-unauthorized', handle);
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
