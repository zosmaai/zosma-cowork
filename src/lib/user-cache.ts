/**
 * Persists the authenticated user object in localStorage so the session can be
 * restored immediately on the next launch without a network round-trip.
 *
 * This holds non-sensitive profile data (name, email, id). The secret bearer
 * token stays in the OS keychain via token-store.ts.
 */
import type { ZosmaUser } from "@/types/auth";

const KEY = "zosma:cached-user";

export const userCache = {
	save(user: ZosmaUser): void {
		try {
			localStorage.setItem(KEY, JSON.stringify(user));
		} catch {
			// storage quota exceeded or unavailable — non-fatal
		}
	},

	load(): ZosmaUser | null {
		try {
			const raw = localStorage.getItem(KEY);
			return raw ? (JSON.parse(raw) as ZosmaUser) : null;
		} catch {
			return null;
		}
	},

	clear(): void {
		try {
			localStorage.removeItem(KEY);
		} catch {
			// ignore
		}
	},
};
