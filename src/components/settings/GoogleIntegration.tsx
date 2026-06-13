/**
 * Google Integration card — the B3 bespoke setup screen for Google Workspace.
 *
 * Single "Connect Google" button triggers the brokered OAuth consent
 * (loopback + PKCE, union scopes for Gmail/Calendar/Drive/Docs/Sheets/Slides),
 * then fans credentials out to the real package config files so every pi
 * extension works immediately.
 *
 * Once connected, shows the account email, per-product scope checkmarks and
 * a Disconnect button that revokes + deletes all local tokens.
 */

import { invoke } from "@tauri-apps/api/core";
import { type UnlistenFn, listen } from "@tauri-apps/api/event";
import {
	Calendar,
	Check,
	FileText,
	Loader2,
	Mail,
	Presentation,
	Table,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type GoogleProduct = "gmail" | "calendar" | "drive" | "docs" | "sheets" | "slides";
type Phase = "idle" | "connecting" | "waiting_browser" | "exchanging" | "done";

interface GoogleStatus {
	connected: boolean;
	email: string | null;
	scopes: string[];
	products: Record<GoogleProduct, boolean>;
	destinations: {
		workspaceOAuth: { present: boolean; path: string };
		gmailSettings: { present: boolean };
		gmailTokens: { present: boolean; path: string };
	};
}

const PRODUCT_CONFIG: {
	id: GoogleProduct;
	label: string;
	Icon: React.ComponentType<{ className?: string }>;
}[] = [
	{ id: "gmail", label: "Gmail", Icon: Mail },
	{ id: "calendar", label: "Calendar", Icon: Calendar },
	{ id: "drive", label: "Drive", Icon: Table },
	{ id: "docs", label: "Docs", Icon: FileText },
	{ id: "sheets", label: "Sheets", Icon: Table },
	{ id: "slides", label: "Slides", Icon: Presentation },
];

export function GoogleIntegration() {
	const [status, setStatus] = useState<GoogleStatus | null>(null);
	const [phase, setPhase] = useState<Phase>("idle");
	const [error, setError] = useState<string | null>(null);
	const [connectedEmail, setConnectedEmail] = useState<string | null>(null);
	const urlOpenedRef = useRef(false);

	// ── Refresh status from sidecar ─────────────────────────────────
	const refreshStatus = useCallback(async () => {
		try {
			const data = await invoke<GoogleStatus>("google_get_status");
			setStatus(data);
			if (data.connected) {
				setConnectedEmail(data.email);
			}
		} catch {
			// transient — sidecar may not be ready
		}
	}, []);

	useEffect(() => {
		refreshStatus();
	}, [refreshStatus]);

	// ── Listen for OAuth events (same events as AuthRow, filtered by provider="google") ──
	useEffect(() => {
		let mounted = true;
		urlOpenedRef.current = false;
		const unlisteners: UnlistenFn[] = [];

		(async () => {
			const us = await Promise.all([
				listen<{ provider: string; url: string; instructions?: string }>("oauth_open_url", (e) => {
					if (e.payload?.provider !== "google") return;
					if (urlOpenedRef.current) return;
					urlOpenedRef.current = true;
					setPhase("waiting_browser");
					setError(null);
					invoke("open_url", { url: e.payload.url });
				}),
				listen<{ provider: string; message: string }>("oauth_progress", (e) => {
					if (e.payload?.provider !== "google") return;
					const msg = e.payload.message ?? "";
					if (msg.toLowerCase().includes("token") || msg.toLowerCase().includes("granted")) {
						setPhase("exchanging");
					}
				}),
				listen<{ provider: string; email?: string }>("oauth_completed", (e) => {
					if (e.payload?.provider !== "google") return;
					setPhase("done");
					setConnectedEmail(e.payload?.email ?? null);
					setError(null);
					refreshStatus();
					setTimeout(() => setPhase("idle"), 0);
				}),
				listen<{ provider: string; error?: string }>("oauth_failed", (e) => {
					if (e.payload?.provider !== "google") return;
					setPhase("idle");
					setError(e.payload?.error ?? "Connection failed");
				}),
				listen<{ provider: string }>("oauth_cancelled", (e) => {
					if (e.payload?.provider !== "google") return;
					setPhase("idle");
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
	}, [refreshStatus]);

	// ── Connect handler ─────────────────────────────────────────────
	const handleConnect = useCallback(async () => {
		setError(null);
		setPhase("connecting");
		try {
			await invoke("google_connect");
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setPhase("idle");
		}
	}, []);

	// ── Disconnect handler ──────────────────────────────────────────
	const handleDisconnect = useCallback(async () => {
		setError(null);
		try {
			await invoke("google_disconnect");
			setConnectedEmail(null);
			setStatus(null);
			refreshStatus();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, [refreshStatus]);

	// ── Derived state ───────────────────────────────────────────────
	const connected = status?.connected ?? false;
	const products = status?.products ?? ({} as Record<GoogleProduct, boolean>);
	const inFlight = phase !== "idle" && phase !== "done";

	return (
		<div className="rounded-lg border border-border overflow-hidden bg-card">
			{/* Header row */}
			<div className="px-3.5 py-3">
				<div className="flex items-center gap-3">
					<span className="flex-1">
						<span className="text-[13px] font-semibold text-foreground">Google Workspace</span>
						{connected && connectedEmail && (
							<span className="block text-[11px] text-muted-foreground mt-0.5">
								{connectedEmail}
							</span>
						)}
					</span>

					{connected ? (
						<button
							type="button"
							onClick={handleDisconnect}
							disabled={inFlight}
							className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border border-border text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
							title="Revoke Google tokens and disconnect all services"
						>
							<Trash2 className="w-3 h-3" />
							Disconnect
						</button>
					) : inFlight ? (
						<div className="flex items-center gap-1.5 text-xs text-muted-foreground text-[11px] px-2.5 py-1.5 rounded-md border border-border">
							<Loader2 className="w-3 h-3 animate-spin" />
							{phase === "connecting" && "Opening browser…"}
							{phase === "waiting_browser" && "Waiting for consent…"}
							{phase === "exchanging" && "Exchanging tokens…"}
						</div>
					) : (
						<button
							type="button"
							onClick={handleConnect}
							className="text-[11px] px-2.5 py-1.5 rounded-md border border-border text-foreground hover:bg-muted/50 transition-colors"
						>
							Connect
						</button>
					)}
				</div>
			</div>

			{/* Connected — show per-product scope badges */}
			{connected && (
				<div className="px-3.5 pb-3 pt-0" style={{ borderTop: "1px solid hsl(var(--border))" }}>
					<div className="pt-2.5 flex flex-wrap gap-1.5">
						{PRODUCT_CONFIG.map(({ id, label, Icon }) => {
							const granted = products[id] ?? false;
							return (
								<span
									key={id}
									className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors"
									style={{
										background: granted ? "hsl(var(--primary) / 0.1)" : "hsl(var(--muted) / 0.3)",
										color: granted ? "hsl(var(--primary))" : "hsl(var(--muted-foreground) / 0.6)",
										border: granted
											? "1px solid hsl(var(--primary) / 0.15)"
											: "1px solid hsl(var(--border))",
									}}
								>
									{granted ? (
										<Check className="w-2.5 h-2.5" />
									) : (
										<Icon className="w-2.5 h-2.5 opacity-40" />
									)}
									{label}
								</span>
							);
						})}
					</div>
				</div>
			)}

			{/* Error message */}
			{error && (
				<div
					className="px-3.5 pb-3"
					style={{ borderTop: connected || error ? "1px solid hsl(var(--border))" : undefined }}
				>
					<p className="pt-2.5 text-xs text-destructive">{error}</p>
				</div>
			)}
		</div>
	);
}
