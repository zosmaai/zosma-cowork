import { createAuthClient } from 'better-auth/client';
import { tokenStore } from '@/lib/token-store';

const AUTH_URL = import.meta.env.VITE_AUTH_URL ?? 'https://auth.zosma.ai';

export const authClient = createAuthClient({
	baseURL: AUTH_URL,
	fetchOptions: {
		auth: {
			type: 'Bearer',
			// Returns '' (not undefined) when no token — the server treats an
			// empty Bearer as "no bearer auth" and falls back to cookie-based
			// auth, which is how the OAuth callback finalisation works.
			token: () => tokenStore.getInMemory() ?? '',
		},

		/**
		 * Auto-save the bearer token whenever the server includes it in a
		 * response (sign-in, OAuth callback finalisation, getSession, etc.).
		 */
		onResponse: async (ctx: { response: Response }) => {
			const token = ctx.response.headers.get('set-auth-token');
			if (token) {
				await tokenStore.save(token);
			}
		},

		/**
		 * B10 — 401 handling.
		 * Clear the stale token and show the login screen automatically.
		 */
		onError: async (ctx: { response?: Response }) => {
			if (ctx.response?.status === 401) {
				await tokenStore.clear();
				window.dispatchEvent(new CustomEvent('zosma-unauthorized'));
			}
		},
	},
});
