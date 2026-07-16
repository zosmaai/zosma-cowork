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
import { log } from "../lib/log";
import { type UnlistenFn, listen } from "@tauri-apps/api/event";
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
	anthropic: "Use your existing Claude Pro or Claude Max subscription instead of an API key.",
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
	const [userCode, setUserCode] = useState<string | null>(null);
	const [verificationUrl, setVerificationUrl] = useState<string | null>(null);
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
				log.warn("[provider-auth] get_auth_status failed:", retryErr);
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
		// Guard against async-cleanup race: in React StrictMode (dev) the
		// effect mounts → cleans → re-mounts before the async listen()
		// promise resolves. Without `mounted` tracking, the listener
		// registers AFTER cleanup ran, leaks forever, and accumulates one
		// extra phantom listener per mount cycle. The same race is hit by
		// Vite HMR re-running effects.
		let mounted = true;
		let unlisten: UnlistenFn | undefined;
		(async () => {
			const u = await listen("ready", () => refreshStatus());
			if (!mounted) {
				u();
				return;
			}
			unlisten = u;
		})();
		return () => {
			mounted = false;
			window.removeEventListener("config-reload", handler);
			unlisten?.();
		};
	}, [refreshStatus]);

	// Subscribe to OAuth lifecycle events emitted by Rust.
	useEffect(() => {
		// Same async-cleanup race as above — critical here because the
		// `oauth_open_url` listener calls `invoke("open_url", …)`, so each
		// leaked listener = one extra browser tab when the user clicks
		// Sign In. StrictMode + HMR can stack 3-4 leaks per session.
		let mounted = true;
		const unlisteners: UnlistenFn[] = [];
		(async () => {
			const us = await Promise.all([
				listen<{ provider: string; url: string; instructions?: string }>("oauth_open_url", (e) => {
					if (e.payload?.provider !== provider) return;
					setPhase("waiting_browser");
					// GitHub Copilot uses the device-flow and passes the 8-char user
					// code as `"Enter code: ABCD-1234"`. Extract and surface it so the
					// user can paste it into github.com/login/device. Loopback-redirect
					// providers (Anthropic, OpenAI Codex) pass freeform instructions
					// without a code — fall back to a plain "Opening browser…".
					const ins = e.payload.instructions ?? null;
					const m = ins?.match(/([A-Z0-9]{4}-?[A-Z0-9]{4})/);
					setStatusMessage(m ? "Authorize this device in your browser:" : "Opening browser…");
					setUserCode(m ? m[1] : null);
					setVerificationUrl(m ? e.payload.url : null);
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
					setUserCode(null);
					setVerificationUrl(null);
					setError(null);
					// Optimistic local update so the button flips to "Sign Out"
					// immediately, independent of any race or silent failure in
					// the subsequent get_auth_status round-trip.
					setAuthStatus((prev) => {
						const supported = prev?.supported ?? [provider];
						const others = (prev?.providers ?? []).filter((p) => p.id !== provider);
						return {
							supported,
							providers: [...others, { id: provider, type: "oauth" as const }],
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
					setUserCode(null);
					setVerificationUrl(null);
					setError(e.payload.error ?? "Sign-in failed");
				}),
				listen<{ provider: string }>("oauth_cancelled", (e) => {
					if (e.payload?.provider !== provider) return;
					setPhase("idle");
					setStatusMessage(null);
					setUserCode(null);
					setVerificationUrl(null);
					setError(null);
				}),
			]);
			if (!mounted) {
				for (const u of us) u();
				return;
			}
			unlisteners.push(...us);
		})();
		return () => {
			mounted = false;
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
		setUserCode(null);
		setVerificationUrl(null);
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
		setUserCode(null);
		setVerificationUrl(null);
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
			className={compact ? "space-y-2" : "w-full rounded-xl border p-4 space-y-3"}
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
						className={compact ? "text-xs font-medium" : "text-sm font-semibold"}
						style={{ color: "hsl(var(--foreground))" }}
					>
						Sign in with {label}
					</div>
					{!compact && description && (
						<p className="text-xs mt-1 text-muted-foreground">{description}</p>
					)}
				</div>
				<StatusBadge connected={isConnected} expires={entry?.expires} />
			</div>

			{statusMessage && <p className="text-xs text-muted-foreground">{statusMessage}</p>}
			{userCode && (
				<div
					className="rounded-lg p-3 space-y-2"
					style={{
						background: "hsl(var(--muted) / 0.4)",
						border: "1px dashed hsl(var(--border))",
					}}
				>
					<p className="text-xs text-muted-foreground">In the browser, enter this code:</p>
					<div className="flex items-center gap-2">
						<code className="flex-1 text-sm font-mono font-semibold tracking-widest text-center px-2 py-1.5 rounded-md select-all bg-background text-foreground">
							{userCode}
						</code>
						<button
							type="button"
							onClick={() => {
								void navigator.clipboard?.writeText(userCode);
							}}
							className="text-xs px-2 py-1.5 rounded-md transition-colors hover:opacity-90 bg-primary text-primary-foreground"
						>
							Copy
						</button>
					</div>
					{verificationUrl && (
						<p className="text-[10px] text-muted-foreground">
							at{" "}
							<a
								href={verificationUrl}
								onClick={(ev) => {
									ev.preventDefault();
									invoke("open_url", { url: verificationUrl }).catch(() => {
										window.open(verificationUrl, "_blank");
									});
								}}
								className="underline text-primary"
							>
								{verificationUrl}
							</a>
						</p>
					)}
				</div>
			)}
			{error && <p className="text-xs text-destructive">{error}</p>}

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
			<span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-md font-medium shrink-0 bg-muted text-muted-foreground">
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
