/**
 * useGithub — shared GitHub connection store.
 *
 * A module-level store (cache + pub-sub) consumed via useSyncExternalStore,
 * so the Apps launcher tile and the GitHub detail page share ONE fetch and
 * the same state. State persists across mount/unmount, so navigating away
 * and back is instant (no "connect → connected" flash). Implements
 * stale-while-revalidate: cached data shows immediately while a background
 * refresh runs.
 *
 * The sidecar also caches gh results for 60s and runs its gh calls in
 * parallel, so a cold load is ~0.5s instead of ~2.3s.
 */

import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";

export interface Org {
	login: string;
	role: string;
	avatar_url: string;
}

export interface GitHubInfo {
	user: { login: string; name: string | null; avatar_url: string; email: string | null };
	orgs: Org[];
	totalRepos: number;
	scopes: string[];
}

export type GithubStatus = "unknown" | "connected" | "disconnected";

interface GithubState {
	status: GithubStatus;
	user: string | null;
	info: GitHubInfo | null;
	/** True only during the very first load, when we have nothing cached. */
	loading: boolean;
	error: string | null;
}

const FRESH_MS = 60_000;

let state: GithubState = {
	status: "unknown",
	user: null,
	info: null,
	loading: false,
	error: null,
};
let lastFetch = 0;
let inflight: Promise<void> | null = null;

const listeners = new Set<() => void>();
function emit() {
	for (const l of listeners) l();
}
function setState(patch: Partial<GithubState>) {
	state = { ...state, ...patch };
	emit();
}
function subscribe(fn: () => void) {
	listeners.add(fn);
	return () => listeners.delete(fn);
}
function getSnapshot() {
	return state;
}

/** Fetch status + info. Stale-while-revalidate unless force=true. */
async function load(force = false): Promise<void> {
	if (inflight) return inflight;
	if (!force && state.status !== "unknown" && Date.now() - lastFetch < FRESH_MS) {
		return; // fresh enough
	}
	// Only show the loading skeleton when we have nothing to show yet.
	if (state.status === "unknown") setState({ loading: true });

	inflight = (async () => {
		try {
			const s = await invoke<{ connected: boolean; hosts?: Record<string, { user: string }> }>(
				"gh_auth_status",
			);
			if (s.connected) {
				const user = s.hosts?.["github.com"]?.user ?? null;
				setState({ status: "connected", user, error: null });
				try {
					const info = await invoke<GitHubInfo>("gh_organizations");
					setState({ info, user: info.user.login ?? user, loading: false });
				} catch {
					setState({ loading: false });
				}
			} else {
				setState({ status: "disconnected", user: null, info: null, loading: false });
			}
			lastFetch = Date.now();
		} catch (err) {
			setState({
				status: "disconnected",
				loading: false,
				error: err instanceof Error ? err.message : String(err),
			});
		} finally {
			inflight = null;
		}
	})();
	return inflight;
}

/** Start the device-code flow; returns the one-time code + device URL. */
async function connect(scopes?: string): Promise<{ code: string; url: string }> {
	return invoke<{ code: string; url: string }>("gh_auth_login", scopes ? { scopes } : {});
}

async function cancel(): Promise<void> {
	try {
		await invoke("gh_auth_cancel");
	} catch {
		/* ignore */
	}
}

async function disconnect(): Promise<void> {
	try {
		await invoke("gh_auth_logout");
	} catch {
		/* ignore */
	}
	setState({ status: "disconnected", user: null, info: null });
	lastFetch = 0;
}

/** Force a refresh (e.g. while polling during login). */
function refresh(): Promise<void> {
	return load(true);
}

let started = false;

export function useGithub() {
	const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

	// Kick off the first load exactly once across all consumers.
	if (!started) {
		started = true;
		void load();
	}

	return {
		...snap,
		refresh,
		connect,
		cancel,
		disconnect,
		reload: () => load(),
	};
}
