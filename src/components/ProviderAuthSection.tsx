/**
 * ProviderAuthSection — Sign-in / sign-out UI for OAuth-based providers
 * (Claude Pro/Max, GitHub Copilot, OpenAI Codex once enabled).
 *
 * Wraps the four Tauri commands `start_oauth`, `cancel_oauth`,
 * `logout_provider`, and `get_auth_status`, plus the global Tauri events
 * `oauth_open_url`, `oauth_progress`, `oauth_completed`, `oauth_failed`,
 * `oauth_cancelled` emitted by the Rust backend.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useState } from "react";

type AuthStatusEntry = {
	id: string;
	type: "api_key" | "oauth" | "unknown";
	expires?: number;
};

type AuthStatus = {
	providers: AuthStatusEntry[];
	supported: string[];
};

type Phase = "idle" | "starting" | "waiting_browser" | "exchanging" | "done";

const PROVIDER_LABELS: Record<string, string> = {
	anthropic: "Claude Pro/Max",
	"github-copilot": "GitHub Copilot",
	"openai-codex": "ChatGPT (OpenAI Codex)",
};

const PROVIDER_DESCRIPTIONS: Record<string, string> = {
	anthropic:
		"Use your existing Claude Pro or Claude Max subscription instead of an API key.",
	"github-copilot": "Use your GitHub Copilot subscription.",
	"openai-codex": "Use your ChatGPT Plus / Pro subscription.",
};

interface Props {
	provider: string;
	/** Lower-density layout that fits inside a sidebar panel */
	compact?: boolean;
	/** Called after a successful sign-in or sign-out so the parent can react. */
	onChange?: () => void;
}

export function ProviderAuthSection({ provider, compact = false, onChange }: Props) {
	const [phase, setPhase] = useState<Phase>("idle");
	const [statusMessage, setStatusMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);

	const refreshStatus = useCallback(async () => {
		try {
			const data = await invoke<AuthStatus>("get_auth_status");
			setAuthStatus(data);
			return;
		} catch (err) {
			// Sidecar may not be ready yet — that's fine, leave status null.
			if (typeof err === "string" && err.toLowerCase().includes("not ready")) {
				return;
			}
			// Transient failure (e.g. happens immediately after oauth_completed
			// before the in-memory AuthStorage cache has propagated). Retry once.
			await new Promise((r) => setTimeout(r, 300));
			try {
				const data = await invoke<AuthStatus>("get_auth_status");
				setAuthStatus(data);
			} catch (retryErr) {
				console.warn("[provider-auth] get_auth_status failed:", retryErr);
			}
		}
	}, []);

	useEffect(() => {
		refreshStatus();
	}, [refreshStatus]);

	// Refresh status whenever the sidecar signals readiness or a config-reload
	// happens (e.g., after another component saves an API key).
	useEffect(() => {
		const handler = () => refreshStatus();
		window.addEventListener("config-reload", handler);
		let unlisten: UnlistenFn | undefined;
		(async () => {
			unlisten = await listen("ready", () => refreshStatus());
		})();
		return () => {
			window.removeEventListener("config-reload", handler);
			unlisten?.();
		};
	}, [refreshStatus]);

	// Subscribe to OAuth lifecycle events emitted by Rust.
	useEffect(() => {
		let unlisteners: UnlistenFn[] = [];
		(async () => {
			unlisteners = await Promise.all([
				listen<{ provider: string; url: string }>("oauth_open_url", (e) => {
					if (e.payload?.provider !== provider) return;
					setPhase("waiting_browser");
					setStatusMessage("Opening browser…");
					invoke("open_url", { url: e.payload.url }).catch(() => {
						// As a fallback, force a window.open which will likely be blocked
						// in Tauri but at least surfaces the URL in dev tools.
						window.open(e.payload.url, "_blank");
					});
				}),
				listen<{ provider: string; message: string }>("oauth_progress", (e) => {
					if (e.payload?.provider !== provider) return;
					setStatusMessage(e.payload.message);
					if (e.payload.message.toLowerCase().includes("token")) {
						setPhase("exchanging");
					}
				}),
				listen<{ provider: string }>("oauth_completed", (e) => {
					if (e.payload?.provider !== provider) return;
					setPhase("done");
					setStatusMessage(null);
					setError(null);
					// Optimistic local update so the button flips to "Sign Out"
					// immediately, independent of any race or silent failure in
					// the subsequent get_auth_status round-trip.
					setAuthStatus((prev) => {
						const supported = prev?.supported ?? [provider];
						const others = (prev?.providers ?? []).filter(
							(p) => p.id !== provider,
						);
						return {
							supported,
							providers: [
								...others,
								{ id: provider, type: "oauth" as const },
							],
						};
					});
					refreshStatus();
					onChange?.();
					window.dispatchEvent(new CustomEvent("config-reload"));
					// Reset phase to idle after the connected state renders.
					setTimeout(() => setPhase("idle"), 0);
				}),
				listen<{ provider: string; error?: string }>("oauth_failed", (e) => {
					if (e.payload?.provider !== provider) return;
					setPhase("idle");
					setStatusMessage(null);
					setError(e.payload.error ?? "Sign-in failed");
				}),
				listen<{ provider: string }>("oauth_cancelled", (e) => {
					if (e.payload?.provider !== provider) return;
					setPhase("idle");
					setStatusMessage(null);
					setError(null);
				}),
			]);
		})();
		return () => {
			for (const u of unlisteners) u();
		};
	}, [provider, refreshStatus, onChange]);

	const entry = useMemo(
		() => authStatus?.providers.find((p) => p.id === provider) ?? null,
		[authStatus, provider],
	);
	const supportedHere = authStatus?.supported.includes(provider) ?? true;

	const handleSignIn = useCallback(async () => {
		setError(null);
		setPhase("starting");
		setStatusMessage("Starting sign-in…");
		try {
			const result = await invoke<{
				success: boolean;
				cancelled?: boolean;
				error?: string;
			}>("start_oauth", { provider });
			if (!result.success && !result.cancelled) {
				setError(result.error ?? "Sign-in failed");
				setPhase("idle");
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setPhase("idle");
		}
	}, [provider]);

	const handleCancel = useCallback(async () => {
		try {
			await invoke("cancel_oauth");
		} catch {
			// best-effort
		}
		setPhase("idle");
		setStatusMessage(null);
	}, []);

	const handleSignOut = useCallback(async () => {
		setError(null);
		try {
			await invoke("logout_provider", { provider });
			setStatusMessage(null);
			await refreshStatus();
			onChange?.();
			window.dispatchEvent(new CustomEvent("config-reload"));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, [provider, refreshStatus, onChange]);

	const isConnected = entry?.type === "oauth";
	const inFlight = phase !== "idle" && phase !== "done";
	const label = PROVIDER_LABELS[provider] ?? provider;
	const description = PROVIDER_DESCRIPTIONS[provider];

	if (!supportedHere) {
		// SDK doesn't expose this OAuth provider in this build — render nothing.
		return null;
	}

	return (
		<div
			className={
				compact
					? "space-y-2"
					: "w-full rounded-xl border p-4 space-y-3"
			}
			style={
				compact
					? undefined
					: {
							borderColor: "hsl(var(--border))",
							background: "hsl(var(--muted) / 0.2)",
						}
			}
		>
			<div className="flex items-start justify-between gap-3">
				<div className="flex-1 min-w-0">
					<div
						className={
							compact
								? "text-xs font-medium"
								: "text-sm font-semibold"
						}
						style={{ color: "hsl(var(--foreground))" }}
					>
						Sign in with {label}
					</div>
					{!compact && description && (
						<p
							className="text-xs mt-1"
							style={{ color: "hsl(var(--muted-foreground))" }}
						>
							{description}
						</p>
					)}
				</div>
				<StatusBadge connected={isConnected} expires={entry?.expires} />
			</div>

			{statusMessage && (
				<p
					className="text-xs"
					style={{ color: "hsl(var(--muted-foreground))" }}
				>
					{statusMessage}
				</p>
			)}
			{error && (
				<p
					className="text-xs"
					style={{ color: "hsl(var(--destructive))" }}
				>
					{error}
				</p>
			)}

			<div className="flex gap-2">
				{!isConnected && !inFlight && (
					<button
						type="button"
						onClick={handleSignIn}
						className={`${
							compact
								? "flex-1 text-xs px-3 py-1.5 rounded-lg"
								: "flex-1 text-sm px-4 py-2 rounded-xl font-semibold"
						} transition-all hover:opacity-90 cursor-pointer`}
						style={{
							background: "hsl(var(--primary))",
							color: "hsl(var(--primary-foreground))",
						}}
					>
						Sign In
					</button>
				)}
				{inFlight && (
					<button
						type="button"
						onClick={handleCancel}
						className={`${
							compact
								? "flex-1 text-xs px-3 py-1.5 rounded-lg"
								: "flex-1 text-sm px-4 py-2 rounded-xl font-semibold"
						} transition-all hover:opacity-90 cursor-pointer`}
						style={{
							background: "hsl(var(--muted))",
							color: "hsl(var(--muted-foreground))",
						}}
					>
						Cancel
					</button>
				)}
				{isConnected && !inFlight && (
					<button
						type="button"
						onClick={handleSignOut}
						className={`${
							compact
								? "flex-1 text-xs px-3 py-1.5 rounded-lg"
								: "flex-1 text-sm px-4 py-2 rounded-xl font-semibold"
						} transition-all hover:opacity-90 cursor-pointer`}
						style={{
							background: "hsl(var(--muted))",
							color: "hsl(var(--foreground))",
						}}
					>
						Sign Out
					</button>
				)}
			</div>
		</div>
	);
}

function StatusBadge({
	connected,
	expires,
}: {
	connected: boolean;
	expires?: number;
}) {
	if (!connected) {
		return (
			<span
				className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-medium shrink-0"
				style={{
					background: "hsl(var(--muted))",
					color: "hsl(var(--muted-foreground))",
				}}
			>
				Not signed in
			</span>
		);
	}
	const label = formatExpiry(expires);
	return (
		<span
			className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-medium shrink-0"
			style={{
				background: "hsl(var(--primary) / 0.15)",
				color: "hsl(var(--primary))",
			}}
		>
			{label}
		</span>
	);
}

function formatExpiry(expires?: number): string {
	if (!expires) return "Connected";
	const now = Date.now();
	const ms = expires - now;
	if (ms <= 0) return "Refreshing…";
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `Connected · ${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `Connected · ${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `Connected · ${hours}h`;
	const days = Math.floor(hours / 24);
	return `Connected · ${days}d`;
}
