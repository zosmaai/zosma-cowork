import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { checkKeyFormat } from "@/lib/key-format";
import type { AuthStatus } from "@/types/auth";
import { invoke } from "@tauri-apps/api/core";
import { type UnlistenFn, listen } from "@tauri-apps/api/event";
import { AlertTriangle, Check, ChevronDown, Eye, EyeOff, Key, Loader2, Trash2 } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClaudeIcon, GeminiIcon, GitHubIcon, OpenAIIcon } from "../BrandIcons";
import { CustomProviderRow } from "./CustomProviderRow";

// onShowKeyEntry kept for API compat but no longer used — key entry is inline
interface Props {
	onShowKeyEntry?: () => void;
}
type Phase = "idle" | "starting" | "waiting_browser" | "exchanging" | "done";

// Gemini (Google / Antigravity) sign-in is fully integrated in the sidecar
// (registerGeminiAntigravity) but hidden from the provider list for now while
// the subscription/ToS story is settled. Flip to true to re-expose the option;
// no other change is needed.
const SHOW_ANTIGRAVITY = false;

const PROVIDERS_CONFIG = [
	{ id: "anthropic", label: "Claude Pro/Max", icon: ClaudeIcon },
	{ id: "github-copilot", label: "GitHub Copilot", icon: GitHubIcon },
	{ id: "openai-codex", label: "ChatGPT", icon: OpenAIIcon },
	...(SHOW_ANTIGRAVITY
		? [{ id: "google-antigravity", label: "Gemini (Google)", icon: GeminiIcon }]
		: []),
];

const ease = [0.16, 1, 0.3, 1] as const;

export function Authentication({ onShowKeyEntry: _onShowKeyEntry }: Props) {
	const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);

	const refreshStatus = useCallback(async () => {
		try {
			const data = await invoke<AuthStatus>("get_auth_status");
			setAuthStatus(data);
		} catch {
			await new Promise((r) => setTimeout(r, 300));
			try {
				const data = await invoke<AuthStatus>("get_auth_status");
				setAuthStatus(data);
			} catch {
				/* transient */
			}
		}
	}, []);

	useEffect(() => {
		refreshStatus();
	}, [refreshStatus]);

	useEffect(() => {
		const handler = () => refreshStatus();
		window.addEventListener("config-reload", handler);
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

	return (
		<section>
			<h2 className="text-sm font-semibold text-foreground mb-1">Authentication</h2>
			<p className="text-xs text-muted-foreground mb-5">
				Connect your AI subscriptions — no keys stored in the cloud.
			</p>
			<div className="space-y-2">
				{PROVIDERS_CONFIG.map((p) => (
					<AuthRow
						key={p.id}
						provider={p.id}
						label={p.label}
						icon={p.icon}
						authStatus={authStatus}
						onChange={refreshStatus}
					/>
				))}

				{/* Inline API key row */}
				<ApiKeyRow authStatus={authStatus} onSaved={refreshStatus} />

				{/* Custom OpenAI-compatible endpoint (issue #207) */}
				<CustomProviderRow onChange={refreshStatus} />
			</div>
		</section>
	);
}

// ─── OAuth provider row ───────────────────────────────────────────

function AuthRow({
	provider,
	label,
	icon: Icon,
	authStatus,
	onChange,
}: {
	provider: string;
	label: string;
	icon: React.ComponentType<{ className?: string }>;
	authStatus: AuthStatus | null;
	onChange: () => void;
}) {
	const [phase, setPhase] = useState<Phase>("idle");
	const [statusMessage, setStatusMessage] = useState<string | null>(null);
	const [userCode, setUserCode] = useState<string | null>(null);
	const [verificationUrl, setVerificationUrl] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const entry = useMemo(
		() => authStatus?.providers.find((p) => p.id === provider) ?? null,
		[authStatus, provider],
	);
	const isConnected = entry?.type === "oauth";
	const inFlight = phase !== "idle" && phase !== "done";
	const supported = authStatus?.supported.includes(provider) ?? true;

	const urlOpenedRef = useRef(false);

	useEffect(() => {
		let mounted = true;
		urlOpenedRef.current = false;
		const unlisteners: UnlistenFn[] = [];
		(async () => {
			const us = await Promise.all([
				listen<{ provider: string; url: string; instructions?: string }>("oauth_open_url", (e) => {
					if (e.payload?.provider !== provider) return;
					if (urlOpenedRef.current) return;
					urlOpenedRef.current = true;
					setPhase("waiting_browser");
					const ins = e.payload.instructions ?? null;
					const m = ins?.match(/([A-Z0-9]{4}-?[A-Z0-9]{4})/);
					setStatusMessage(m ? "Authorize this device:" : "Opening browser…");
					setUserCode(m ? m[1] : null);
					setVerificationUrl(m ? e.payload.url : null);
					invoke("open_url", { url: e.payload.url });
				}),
				listen<{ provider: string; message: string }>("oauth_progress", (e) => {
					if (e.payload?.provider !== provider) return;
					setStatusMessage(e.payload.message);
					if (e.payload.message.toLowerCase().includes("token")) setPhase("exchanging");
				}),
				listen<{ provider: string }>("oauth_completed", (e) => {
					if (e.payload?.provider !== provider) return;
					setPhase("done");
					setStatusMessage(null);
					setUserCode(null);
					setVerificationUrl(null);
					setError(null);
					onChange();
					window.dispatchEvent(new CustomEvent("config-reload"));
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
	}, [provider, onChange]);

	const handleSignIn = useCallback(async () => {
		setError(null);
		setUserCode(null);
		setVerificationUrl(null);
		setPhase("starting");
		setStatusMessage("Starting…");
		try {
			const result = await invoke<{ success: boolean; cancelled?: boolean; error?: string }>(
				"start_oauth",
				{ provider },
			);
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
			/* best-effort */
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
			onChange();
			window.dispatchEvent(new CustomEvent("config-reload"));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, [provider, onChange]);

	if (!supported) return null;

	return (
		<div className="glass overflow-hidden">
			<div className="px-3.5 py-3">
				<div className="flex items-center gap-3">
					<Icon className="w-5 h-5 shrink-0 text-foreground/60" />
					<span className="flex-1 text-[13px] text-foreground min-w-0 truncate">{label}</span>

					{isConnected && (
						<span
							className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full"
							style={{ background: "hsl(var(--primary) / 0.12)", color: "hsl(var(--primary))" }}
						>
							<span className="w-1.5 h-1.5 rounded-full bg-primary" />
							Connected
						</span>
					)}

					{isConnected ? (
						<button
							type="button"
							onClick={handleSignOut}
							className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
						>
							Sign out
						</button>
					) : inFlight ? (
						<button
							type="button"
							onClick={handleCancel}
							className="text-[11px] px-2.5 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
						>
							Cancel
						</button>
					) : (
						<button
							type="button"
							onClick={handleSignIn}
							className="text-[11px] px-2.5 py-1 rounded-md border border-border text-foreground hover:bg-muted/50 transition-colors"
						>
							Sign in
						</button>
					)}
				</div>

				{statusMessage && <p className="text-xs text-muted-foreground mt-2">{statusMessage}</p>}

				{userCode && (
					<div
						className="mt-2 flex items-center gap-2 p-2 rounded-md"
						style={{
							background: "hsl(var(--muted) / 0.4)",
							border: "1px dashed hsl(var(--border))",
						}}
					>
						<code className="text-xs font-mono font-semibold tracking-wider select-all text-foreground">
							{userCode}
						</code>
						<button
							type="button"
							onClick={() => navigator.clipboard?.writeText(userCode)}
							className="text-xs px-2 py-0.5 rounded font-medium text-white bg-primary"
						>
							Copy
						</button>
						{verificationUrl && (
							<button
								type="button"
								onClick={() =>
									invoke("open_url", { url: verificationUrl }).catch(() =>
										window.open(verificationUrl, "_blank"),
									)
								}
								className="text-xs underline ml-auto text-primary"
							>
								Open
							</button>
						)}
					</div>
				)}

				{error && <p className="text-xs mt-1.5 text-destructive">{error}</p>}
			</div>
		</div>
	);
}

// ─── Inline API key row ───────────────────────────────────────────

/** Provider id pre-selected when the user expands the API-key row. */
const DEFAULT_API_KEY_PROVIDER = "openrouter";

function ApiKeyRow({
	authStatus,
	onSaved,
}: {
	authStatus: AuthStatus | null;
	onSaved: () => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const [provider, setProvider] = useState<string>("");
	const [key, setKey] = useState("");
	const [showKey, setShowKey] = useState(false);
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [formatHint, setFormatHint] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const reduced = useReducedMotion();

	const apiKeyProviders = useMemo(() => authStatus?.apiKeyProviders ?? [], [authStatus]);

	// Providers that already have a key saved (type === "api_key")
	const savedKeyProviders = useMemo(
		() => (authStatus?.providers ?? []).filter((p) => p.type === "api_key"),
		[authStatus],
	);

	// Once the provider list arrives, seed the picker. Prefer `openrouter`
	// (the issue #150 trigger), else fall back to the first available.
	useEffect(() => {
		if (provider || apiKeyProviders.length === 0) return;
		const preferred = apiKeyProviders.find((p) => p.id === DEFAULT_API_KEY_PROVIDER);
		setProvider(preferred?.id ?? apiKeyProviders[0].id);
	}, [provider, apiKeyProviders]);

	// Focus input when expanded
	useEffect(() => {
		if (expanded) requestAnimationFrame(() => inputRef.current?.focus());
	}, [expanded]);

	// ── Format check: re-run when key or provider changes ──────────────
	useEffect(() => {
		if (!key.trim() || !provider) {
			setFormatHint(null);
			return;
		}
		const result = checkKeyFormat(provider, key);
		setFormatHint(result.ok ? null : (result.hint ?? null));
	}, [provider, key]);

	// ── Save & Probe ─────────────────────────────────────────────────
	//
	// Flow: probe FIRST (up to 5 s), save SECOND.
	// - Probe returns definitive 401 AuthError → show red error, abort save.
	// - Probe times out / network error → save anyway (can't distinguish
	//   a bad key from the user being offline — benefit of the doubt).
	// - No probe registered for provider → save directly.
	// - Probe passes → save → close panel.
	const handleSave = useCallback(async () => {
		const trimmedKey = key.trim();
		const trimmedProvider = provider.trim();
		if (!trimmedKey) return;
		if (!trimmedProvider) {
			setError("Pick a provider");
			return;
		}
		setSaving(true);
		setError(null);

		try {
			// 1) Probe first — only abort if the server definitively rejects the key
			try {
				const validation = await invoke<{
					ok: boolean;
					probe?: { ok: boolean; status?: number; message?: string };
				}>("validate_provider_key", {
					provider: trimmedProvider,
					key: trimmedKey,
				});

				if (validation.probe && !validation.probe.ok) {
					// Definitive server rejection — don't save
					setError(
						validation.probe.message
							? `Invalid API key — ${validation.probe.message}`
							: "Invalid API key — rejected by provider",
					);
					return;
				}
				// probe.ok === true, or no probe registered → fall through to save
			} catch {
				// Network error / timeout / sidecar error — save anyway
				// (can't tell if the key is bad or the user is just offline)
			}

			// 2) Save
			await invoke("save_auth_key", { provider: trimmedProvider, key: trimmedKey });
			window.dispatchEvent(new CustomEvent("config-reload"));
			onSaved();
			setSaved(true);

			setTimeout(() => {
				setSaved(false);
				setExpanded(false);
				setKey("");
				setFormatHint(null);
			}, 1500);
		} catch (saveErr) {
			setError(saveErr instanceof Error ? saveErr.message : "Failed to save key");
		} finally {
			setSaving(false);
		}
	}, [key, provider, onSaved]);

	// ── Delete saved key with confirmation ────────────────────────────
	const [deleting, setDeleting] = useState<string | null>(null);
	const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

	const confirmDeleteKey = useCallback((providerId: string) => {
		setDeleteConfirmId(providerId);
	}, []);

	const handleDeleteConfirmed = useCallback(async () => {
		const providerId = deleteConfirmId;
		if (!providerId) return;
		setDeleteConfirmId(null);
		setDeleting(providerId);
		setError(null);
		try {
			await invoke("logout_provider", { provider: providerId });
			window.dispatchEvent(new CustomEvent("config-reload"));
			onSaved();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to delete key");
		} finally {
			setDeleting(null);
		}
	}, [deleteConfirmId, onSaved]);

	const handleDeleteCancelled = useCallback(() => {
		setDeleteConfirmId(null);
	}, []);

	const deleteProviderName = deleteConfirmId
		? (apiKeyProviders.find((p) => p.id === deleteConfirmId)?.displayName ?? deleteConfirmId)
		: "";

	return (
		<div className="glass overflow-hidden">
			{/* Header row — always visible */}
			<button
				type="button"
				onClick={() => {
					setExpanded((v) => !v);
					setError(null);
					if (expanded) {
						setFormatHint(null);
					}
				}}
				className="w-full flex items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-muted/20"
			>
				<Key className="w-4.5 h-4.5 shrink-0 text-foreground/50" />
				<span className="flex-1 text-[13px] text-foreground">API key</span>
				{savedKeyProviders.length > 0 && (
					<span className="text-[10px] font-medium mr-1.5" style={{ color: "hsl(var(--primary))" }}>
						{savedKeyProviders.length} saved
					</span>
				)}
				<motion.div
					animate={{ rotate: expanded ? 180 : 0 }}
					transition={{ duration: reduced ? 0 : 0.18, ease }}
				>
					<ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50" />
				</motion.div>
			</button>

			{/* Saved API keys — always visible so user knows what's configured */}
			{savedKeyProviders.length > 0 && (
				<ul
					className="px-3.5 pb-3 space-y-1.5"
					style={{ borderTop: "1px solid hsl(var(--border))" }}
				>
					{savedKeyProviders.map((entry) => {
						const displayName =
							apiKeyProviders.find((p) => p.id === entry.id)?.displayName ?? entry.id;
						return (
							<li
								key={entry.id}
								className="flex items-center gap-2 text-[11px] rounded-md border border-border px-2 py-1.5 mt-3 bg-background"
							>
								<Key className="w-3 h-3 shrink-0 text-primary/60" />
								<span className="flex-1 truncate">{displayName}</span>
								<span
									className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
									style={{
										background: "hsl(var(--primary) / 0.12)",
										color: "hsl(var(--primary))",
									}}
								>
									Key saved
								</span>
								<button
									type="button"
									onClick={() => confirmDeleteKey(entry.id)}
									disabled={deleting === entry.id}
									aria-label={`Delete key for ${displayName}`}
									className="text-[11px] px-2 py-0.5 rounded-md border border-border text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors disabled:opacity-50"
								>
									{deleting === entry.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Delete"}
								</button>
							</li>
						);
					})}
				</ul>
			)}

			{/* Expandable input area */}
			<AnimatePresence initial={false}>
				{expanded && (
					<motion.div
						key="api-key-body"
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ duration: reduced ? 0 : 0.22, ease }}
						style={{ overflow: "hidden" }}
					>
						<div
							className="px-3.5 pb-3.5 pt-0"
							style={{ borderTop: "1px solid hsl(var(--border))" }}
						>
							<p className="text-[11px] text-muted-foreground pt-3 pb-2.5 leading-relaxed">
								Pick the provider this key belongs to. Keys are stored locally in your system
								keychain.
							</p>

							{/* Provider picker — fixes #150 (was hardcoded to opencode-go) */}
							<div className="mb-2">
								<label
									htmlFor="api-key-provider"
									className="block text-[11px] mb-1 text-muted-foreground"
								>
									Provider
								</label>
								<select
									id="api-key-provider"
									value={provider}
									onChange={(e) => setProvider(e.target.value)}
									disabled={apiKeyProviders.length === 0}
									className="w-full text-[12px] px-3 py-2 rounded-md border focus:outline-none transition-colors bg-background border-border text-foreground"
								>
									{apiKeyProviders.length === 0 ? (
										<option value="">Loading providers…</option>
									) : (
										apiKeyProviders.map((p) => (
											<option key={p.id} value={p.id}>
												{p.displayName} — {p.id}
											</option>
										))
									)}
								</select>
							</div>

							<div className="flex gap-2">
								{/* Input */}
								<div className="relative flex-1">
									<input
										ref={inputRef}
										type={showKey ? "text" : "password"}
										value={key}
										onChange={(e) => setKey(e.target.value)}
										onKeyDown={(e) => {
											if (e.key === "Enter") handleSave();
											if (e.key === "Escape") {
												setExpanded(false);
												setKey("");
											}
										}}
										placeholder="sk-… or api-key-…"
										className="w-full text-[12px] font-mono px-3 py-2 pr-8 rounded-md border focus:outline-none transition-colors"
										style={{
											background: "hsl(var(--background))",
											borderColor: error
												? "hsl(var(--destructive))"
												: formatHint
													? "hsl(var(--warning))"
													: "hsl(var(--border))",
											color: "hsl(var(--foreground))",
										}}
										onFocus={(e) => {
											e.currentTarget.style.borderColor = error
												? "hsl(var(--destructive))"
												: "hsl(var(--primary) / 0.5)";
										}}
										onBlur={(e) => {
											e.currentTarget.style.borderColor = error
												? "hsl(var(--destructive))"
												: formatHint
													? "hsl(var(--warning))"
													: "hsl(var(--border))";
										}}
									/>
									{/* Show/hide toggle */}
									<button
										type="button"
										onClick={() => setShowKey((v) => !v)}
										className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
										tabIndex={-1}
									>
										{showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
									</button>
								</div>

								{/* Save button */}
								<motion.button
									type="button"
									onClick={handleSave}
									disabled={!key.trim() || saving || saved}
									className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-md text-[12px] font-medium transition-colors disabled:opacity-50"
									style={{
										background: saved ? "hsl(var(--primary) / 0.15)" : "hsl(var(--primary))",
										color: saved ? "hsl(var(--primary))" : "hsl(var(--primary-foreground))",
									}}
									whileTap={reduced ? {} : { scale: 0.96 }}
									transition={{ duration: 0.12, ease }}
								>
									{saving ? (
										<Loader2 className="w-3.5 h-3.5 animate-spin" />
									) : saved ? (
										<Check className="w-3.5 h-3.5" />
									) : (
										"Save"
									)}
								</motion.button>
							</div>

							{/* Format hint — advisory warning only, save is still allowed */}
							{formatHint && (
								<div className="flex items-start gap-1.5 mt-2">
									<AlertTriangle
										className="w-3 h-3 shrink-0 mt-0.5"
										style={{ color: "hsl(var(--warning))" }}
									/>
									<p className="text-[11px]" style={{ color: "hsl(var(--warning))" }}>
										{formatHint}
										<br />
										<span className="text-muted-foreground">
											You can still save — provider key formats can change.
										</span>
									</p>
								</div>
							)}

							{error && <p className="text-[11px] mt-2 text-destructive">{error}</p>}
						</div>
					</motion.div>
				)}
			</AnimatePresence>

			{/* Delete confirmation dialog */}
			<ConfirmDialog
				open={deleteConfirmId !== null}
				onClose={handleDeleteCancelled}
				onConfirm={handleDeleteConfirmed}
				title={`Delete ${deleteProviderName} key?`}
				description="This will remove the API key from your local keychain. You'll need to re-enter it to use this provider."
				confirmLabel="Delete"
				cancelLabel="Cancel"
				variant="destructive"
				icon={Trash2}
			/>
		</div>
	);
}
