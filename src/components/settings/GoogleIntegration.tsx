/**
 * Google Integration card — the Google Workspace "app" setup screen (#281).
 *
 * Default one-click **Connect** runs the brokered OAuth consent for the
 * Full-access preset (unchanged behaviour). An **Advanced** disclosure exposes
 * per-product capability radios (Off → full), a live "scopes Google will ask
 * for" summary with sensitivity-tier badges, and a **Use my own OAuth client**
 * toggle (id + secret). The selection is persisted Cowork-side
 * (`~/.zosmaai/cowork/google-workspace/`) and drives the actual consent scopes;
 * resulting tokens still fan out to pi's config files so every extension works.
 *
 * Connected state shows the account email, each product's GRANTED capability
 * (granted-vs-requested), whether a BYO client is in use, and Disconnect
 * (revoke + clear every written destination + the Cowork prefs/BYO files).
 */

import { invoke } from "@tauri-apps/api/core";
import { type UnlistenFn, listen } from "@tauri-apps/api/event";
import {
	Calendar,
	Check,
	ChevronDown,
	Download,
	ExternalLink,
	FileText,
	HardDrive,
	KeyRound,
	Loader2,
	Mail,
	Package,
	Presentation,
	ShieldAlert,
	Table2,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type GoogleProduct = "drive" | "gmail" | "calendar" | "docs" | "sheets" | "slides";
type ScopeTier = "recommended" | "sensitive" | "restricted";
type Phase = "idle" | "connecting" | "waiting_browser" | "exchanging" | "done";

interface Capability {
	id: string;
	label: string;
	scopes: string[];
	tier?: ScopeTier;
}
type ScopePrefs = Record<GoogleProduct, string>;
type Matrix = Record<GoogleProduct, Capability[]>;

interface GooglePrefsData {
	matrix: Matrix;
	defaults: ScopePrefs;
	prefs: ScopePrefs;
	requestedScopes: string[];
	requestedTier: ScopeTier | null;
	byo: { clientId: string; configured: boolean } | null;
}

interface GoogleStatus {
	connected: boolean;
	email: string | null;
	scopes: string[];
	products: Record<GoogleProduct, boolean>;
	granted: Record<GoogleProduct, string>;
	requested?: ScopePrefs;
	requestedTier?: ScopeTier | null;
	byo: boolean;
	destinations: {
		workspaceOAuth: { present: boolean; path: string };
		gmailSettings: { present: boolean };
		gmailTokens: { present: boolean; path: string };
	};
}

interface AppExtStatus {
	requirements: { pkg: string; label: string; installed: boolean }[];
	missing: string[];
	allInstalled: boolean;
}

const PRODUCT_CONFIG: {
	id: GoogleProduct;
	label: string;
	Icon: React.ComponentType<{ className?: string }>;
}[] = [
	{ id: "gmail", label: "Gmail", Icon: Mail },
	{ id: "calendar", label: "Calendar", Icon: Calendar },
	{ id: "drive", label: "Drive", Icon: HardDrive },
	{ id: "docs", label: "Docs", Icon: FileText },
	{ id: "sheets", label: "Sheets", Icon: Table2 },
	{ id: "slides", label: "Slides", Icon: Presentation },
];

const TIER_RANK: Record<ScopeTier, number> = { recommended: 0, sensitive: 1, restricted: 2 };
const TIER_LABEL: Record<ScopeTier, string> = {
	recommended: "Recommended",
	sensitive: "Sensitive",
	restricted: "Restricted",
};

/** Tier badge colours — green (safe) → amber → red, matching consent severity. */
function tierStyle(tier: ScopeTier): React.CSSProperties {
	const map: Record<ScopeTier, [string, string]> = {
		recommended: ["hsl(142 70% 45% / 0.12)", "hsl(142 70% 45%)"],
		sensitive: ["hsl(38 92% 50% / 0.14)", "hsl(38 92% 50%)"],
		restricted: ["hsl(0 80% 60% / 0.12)", "hsl(0 80% 62%)"],
	};
	const [bg, fg] = map[tier];
	return { background: bg, color: fg, border: `1px solid ${fg.replace(")", " / 0.25)")}` };
}

const GOOGLE_CLOUD_CONSOLE = "https://console.cloud.google.com/apis/credentials";
const GOOGLE_CONSENT_SCREEN = "https://console.cloud.google.com/apis/credentials/consent";
const GOOGLE_API_LIBRARY = "https://console.cloud.google.com/apis/library";

/** Step-by-step guide shown when the user brings their own OAuth client. */
const BYO_STEPS: { title: string; body: React.ReactNode; url?: string; urlLabel?: string }[] = [
	{
		title: "Configure the OAuth consent screen",
		body: "Pick External, add an app name + your email, then add yourself under Test users (no Google review needed while testing).",
		url: GOOGLE_CONSENT_SCREEN,
		urlLabel: "Open consent screen",
	},
	{
		title: "Enable the APIs you'll use",
		body: "Enable Gmail, Drive, Docs, Sheets, Slides, and Calendar APIs — only the ones you turn on above are needed.",
		url: GOOGLE_API_LIBRARY,
		urlLabel: "Open API library",
	},
	{
		title: "Create the OAuth client",
		body: (
			<>
				Credentials → Create credentials → OAuth client ID. Set Application type to{" "}
				<span className="font-semibold text-foreground">Desktop app</span> — this lets Cowork use a
				local <code className="text-[10px]">127.0.0.1</code> sign-in without registering a redirect
				URL.
			</>
		),
		url: GOOGLE_CLOUD_CONSOLE,
		urlLabel: "Open credentials",
	},
	{
		title: "Paste the Client ID + secret below",
		body: "Copy them from the dialog Google shows after creating the client, then click Connect. Stored locally (chmod 0600) — never uploaded.",
	},
];

/** Resolve the consent scope list from a selection (mirrors sidecar resolveScopes). */
function computeScopes(matrix: Matrix | null, prefs: ScopePrefs): string[] {
	const out = new Set<string>(["openid", "email", "profile"]);
	if (!matrix) return [...out];
	for (const product of PRODUCT_CONFIG) {
		const cap = matrix[product.id]?.find((c) => c.id === prefs[product.id]);
		for (const s of cap?.scopes ?? []) if (s) out.add(s);
	}
	return [...out];
}

function worstTier(matrix: Matrix | null, prefs: ScopePrefs): ScopeTier | null {
	if (!matrix) return null;
	let worst: ScopeTier | null = null;
	for (const product of PRODUCT_CONFIG) {
		const cap = matrix[product.id]?.find((c) => c.id === prefs[product.id]);
		if (!cap?.tier) continue;
		if (worst === null || TIER_RANK[cap.tier] > TIER_RANK[worst]) worst = cap.tier;
	}
	return worst;
}

function prefsEqual(a: ScopePrefs, b: ScopePrefs): boolean {
	return PRODUCT_CONFIG.every((p) => a[p.id] === b[p.id]);
}

const EMPTY_PREFS: ScopePrefs = {
	drive: "off",
	gmail: "off",
	calendar: "off",
	docs: "off",
	sheets: "off",
	slides: "off",
};

export function GoogleIntegration() {
	const [status, setStatus] = useState<GoogleStatus | null>(null);
	const [statusLoading, setStatusLoading] = useState(true);
	const [phase, setPhase] = useState<Phase>("idle");
	const [error, setError] = useState<string | null>(null);
	const [connectedEmail, setConnectedEmail] = useState<string | null>(null);
	const urlOpenedRef = useRef(false);

	// Advanced panel state
	const [advanced, setAdvanced] = useState(false);
	const [matrix, setMatrix] = useState<Matrix | null>(null);
	const [defaults, setDefaults] = useState<ScopePrefs>(EMPTY_PREFS);
	const [prefs, setPrefs] = useState<ScopePrefs>(EMPTY_PREFS);
	const [useByo, setUseByo] = useState(false);
	const [byoId, setByoId] = useState("");
	const [byoSecret, setByoSecret] = useState("");
	const [byoConfigured, setByoConfigured] = useState(false);

	// App-extension install gating
	const [appStatus, setAppStatus] = useState<AppExtStatus | null>(null);
	const [installing, setInstalling] = useState(false);

	// ── Refresh status from sidecar ─────────────────────────────────
	const refreshStatus = useCallback(async () => {
		try {
			const data = await invoke<GoogleStatus>("google_get_status");
			setStatus(data);
			if (data.connected) setConnectedEmail(data.email);
		} catch {
			// transient — sidecar may not be ready
		} finally {
			setStatusLoading(false);
		}
	}, []);

	const loadPrefs = useCallback(async () => {
		try {
			const data = await invoke<GooglePrefsData>("google_get_prefs");
			setMatrix(data.matrix);
			setDefaults(data.defaults);
			setPrefs(data.prefs);
			setByoConfigured(Boolean(data.byo?.configured));
			setByoId(data.byo?.clientId ?? "");
			setUseByo(Boolean(data.byo?.configured));
		} catch {
			// non-fatal — Advanced just stays unavailable until ready
		}
	}, []);

	const refreshAppStatus = useCallback(async (p: ScopePrefs) => {
		try {
			const data = await invoke<AppExtStatus>("google_get_app_status", { prefs: p });
			setAppStatus(data);
		} catch {
			// non-fatal
		}
	}, []);

	useEffect(() => {
		refreshStatus();
		loadPrefs();
	}, [refreshStatus, loadPrefs]);

	// Recompute which extensions the current selection needs whenever it changes.
	useEffect(() => {
		refreshAppStatus(prefs);
	}, [prefs, refreshAppStatus]);

	// ── OAuth events (shared with AuthRow, filtered by provider="google") ──
	useEffect(() => {
		let mounted = true;
		urlOpenedRef.current = false;
		const unlisteners: UnlistenFn[] = [];
		(async () => {
			const us = await Promise.all([
				listen<{ provider: string; url: string }>("oauth_open_url", (e) => {
					if (e.payload?.provider !== "google") return;
					if (urlOpenedRef.current) return;
					urlOpenedRef.current = true;
					setPhase("waiting_browser");
					setError(null);
					invoke("open_url", { url: e.payload.url });
				}),
				listen<{ provider: string; message: string }>("oauth_progress", (e) => {
					if (e.payload?.provider !== "google") return;
					const msg = (e.payload.message ?? "").toLowerCase();
					if (msg.includes("token") || msg.includes("granted")) setPhase("exchanging");
				}),
				listen<{ provider: string; email?: string }>("oauth_completed", (e) => {
					if (e.payload?.provider !== "google") return;
					setPhase("done");
					setConnectedEmail(e.payload?.email ?? null);
					setError(null);
					refreshStatus();
					loadPrefs();
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
	}, [refreshStatus, loadPrefs]);

	// ── Connect ─────────────────────────────────────────────────────
	const handleConnect = useCallback(async () => {
		setError(null);
		// Auto-install any missing app extensions BEFORE consent (#281). An app
		// is its extensions + auth — so connecting installs what the selection
		// needs first (no separate Install step), mirroring Discord's flow.
		if (appStatus && !appStatus.allInstalled) {
			setInstalling(true);
			try {
				const data = await invoke<AppExtStatus>("google_install_app", { prefs });
				setAppStatus(data);
				if (!data.allInstalled) {
					setError("Could not install the required extensions. Please try again.");
					return;
				}
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
				return;
			} finally {
				setInstalling(false);
			}
		}
		setPhase("connecting");
		urlOpenedRef.current = false;
		try {
			const byo =
				useByo && byoId.trim() && byoSecret.trim()
					? { clientId: byoId.trim(), clientSecret: byoSecret.trim() }
					: useByo && byoConfigured
						? undefined // keep the already-saved BYO secret
						: !useByo
							? null // clear BYO → Zosma client
							: undefined;
			await invoke("google_connect", { prefs, byo });
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setPhase("idle");
		}
	}, [prefs, useByo, byoId, byoSecret, byoConfigured, appStatus]);

	const handleDisconnect = useCallback(async () => {
		setError(null);
		try {
			await invoke("google_disconnect");
			setConnectedEmail(null);
			setStatus(null);
			refreshStatus();
			loadPrefs();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, [refreshStatus, loadPrefs]);

	// ── Derived ─────────────────────────────────────────────────────
	const connected = status?.connected ?? false;
	// First-load gate — show a skeleton instead of flashing the Connect button
	// before we know whether the account is already connected.
	const firstLoad = statusLoading && status === null;
	const granted = status?.granted ?? ({} as Record<GoogleProduct, string>);
	const inFlight = phase !== "idle" && phase !== "done";
	const liveScopes = useMemo(() => computeScopes(matrix, prefs), [matrix, prefs]);
	const liveTier = useMemo(() => worstTier(matrix, prefs), [matrix, prefs]);
	const dirty = useMemo(
		() => connected && !prefsEqual(prefs, status?.requested ?? prefs),
		[connected, prefs, status],
	);
	const byoNeedsCreds = useByo && !byoConfigured && (!byoId.trim() || !byoSecret.trim());
	// Auth is gated on the selection's extensions being installed (Calendar is
	// built-in so a calendar-only selection needs none → allInstalled true).
	const needsInstall = !connected && appStatus !== null && !appStatus.allInstalled;

	const setProduct = (product: GoogleProduct, capId: string) =>
		setPrefs((p) => ({ ...p, [product]: capId }));

	const capLabel = (product: GoogleProduct, capId: string) =>
		matrix?.[product]?.find((c) => c.id === capId)?.label ?? capId;

	return (
		<div className="glass overflow-hidden">
			{/* Header row */}
			<div className="px-3.5 py-3">
				<div className="flex items-center gap-3">
					<span className="flex-1">
						<span className="text-[13px] font-semibold text-foreground">Google Workspace</span>
						{firstLoad && (
							<span className="block h-2.5 w-32 rounded bg-muted/70 animate-pulse mt-1" />
						)}
						{!firstLoad && connected && connectedEmail && (
							<span className="block text-[11px] text-muted-foreground mt-0.5">
								{connectedEmail}
								{status?.byo && (
									<span className="ml-1.5 inline-flex items-center gap-1 text-primary">
										<KeyRound className="w-2.5 h-2.5" /> own client
									</span>
								)}
							</span>
						)}
					</span>

					{firstLoad ? (
						<div className="h-[30px] w-24 rounded-md bg-muted/70 animate-pulse" />
					) : connected ? (
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
					) : installing ? (
						<div className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border border-border text-muted-foreground">
							<Loader2 className="w-3 h-3 animate-spin" />
							Installing extensions…
						</div>
					) : (
						<button
							type="button"
							onClick={handleConnect}
							disabled={byoNeedsCreds}
							className={`flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border transition-colors disabled:opacity-50 ${
								needsInstall
									? "bg-primary/15 border-primary/30 text-primary hover:bg-primary/20"
									: "border-border text-foreground hover:bg-muted/50"
							}`}
							title={
								needsInstall
									? "Installs the required extensions, then connects"
									: "Run Google consent"
							}
						>
							{needsInstall && <Download className="w-3 h-3" />}
							Connect
						</button>
					)}
				</div>
			</div>

			{/* Not connected — show the app's required extensions + install state */}
			{!firstLoad && !connected && appStatus && appStatus.requirements.length > 0 && (
				<div className="px-3.5 pb-3 pt-0 border-t border-elev-border/60">
					<p className="pt-2.5 text-[10px] text-muted-foreground mb-1.5">
						{needsInstall
							? "Connecting installs these extensions automatically:"
							: "Powered by these installed extensions:"}
					</p>
					<div className="flex flex-wrap gap-1.5">
						{appStatus.requirements.map((req) => (
							<span
								key={req.pkg}
								className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
									req.installed
										? "bg-primary/10 text-primary border-primary/15"
										: "bg-muted/30 text-muted-foreground border-border"
								}`}
								title={req.pkg}
							>
								{req.installed ? (
									<Check className="w-2.5 h-2.5" />
								) : (
									<Package className="w-2.5 h-2.5 opacity-60" />
								)}
								{req.label}
							</span>
						))}
					</div>
				</div>
			)}

			{/* Connected — show per-product GRANTED capability */}
			{connected && (
				<div className="px-3.5 pb-3 pt-0 border-t border-[hsl(var(--elev-border)/0.6)]">
					<div className="pt-2.5 flex flex-wrap gap-1.5">
						{PRODUCT_CONFIG.map(({ id, label, Icon }) => {
							const cap = granted[id] ?? "off";
							const on = cap !== "off";
							return (
								<span
									key={id}
									className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors border ${
										on
											? "bg-primary/10 text-primary border-primary/15"
											: "bg-muted/30 text-muted-foreground/60 border-border"
									}`}
									title={on ? `${label}: ${capLabel(id, cap)}` : `${label}: not granted`}
								>
									{on ? (
										<Check className="w-2.5 h-2.5" />
									) : (
										<Icon className="w-2.5 h-2.5 opacity-40" />
									)}
									{label}
									{on && cap !== "full" && (
										<span className="opacity-70">· {capLabel(id, cap)}</span>
									)}
								</span>
							);
						})}
					</div>
				</div>
			)}

			{/* Advanced disclosure */}
			<div className="border-t border-[hsl(var(--elev-border)/0.6)]">
				<button
					type="button"
					onClick={() => setAdvanced((v) => !v)}
					className="w-full flex items-center gap-1.5 px-3.5 py-2 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
				>
					<ChevronDown className={`w-3 h-3 transition-transform ${advanced ? "" : "-rotate-90"}`} />
					Advanced — choose what to share
					{liveTier && (
						<span
							className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium"
							style={tierStyle(liveTier)}
						>
							{liveTier === "restricted" && <ShieldAlert className="w-2.5 h-2.5" />}
							{TIER_LABEL[liveTier]}
						</span>
					)}
				</button>

				{advanced && (
					<div className="px-3.5 pb-3.5 space-y-3">
						{/* Per-product capability radios */}
						<div className="space-y-2">
							{PRODUCT_CONFIG.map(({ id, label, Icon }) => {
								const caps = matrix?.[id] ?? [];
								return (
									<div key={id} className="flex items-start gap-2.5">
										<span className="flex items-center gap-1.5 w-20 shrink-0 pt-1 text-[11px] text-foreground/80">
											<Icon className="w-3 h-3 text-muted-foreground" />
											{label}
										</span>
										<div className="flex flex-wrap gap-1">
											{caps.map((cap) => {
												const active = prefs[id] === cap.id;
												return (
													<button
														key={cap.id}
														type="button"
														onClick={() => setProduct(id, cap.id)}
														className={`px-2 py-0.5 rounded-md text-[10px] font-medium border transition-colors ${
															active
																? "bg-primary/15 text-primary border-primary/30"
																: "bg-transparent text-muted-foreground border-border"
														}`}
														title={cap.tier ? `${cap.label} · ${TIER_LABEL[cap.tier]}` : cap.label}
													>
														{cap.label}
													</button>
												);
											})}
										</div>
									</div>
								);
							})}
						</div>

						{/* Quick presets */}
						<div className="flex items-center gap-2 text-[10px]">
							<span className="text-muted-foreground">Presets:</span>
							<button
								type="button"
								onClick={() => setPrefs({ ...defaults })}
								className="px-1.5 py-0.5 rounded border border-border hover:bg-muted/50 text-foreground/80"
							>
								Full access
							</button>
							<button
								type="button"
								onClick={() => setPrefs({ ...EMPTY_PREFS })}
								className="px-1.5 py-0.5 rounded border border-border hover:bg-muted/50 text-foreground/80"
							>
								Off
							</button>
						</div>

						{/* Live scope summary */}
						<div className="rounded-md bg-muted/30 border border-[hsl(var(--elev-border)/0.6)] p-2">
							<p className="text-[10px] text-muted-foreground mb-1">
								Google will be asked for {liveScopes.length} scope
								{liveScopes.length === 1 ? "" : "s"}:
							</p>
							<div className="flex flex-wrap gap-1">
								{liveScopes.map((s) => (
									<code
										key={s}
										className="text-[9px] px-1 py-0.5 rounded bg-background/60 text-foreground/70"
									>
										{s.replace("https://www.googleapis.com/auth/", "").replace("https://", "")}
									</code>
								))}
							</div>
						</div>

						{/* Bring your own client */}
						<div className="rounded-md border border-[hsl(var(--elev-border)/0.6)] p-2.5">
							<label className="flex items-center gap-2 text-[11px] text-foreground/90 cursor-pointer">
								<input
									type="checkbox"
									checked={useByo}
									onChange={(e) => setUseByo(e.target.checked)}
									className="accent-[hsl(var(--primary))]"
								/>
								<KeyRound className="w-3 h-3 text-muted-foreground" />
								Use my own Google OAuth client
							</label>
							{useByo && (
								<div className="mt-2.5 space-y-2.5">
									<p className="text-[10px] text-muted-foreground leading-relaxed">
										Use your own Google Cloud project instead of Zosma's — your own quota, full
										control, and tokens never touch the Zosma broker.
									</p>

									{/* Numbered setup guide */}
									<ol className="space-y-2">
										{BYO_STEPS.map((step, i) => (
											<li key={step.title} className="flex gap-2.5">
												<span className="shrink-0 mt-0.5 w-4 h-4 rounded-full bg-primary/15 text-primary text-[9px] font-bold flex items-center justify-center">
													{i + 1}
												</span>
												<div className="min-w-0">
													<p className="text-[11px] font-medium text-foreground/90 leading-snug">
														{step.title}
													</p>
													<p className="text-[10px] text-muted-foreground leading-relaxed mt-0.5">
														{step.body}
													</p>
													{step.url && (
														<button
															type="button"
															onClick={() => invoke("open_url", { url: step.url })}
															className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline mt-1"
														>
															{step.urlLabel}
															<ExternalLink className="w-2.5 h-2.5" />
														</button>
													)}
												</div>
											</li>
										))}
									</ol>

									<div className="space-y-1.5 pt-0.5">
										<input
											type="text"
											value={byoId}
											onChange={(e) => setByoId(e.target.value)}
											placeholder="Client ID (…apps.googleusercontent.com)"
											className="w-full text-[11px] px-2 py-1.5 rounded border border-border bg-background/60 text-foreground placeholder:text-muted-foreground/60 font-mono"
										/>
										<input
											type="password"
											value={byoSecret}
											onChange={(e) => setByoSecret(e.target.value)}
											placeholder={
												byoConfigured
													? "Client secret (saved — leave blank to keep)"
													: "Client secret (GOCSPX-…)"
											}
											className="w-full text-[11px] px-2 py-1.5 rounded border border-border bg-background/60 text-foreground placeholder:text-muted-foreground/60 font-mono"
										/>
									</div>
								</div>
							)}
						</div>

						{/* Re-connect hint when selection changed after connecting */}
						{connected && (dirty || (useByo && (byoId || byoSecret))) && (
							<button
								type="button"
								onClick={handleConnect}
								disabled={inFlight || byoNeedsCreds}
								className="w-full text-[11px] px-2.5 py-1.5 rounded-md bg-primary/15 border border-primary/30 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
							>
								Re-connect to apply changes
							</button>
						)}
					</div>
				)}
			</div>

			{/* Error message */}
			{error && (
				<div className="px-3.5 pb-3 border-t border-[hsl(var(--elev-border)/0.6)]">
					<p className="pt-2.5 text-xs text-destructive">{error}</p>
				</div>
			)}
		</div>
	);
}
