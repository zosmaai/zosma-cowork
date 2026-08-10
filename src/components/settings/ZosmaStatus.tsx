/**
 * ZosmaStatus — Connected-account controls for Zosma Router Auth.
 *
 * Renders in Settings alongside other provider rows. Shows connection status,
 * usage summary, and action buttons (Refresh models, Reconnect, Disconnect).
 *
 * Connection is derived from authStatus.apiKeyProviders containing
 * "zosmaai-router". Usage is fetched via get_zosma_usage.
 */

import { invoke } from "@tauri-apps/api/core";
import { AlertTriangle, Check, Loader2, RefreshCw, Signal, SignalHigh, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface ZosmaStatusProps {
	authStatus: Record<string, unknown> | null;
	onChange: () => void;
}

type Phase = "idle" | "starting" | "waiting_browser" | "error";

interface UsageProvider {
	provider: string;
	label: string;
	cap: number;
	used: number;
	remaining: number;
}

interface UsageDTO {
	plan?: string;
	used?: number;
	limit?: number;
	resetAt?: string;
	usageAvailable?: boolean;
	providers?: UsageProvider[];
	resetsInHours?: number;
	expiresAt?: string;
	daysLeft?: number;
	expired?: boolean;
}

const ZOSMA_PROVIDER_ID = "zosmaai-router";

export function ZosmaStatus({ authStatus, onChange }: ZosmaStatusProps) {
	const isConnected = hasConnectedProvider(authStatus);
	const [showConfirmDisconnect, setShowConfirmDisconnect] = useState(false);
	const [disconnectDone, setDisconnectDone] = useState(false);
	const [usage, setUsage] = useState<UsageDTO | null>(null);
	const [usageError, setUsageError] = useState<string | null>(null);
	const [refreshing, setRefreshing] = useState(false);
	const [refreshError, setRefreshError] = useState<string | null>(null);
	const [phase, setPhase] = useState<Phase>("idle");
	const [error, setError] = useState<string | null>(null);
	const [modelCount, setModelCount] = useState<number | null>(null);

	// Fetch usage on mount
	useEffect(() => {
		if (!isConnected) return;
		let cancelled = false;
		(async () => {
			try {
				const data = await invoke<UsageDTO>("get_zosma_usage");
				if (!cancelled) setUsage(data);
			} catch (err) {
				if (!cancelled) setUsageError(err instanceof Error ? err.message : "Failed to load usage");
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [isConnected]);

	// ── Refresh models ────────────────────────────────────────────────────

	const handleRefresh = useCallback(async () => {
		setRefreshing(true);
		setRefreshError(null);
		try {
			const result = await invoke<{ modelCount: number; selectedModelId: string }>(
				"refresh_zosma_models",
			);
			setModelCount(result.modelCount);
			// Re-fetch usage after refresh
			const data = await invoke<UsageDTO>("get_zosma_usage");
			setUsage(data);
			window.dispatchEvent(new CustomEvent("config-reload"));
			onChange();
		} catch (err) {
			setRefreshError(err instanceof Error ? err.message : "Refresh failed");
		} finally {
			setRefreshing(false);
		}
	}, [onChange]);

	// ── Reconnect ─────────────────────────────────────────────────────────

	const handleReconnect = useCallback(async () => {
		setPhase("starting");
		setError(null);
		try {
			const result = await invoke<{ authorizationUrl: string }>("start_zosma_auth");
			setPhase("waiting_browser");
			await invoke("open_url", { url: result.authorizationUrl });
		} catch (err) {
			setPhase("error");
			setError(err instanceof Error ? err.message : "Connection failed");
		}
	}, []);

	// ── Disconnect ────────────────────────────────────────────────────────

	const handleDisconnectConfirm = useCallback(async () => {
		setShowConfirmDisconnect(false);
		try {
			await invoke("disconnect_zosma_auth");
			setDisconnectDone(true);
			setUsage(null);
			setModelCount(null);
			window.dispatchEvent(new CustomEvent("config-reload"));
			onChange();
		} catch {
			// Even if server-side fails, local removal happened;
			// reload config to reflect it.
			setDisconnectDone(true);
			setUsage(null);
			setModelCount(null);
			window.dispatchEvent(new CustomEvent("config-reload"));
			onChange();
		}
	}, [onChange]);

	if (disconnectDone) {
		return null;
	}

	if (!isConnected) {
		return (
			<div className="glass overflow-hidden">
				<div className="px-3.5 py-3">
					<div className="flex items-center gap-3">
						<Signal className="w-5 h-5 shrink-0 text-foreground/60" />
						<span className="flex-1 text-[0.8125rem] text-foreground min-w-0 truncate">
							Zosma AI Router
						</span>
						{phase === "starting" || phase === "waiting_browser" ? (
							<span className="flex items-center gap-1 text-[0.625rem] px-1.5 py-0.5 rounded-full bg-muted/50 text-muted-foreground">
								<Loader2 className="w-3 h-3 animate-spin" />
								Waiting for browser…
							</span>
						) : (
							<button
								type="button"
								onClick={handleReconnect}
								className="text-[0.6875rem] font-medium text-primary hover:text-primary/80 transition-colors"
							>
								Connect
							</button>
						)}
					</div>
					{phase === "error" && error && (
						<p className="text-[0.6875rem] text-destructive mt-2">{error}</p>
					)}
				</div>
			</div>
		);
	}

	return (
		<div className="glass overflow-hidden">
			<div className="px-3.5 py-3">
				{/* Header row */}
				<div className="flex items-center gap-3 mb-2">
					<SignalHigh className="w-5 h-5 shrink-0 text-foreground/60" />
					<span className="flex-1 text-[0.8125rem] text-foreground min-w-0 truncate">
						Zosma AI Router
					</span>
					<span className="flex items-center gap-1 text-[0.625rem] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
						<span className="w-1.5 h-1.5 rounded-full bg-primary" />
						Connected
					</span>
				</div>

				{/* Model count */}
				{modelCount !== null && (
					<p className="text-[0.75rem] text-muted-foreground">{modelCount} models</p>
				)}

				{/* Usage summary */}
				{usage &&
					(usage.plan ||
						usage.providers?.length ||
						usage.used !== undefined ||
						usage.expiresAt) && (
						<div className="text-[0.75rem] text-muted-foreground mt-1 space-y-1">
							{usage.plan && <p>Plan: {usage.plan}</p>}
							{usage.usageAvailable !== false &&
								usage.providers?.map((provider) => (
									<div key={provider.provider} className="flex items-center justify-between gap-3">
										<span>{provider.label}</span>
										<span className="tabular-nums">
											{provider.used.toLocaleString()} / {provider.cap.toLocaleString()}
										</span>
									</div>
								))}
							{usage.usageAvailable !== false &&
								!usage.providers?.length &&
								usage.used !== undefined &&
								usage.limit !== undefined && (
									<p>
										Usage: {usage.used.toLocaleString()} / {usage.limit.toLocaleString()}
									</p>
								)}
							{usage.usageAvailable === false && <p>Usage temporarily unavailable</p>}
							{usage.resetsInHours !== undefined && (
								<p>Resets in {Math.max(0, Math.ceil(usage.resetsInHours))} hours</p>
							)}
							{usage.resetAt && <p>Resets: {new Date(usage.resetAt).toLocaleDateString()}</p>}
							{usage.expiresAt && (
								<p>Access until {new Date(usage.expiresAt).toLocaleDateString()}</p>
							)}
							{usage.daysLeft !== undefined && <p>{usage.daysLeft} days left</p>}
						</div>
					)}
				{usageError && (
					<p className="text-[0.6875rem] text-muted-foreground mt-1">Usage data unavailable</p>
				)}
				{!usage && !usageError && (
					<p className="text-[0.6875rem] text-muted-foreground mt-1">No usage data</p>
				)}

				{/* Action buttons */}
				<div className="flex items-center gap-2 mt-3">
					<button
						type="button"
						onClick={handleRefresh}
						disabled={refreshing}
						className="flex items-center gap-1 text-[0.6875rem] font-medium px-2 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
					>
						<RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
						Refresh
					</button>
					{showConfirmDisconnect ? (
						<>
							<span className="text-[0.6875rem] text-muted-foreground">Are you sure?</span>
							<button
								type="button"
								onClick={handleDisconnectConfirm}
								className="flex items-center gap-1 text-[0.6875rem] font-medium px-2 py-1 rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
							>
								<Check className="w-3 h-3" />
								Confirm disconnect
							</button>
							<button
								type="button"
								onClick={() => setShowConfirmDisconnect(false)}
								className="text-[0.6875rem] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
							>
								Cancel
							</button>
						</>
					) : (
						<button
							type="button"
							onClick={() => setShowConfirmDisconnect(true)}
							className="flex items-center gap-1 text-[0.6875rem] font-medium px-2 py-1 rounded-md bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
						>
							<Trash2 className="w-3 h-3" />
							Disconnect
						</button>
					)}
				</div>

				{/* Refresh error */}
				{refreshError && (
					<p className="text-[0.6875rem] text-destructive mt-2 flex items-center gap-1">
						<AlertTriangle className="w-3 h-3" />
						{refreshError}
					</p>
				)}
			</div>
		</div>
	);
}

/**
 * Check if the zosmaai-router managed provider is configured.
 * Reads from authStatus.apiKeyProviders which comes from modelRegistry.getAll().
 */
function hasConnectedProvider(authStatus: Record<string, unknown> | null): boolean {
	if (!authStatus) return false;
	const providers = authStatus.apiKeyProviders;
	if (!Array.isArray(providers)) return false;
	return providers.some(
		(p) =>
			typeof p === "object" &&
			p !== null &&
			(p as Record<string, unknown>).id === ZOSMA_PROVIDER_ID,
	);
}
