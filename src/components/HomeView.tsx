/**
 * HomeView — Onboarding flow
 *
 * Two-step flow:
 *   1. Splash — brief value proposition, single CTA
 *   2. Connect — API key quick-start or OAuth sign-in
 *
 * Designed to disappear: get the user connected and into the app fast.
 */

import { checkKeyFormat } from "@/lib/key-format";
import type { ApiKeyProvider, AuthStatus } from "@/types/auth";
import { invoke } from "@tauri-apps/api/core";
import type { LucideIcon } from "lucide-react";
import {
	AlertTriangle,
	ChevronDown,
	ChevronUp,
	Eye,
	EyeOff,
	Loader2,
	Lock,
	LogIn,
	XCircle,
	Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ClaudeIcon, GitHubIcon, OpenAIIcon } from "./BrandIcons";
import { ProviderAuthSection } from "./ProviderAuthSection";
import { CustomProviderRow } from "./settings/CustomProviderRow";
import { useZosmaAuth } from "../hooks/useZosmaAuth";

interface OnboardingProps {
	onComplete: (provider: string, apiKey: string) => Promise<void>;
	onSkipToSettings?: () => void;
	onDismiss?: () => void;
	onZosmaComplete?: () => void;
	hasSubscription?: boolean;
	/** When "connect", skip splash and go directly to the connect step. */
	initialStep?: "splash" | "connect";
}

/** Provider id pre-selected in the API-key picker (issue #150). */
const DEFAULT_API_KEY_PROVIDER = "openrouter";

type Step = "splash" | "connect";

const PROVIDERS = [
	{
		id: "anthropic",
		label: "Claude Pro/Max",
		icon: ClaudeIcon,
		desc: "Use your Claude subscription",
	},
	{
		id: "github-copilot",
		label: "GitHub Copilot",
		icon: GitHubIcon,
		desc: "Use your GitHub subscription",
	},
	{
		id: "openai-codex",
		label: "ChatGPT",
		icon: OpenAIIcon,
		desc: "Use your ChatGPT Plus / Pro subscription",
	},
] as const;

export function HomeView({
	onComplete,
	onSkipToSettings,
	onDismiss,
	onZosmaComplete,
	hasSubscription,
	initialStep,
}: OnboardingProps) {
	const [step, setStep] = useState<Step>(initialStep ?? "connect");
	const [expandedAlternatives, setExpandedAlternatives] = useState(false);

	// Keep splash as a short brand transition only. It has no dead-end CTA or
	// back path; login appears automatically within 1.4s when explicitly used.
	useEffect(() => {
		if (step !== "splash") return;
		const timer = window.setTimeout(() => setStep("connect"), 1400);
		return () => window.clearTimeout(timer);
	}, [step]);

	const {
		phase: zosmaPhase,
		error: zosmaError,
		start: zosmaStart,
		cancel: zosmaCancel,
	} = useZosmaAuth({
		onComplete: onZosmaComplete,
	});

	// ponytail: gate Zosma card behind env var until backend staging is verified.
	// Remove check after configured staging auth and router services are live.
	const zosmaEnabled = import.meta.env.VITE_ZOSMA_AUTH_ENABLED !== "false";

	const [apiKey, setApiKey] = useState("");
	const [showKey, setShowKey] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [formatHint, setFormatHint] = useState<string | null>(null);
	const [probeMessage, setProbeMessage] = useState<string | null>(null);
	const [validating, setValidating] = useState(false);
	const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
	const [appVersion, setAppVersion] = useState<string | null>(null);
	const [apiKeyProviders, setApiKeyProviders] = useState<ApiKeyProvider[]>([]);
	const [provider, setProvider] = useState<string>("");

	useEffect(() => {
		import("@tauri-apps/api/app")
			.then(({ getVersion }) => getVersion().then(setAppVersion))
			.catch(() => {});
	}, []);

	// Pull the provider catalog from the sidecar so the user can pick which
	// provider their key belongs to (fixes #150 — was hardcoded opencode-go).
	useEffect(() => {
		let cancelled = false;
		let attempts = 0;
		let retryTimer: ReturnType<typeof setTimeout> | undefined;
		const load = async () => {
			try {
				const data = await invoke<AuthStatus>("get_auth_status");
				if (cancelled) return;
				const list = data.apiKeyProviders ?? [];
				setApiKeyProviders(list);
				setProvider((prev) => {
					if (prev) return prev;
					const preferred = list.find((p) => p.id === DEFAULT_API_KEY_PROVIDER);
					return preferred?.id ?? list[0]?.id ?? "";
				});
			} catch {
				// The fresh-user screen can render before Pi is ready. Retry briefly
				// so API-key providers are usable without restarting the screen.
				if (!cancelled && attempts < 6) {
					attempts += 1;
					retryTimer = setTimeout(load, 500 * attempts);
				}
			}
		};
		void load();
		const handler = () => {
			attempts = 0;
			if (retryTimer) clearTimeout(retryTimer);
			void load();
		};
		window.addEventListener("config-reload", handler);
		return () => {
			cancelled = true;
			if (retryTimer) clearTimeout(retryTimer);
			window.removeEventListener("config-reload", handler);
		};
	}, []);

	// ── Format check: re-run when key or provider changes ──────────────
	useEffect(() => {
		if (!apiKey.trim() || !provider) {
			setFormatHint(null);
			return;
		}
		const result = checkKeyFormat(provider, apiKey);
		setFormatHint(result.ok ? null : (result.hint ?? null));
	}, [provider, apiKey]);

	const borderColor = useMemo(() => {
		if (error) return "hsl(var(--destructive))";
		if (formatHint) return "hsl(var(--warning))";
		return "hsl(var(--border))";
	}, [error, formatHint]);

	const handleSave = useCallback(async () => {
		const trimmedKey = apiKey.trim();
		const trimmedProvider = provider.trim();
		if (!trimmedKey) return;
		if (!trimmedProvider) {
			setError("Pick a provider for this key.");
			return;
		}
		setSaving(true);
		setValidating(true);
		setError(null);
		setProbeMessage(null);

		try {
			// 1) Live probe: validate the key BEFORE completing onboarding.
			//    If the key is invalid we stay on this screen so the user can fix it.
			let blocked = false;
			try {
				const validation = await invoke<{
					ok: boolean;
					format?: { ok: boolean; hint?: string };
					probe?: { ok: boolean; status?: number; message?: string };
				}>("validate_provider_key", {
					provider: trimmedProvider,
					key: trimmedKey,
				});

				if (validation.probe) {
					// A live probe was attempted — this is the ONLY thing that blocks
					if (!validation.probe.ok) {
						setError(
							`Key invalid: ${validation.probe.message ?? `HTTP ${validation.probe.status ?? "unknown"}`}`,
						);
						blocked = true;
					}
					// probe.ok === true → silently proceed
				} else {
					// No probe attempted (format check didn't match or no probe registered)
					if (!validation.ok) {
						// Format check failed — WARNING only, allow submission
						setProbeMessage("Key format doesn't match typical pattern — proceed with caution.");
					} else {
						// No probe registered for this provider
						setProbeMessage("Couldn't auto-verify this provider — proceed with caution.");
					}
				}
			} catch {
				// Probe failed (offline, sidecar error) — don't block onboarding
				setProbeMessage("Couldn't verify key (offline or network issue) — saving anyway.");
			}

			if (blocked) {
				setSaving(false);
				setValidating(false);
				return;
			}

			// 2) Key looks good (or we couldn't verify) — complete onboarding
			await onComplete(trimmedProvider, trimmedKey);
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Failed to save API key";
			if (msg === "no sidecar" || msg.includes("ERR_MODULE_NOT_FOUND")) {
				setError("The AI engine is not running. Try restarting or download the latest release.");
			} else if (msg === "not ready" || msg === "timeout") {
				setError("Waiting for the AI engine to start. Please try again in a moment.");
			} else {
				setError(msg);
			}
		} finally {
			setSaving(false);
			setValidating(false);
		}
	}, [apiKey, provider, onComplete]);

	const handleProviderSelect = useCallback((id: string) => {
		setExpandedProvider((prev) => (prev === id ? null : id));
	}, []);

	// ── Splash ──────────────────────────────────────────────────
	if (step === "splash") {
		return (
			<div className="flex flex-col items-center justify-center h-full px-8 py-12 max-w-sm mx-auto overflow-y-auto">
				{/* Logo mark */}
				<img
					src="/zosma-mark.png"
					alt="Zosma Cowork"
					className="w-16 h-16 rounded-2xl shadow-lg mb-5"
					draggable={false}
				/>

				<h1 className="text-xl font-bold text-center mb-1 text-foreground">Zosma Cowork</h1>
				<p className="text-sm text-center mb-8 leading-relaxed text-muted-foreground">
					Connect your AI accounts and start working — your credentials stay on your machine.
				</p>

				{/* Focused benefits — short, specific */}
				<div className="w-full space-y-2 mb-8">
					<BenefitRow icon={Zap} text="Works with Claude, ChatGPT, Copilot, and local models" />
					<BenefitRow icon={Lock} text="Your API keys and data never leave this device" />
				</div>

				<div className="mt-2 flex items-center justify-center gap-2 text-xs text-muted-foreground">
					<span className="h-3.5 w-3.5 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
					Preparing your workspace…
				</div>

				{appVersion && (
					<p className="text-[0.625rem] mt-6" style={{ color: "hsl(var(--muted-foreground) / 0.4)" }}>
						v{appVersion}
					</p>
				)}
			</div>
		);
	}

	// ── Connect ─────────────────────────────────────────────────
	return (
		<div className="flex flex-col h-full overflow-y-auto">
			{/* Optional defer action; there is no back path from login. */}
			<div className="flex items-center justify-end px-6 py-3 shrink-0">
				{onDismiss && (
					<button
						type="button"
						onClick={onDismiss}
						className="text-xs font-medium px-3 py-1.5 rounded-full transition-colors cursor-pointer hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
						style={{
							background: hasSubscription ? "hsl(var(--primary))" : "hsl(var(--muted))",
							color: hasSubscription
								? "hsl(var(--primary-foreground))"
								: "hsl(var(--muted-foreground))",
						}}
					>
						{hasSubscription ? "Continue" : "Skip"}
					</button>
				)}
			</div>

			{/* Content */}
			<div className="flex-1 px-6 pb-10 max-w-lg mx-auto w-full">
				<div className="mb-8 flex flex-col items-center text-center">
					<img
						src="/zosma-mark.png"
						alt="Zosma Cowork"
						className="mb-4 h-14 w-14 rounded-2xl shadow-lg animate-subtle-pulse"
						draggable={false}
					/>
					<p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">Welcome to</p>
					<h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
						Zosma Cowork
					</h1>
					<p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
						Connect an AI account to start building, researching, and shipping.
					</p>
				</div>

				<div className="mb-4 text-center">
					<h2 className="text-base font-semibold text-foreground">Choose how to connect</h2>
					<p className="mt-1 text-xs text-muted-foreground">
						Your credentials stay on this machine.
					</p>
				</div>

				<div className="space-y-4">
					{/* ═══ Zosma Router Auth (recommended) — gated by VITE_ZOSMA_AUTH_ENABLED ═══ */}
					{zosmaEnabled && (
						<div className="rounded-2xl border border-primary/20 bg-primary/[0.04] p-5 shadow-sm shadow-primary/5 space-y-4">
							<div className="flex items-center gap-2">
								<LogIn className="w-4 h-4 text-primary" />
								<span className="text-sm font-medium text-foreground">Continue with Zosma</span>
								<span className="text-[0.625rem] px-1.5 py-0.5 rounded font-medium ml-auto bg-primary/10 text-primary">
									recommended
								</span>
							</div>
							<p className="text-xs text-muted-foreground">
								Sign in with Google and get four capable models with 100 free requests every day.
							</p>

							{zosmaPhase === "done" && (
								<div className="text-xs px-3 py-2 rounded-md bg-primary/10 text-primary">
									Connected! Setting up your experience…
								</div>
							)}

							{zosmaPhase === "done" ? null : zosmaPhase === "starting" ||
								zosmaPhase === "completing" ? (
								<button
									type="button"
									disabled
									className="w-full px-4 py-2 rounded-lg text-sm font-medium transition-all opacity-60 cursor-not-allowed bg-primary text-primary-foreground flex items-center justify-center gap-2"
								>
									<Loader2 className="w-3.5 h-3.5 animate-spin" />
									{zosmaPhase === "starting" ? "Starting…" : "Setting up your models…"}
								</button>
							) : zosmaPhase === "waiting_browser" ? (
								<div className="space-y-2">
									<div className="flex items-center gap-2">
										<Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-primary" />
										<span className="text-xs font-medium text-foreground">
											Complete sign-in in your browser
										</span>
									</div>
									<button
										type="button"
										onClick={zosmaCancel}
										className="w-full px-4 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-90 cursor-pointer focus-visible:ring-2 focus-visible:ring-ring bg-muted/50 text-muted-foreground"
									>
										Cancel
									</button>
								</div>
							) : zosmaPhase === "error" ? (
								<div className="space-y-2">
									<p className="text-xs flex items-center gap-1 text-destructive">
										<XCircle className="w-3 h-3 shrink-0" />
										{zosmaError}
									</p>
									<button
										type="button"
										onClick={zosmaStart}
										className="w-full px-4 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-90 cursor-pointer focus-visible:ring-2 focus-visible:ring-ring bg-primary text-primary-foreground"
									>
										Retry
									</button>
								</div>
							) : (
								<button
									type="button"
									onClick={zosmaStart}
									className="w-full px-4 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-90 cursor-pointer focus-visible:ring-2 focus-visible:ring-ring bg-primary text-primary-foreground"
								>
									Continue with Google
								</button>
							)}
						</div>
					)}

					<button
						type="button"
						onClick={() => setExpandedAlternatives((expanded) => !expanded)}
						aria-expanded={expandedAlternatives}
						className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-muted-foreground hover:text-foreground rounded-md focus-visible:ring-2 focus-visible:ring-ring"
					>
						{expandedAlternatives ? (
							<ChevronUp className="w-3.5 h-3.5" />
						) : (
							<ChevronDown className="w-3.5 h-3.5" />
						)}
						More ways to connect
					</button>

					{expandedAlternatives && (
						<div className="space-y-4">
							{/* ═══ API Key quick-start ═══ */}
							<div className="rounded-xl border p-4 space-y-3 border-border">
								<div className="flex items-center gap-2">
									<Zap className="w-4 h-4 text-primary" />
									<span className="text-sm font-medium text-foreground">API Key</span>
									<span
										className="text-[0.625rem] px-1.5 py-0.5 rounded font-medium ml-auto"
										style={{
											background: "hsl(var(--primary) / 0.1)",
											color: "hsl(var(--primary))",
										}}
									>
										fastest
									</span>
								</div>
								<p className="text-xs text-muted-foreground">
									Pick the provider this key belongs to, paste the key, and you’re in.
								</p>

								{/* Provider picker — fixes #150 (was hardcoded to opencode-go) */}
								<div>
									<label
										htmlFor="connect-provider"
										className="block text-[0.625rem] uppercase tracking-wider mb-1"
										style={{ color: "hsl(var(--muted-foreground) / 0.8)" }}
									>
										Provider
									</label>
									<select
										id="connect-provider"
										value={provider}
										onChange={(e) => setProvider(e.target.value)}
										disabled={apiKeyProviders.length === 0}
										className="w-full px-3 py-2 rounded-md border bg-transparent text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring border-border text-foreground"
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

								<div className="relative">
									<input
										type={showKey ? "text" : "password"}
										value={apiKey}
										onChange={(e) => setApiKey(e.target.value)}
										placeholder="sk-…"
										className="w-full px-3 py-2 rounded-md border bg-transparent text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
										style={{
											borderColor: borderColor,
											color: "hsl(var(--foreground))",
										}}
										onKeyDown={(e) => {
											if (e.key === "Enter" && apiKey.trim() && !saving) {
												handleSave();
											}
										}}
									/>
									<button
										type="button"
										onClick={() => setShowKey((v) => !v)}
										aria-label={showKey ? "Hide key" : "Show key"}
										className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded text-muted-foreground/40 hover:text-foreground transition-colors"
									>
										{showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
									</button>
								</div>

								{/* Format hint — advisory only, doesn't block Connect */}
								{formatHint && (
									<div className="flex items-start gap-1.5">
										<AlertTriangle
											className="w-3 h-3 shrink-0 mt-0.5"
											style={{ color: "hsl(var(--warning))" }}
										/>
										<p className="text-[0.6875rem]" style={{ color: "hsl(var(--warning))" }}>
											{formatHint}
											<br />
											<span className="text-muted-foreground">
												You can still connect — provider key formats can change.
											</span>
										</p>
									</div>
								)}

								{error && (
									<p className="text-xs flex items-center gap-1 text-destructive">{error}</p>
								)}

								{/* Probe message (informational, shown after validation) */}
								{probeMessage && (
									<div className="flex items-center gap-1.5">
										<AlertTriangle className="w-3 h-3 shrink-0 text-warning" />
										<p className="text-[0.6875rem]" style={{ color: "hsl(var(--warning))" }}>
											{probeMessage}
										</p>
									</div>
								)}

								<button
									type="button"
									disabled={!apiKey.trim() || saving}
									onClick={handleSave}
									className="w-full px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 cursor-pointer focus-visible:ring-2 focus-visible:ring-ring bg-primary text-primary-foreground"
								>
									{saving ? (
										<span className="flex items-center justify-center gap-2">
											{validating ? (
												<>
													<Loader2 className="w-3.5 h-3.5 animate-spin" />
													Checking key…
												</>
											) : (
												<>
													<span className="w-3.5 h-3.5 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground animate-spin" />
													Saving…
												</>
											)}
										</span>
									) : (
										"Connect"
									)}
								</button>
							</div>

							{/* ═══ Custom Local LLM (issue #207) ═══ */}
							<CustomProviderRow
								onChange={() => window.dispatchEvent(new CustomEvent("config-reload"))}
							/>

							{/* ═══ Divider ═══ */}
							<div className="flex items-center gap-3">
								<div className="flex-1 h-px bg-border" />
								<span
									className="text-[0.625rem] uppercase tracking-wider shrink-0"
									style={{ color: "hsl(var(--muted-foreground) / 0.7)" }}
								>
									or use a subscription
								</span>
								<div className="flex-1 h-px bg-border" />
							</div>

							{/* ═══ OAuth Provider cards ═══ */}
							<div className="space-y-1.5">
								{PROVIDERS.map((p) => {
									const isExpanded = expandedProvider === p.id;
									return (
										<div
											key={p.id}
											className="rounded-lg border overflow-hidden transition-all"
											style={{
												borderColor: isExpanded
													? "hsl(var(--primary) / 0.3)"
													: "hsl(var(--border))",
											}}
										>
											<button
												type="button"
												onClick={() => handleProviderSelect(p.id)}
												className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/20 cursor-pointer focus-visible:ring-2 focus-visible:ring-ring"
												style={{
													background: isExpanded ? "hsl(var(--muted) / 0.15)" : "transparent",
												}}
											>
												<span style={{ color: "hsl(var(--foreground) / 0.6)" }}>
													<p.icon className="w-5 h-5" />
												</span>
												<div className="flex-1 min-w-0">
													<div className="text-sm font-medium text-foreground">{p.label}</div>
												</div>
												{isExpanded ? (
													<ChevronUp
														className="w-3.5 h-3.5 shrink-0"
														style={{ color: "hsl(var(--muted-foreground) / 0.4)" }}
													/>
												) : (
													<ChevronDown
														className="w-3.5 h-3.5 shrink-0"
														style={{ color: "hsl(var(--muted-foreground) / 0.4)" }}
													/>
												)}
											</button>

											{isExpanded && (
												<div className="px-3.5 pb-3.5">
													<ProviderAuthSection provider={p.id} />
												</div>
											)}
										</div>
									);
								})}
							</div>
						</div>
					)}

					{/* ═══ Other options ═══ */}
					{onSkipToSettings && (
						<div className="text-center pt-1">
							<button
								type="button"
								onClick={onSkipToSettings}
								className="text-xs font-medium underline-offset-4 hover:underline cursor-pointer text-muted-foreground"
							>
								Use a different provider (local models, Gemini, etc.)
							</button>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

/** A single benefit row — short, specific, value-driven */
function BenefitRow({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
	return (
		<div
			className="flex items-center gap-3 px-3.5 py-2 rounded-lg"
			style={{ background: "hsl(var(--muted) / 0.3)" }}
		>
			<Icon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
			<span className="text-xs" style={{ color: "hsl(var(--foreground) / 0.8)" }}>
				{text}
			</span>
		</div>
	);
}
