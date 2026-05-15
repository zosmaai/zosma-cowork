/**
 * HomeView — Branded splash screen + onboarding
 *
 * Shows a polished splash with logo, tagline, and either the setup flow
 * or a brief "ready" state depending on auth status.
 *
 * Flow: splash → connect (API key prompt + OAuth provider cards)
 */

import { useCallback, useState } from "react";
import { ProviderAuthSection } from "./ProviderAuthSection";

interface OnboardingProps {
	onComplete: (apiKey: string) => Promise<void>;
	/**
	 * Optional escape hatch: dismiss the connect flow without configuring a
	 * provider and let the parent jump the user to Settings (where they can
	 * pick any provider and finish setup later).
	 */
	onSkipToSettings?: () => void;
	/**
	 * Dismiss the Connect modal entirely. Renders a Skip / Continue
	 * affordance in the top-right of the "connect" step (never on splash).
	 * Label flips to "Continue" when at least one subscription (OAuth)
	 * provider is signed in.
	 */
	onDismiss?: () => void;
	hasSubscription?: boolean;
}

type Step = "splash" | "connect";

const PROVIDERS = [
	{ id: "anthropic", label: "Claude Pro/Max", icon: "🤖", desc: "Use your Claude subscription" },
	{ id: "github-copilot", label: "GitHub Copilot", icon: "🐙", desc: "Use your GitHub subscription" },
	{ id: "openai-codex", label: "ChatGPT", icon: "💬", desc: "Use your ChatGPT Plus / Pro subscription" },
] as const;

export function HomeView({
	onComplete,
	onSkipToSettings,
	onDismiss,
	hasSubscription,
}: OnboardingProps) {
	const [step, setStep] = useState<Step>("splash");
	const [apiKey, setApiKey] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [expandedProvider, setExpandedProvider] = useState<string | null>(null);

	const handleSave = useCallback(async () => {
		const trimmed = apiKey.trim();
		if (!trimmed) return;
		setSaving(true);
		setError(null);
		try {
			await onComplete(trimmed);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to save API key");
		} finally {
			setSaving(false);
		}
	}, [apiKey, onComplete]);

	const handleProviderSelect = useCallback((id: string) => {
		setExpandedProvider((prev) => (prev === id ? null : id));
	}, []);

	// ── Splash ──────────────────────────────────────────────────
	if (step === "splash") {
		return (
			<div className="flex flex-col items-center justify-center h-full px-8 py-12 max-w-lg mx-auto">
				{/* Logo */}
				<div className="mb-6">
					<div
						className="w-20 h-20 rounded-2xl flex items-center justify-center"
						style={{
							background:
								"linear-gradient(135deg, hsl(var(--primary) / 0.2), hsl(var(--primary) / 0.05))",
							boxShadow: "0 0 40px hsl(var(--primary) / 0.1)",
						}}
					>
						<span className="text-4xl font-bold" style={{ color: "hsl(var(--primary))" }}>
							Z
						</span>
					</div>
				</div>

				{/* Tagline */}
				<h1
					className="text-3xl font-bold text-center mb-1"
					style={{ color: "hsl(var(--foreground))" }}
				>
					Zosma Cowork
				</h1>
				<p className="text-xs text-center mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
					🇮🇳 India's first Non-Coding Agentic Work Harness
				</p>
				<p className="text-base text-center mb-8" style={{ color: "hsl(var(--muted-foreground))" }}>
					Your AI pair programmer, always in sync.
				</p>

				{/* Feature highlights */}
				<div className="w-full space-y-2.5 mb-8">
					<FeatureRow
						icon="⚡"
						text="Connect to any AI — Claude, ChatGPT, Copilot, OpenAI, or local models"
					/>
					<FeatureRow icon="🧩" text="All pi extensions, skills & themes work out of the box" />
					<FeatureRow icon="🔒" text="Your code stays local — no data leaves your machine" />
					<FeatureRow icon="🆓" text="100% free & open-source — no subscriptions, no caps" />
					<FeatureRow icon="👥" text="Set up a minimal harness for non-technical friends & colleagues" />
				</div>

				{/* Made in India branding */}
				<div className="w-full text-center mb-6">
					<p className="text-[10px]" style={{ color: "hsl(var(--muted-foreground) / 0.6)" }}>
						🇮🇳 Made in India — From India to the World 🌏
					</p>
					<p className="text-[9px]" style={{ color: "hsl(var(--muted-foreground) / 0.4)" }}>
						Free for everyone 🆓 — Built on pi, the minimal agentic harness
					</p>
				</div>

				{/* CTA */}
				<div className="w-full space-y-3">
					<button
						type="button"
						onClick={() => setStep("connect")}
						className="block w-full text-center px-4 py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-90 cursor-pointer"
						style={{
							background: "hsl(var(--primary))",
							color: "hsl(var(--primary-foreground))",
						}}
					>
						Get Started
					</button>
					<button
						type="button"
						onClick={async () => {
							const { invoke } = await import("@tauri-apps/api/core");
							invoke("open_url", { url: "https://zosma.ai" }).catch(() => {
								window.open("https://zosma.ai", "_blank");
							});
						}}
						className="block w-full text-center text-xs py-1.5 cursor-pointer"
						style={{ color: "hsl(var(--muted-foreground))" }}
					>
						Learn more at zosma.ai →
					</button>
				</div>
			</div>
		);
	}

	// ── Connect ─────────────────────────────────────────────────
	return (
		<div className="relative h-full w-full">
			{onDismiss && (
				<button
					type="button"
					onClick={onDismiss}
					aria-label={hasSubscription ? "Continue" : "Skip"}
					className="absolute top-4 right-4 z-20 text-xs font-medium px-3 py-1.5 rounded-full transition-colors cursor-pointer hover:opacity-90"
					style={{
						background: hasSubscription
							? "hsl(var(--primary))"
							: "hsl(var(--muted))",
						color: hasSubscription
							? "hsl(var(--primary-foreground))"
							: "hsl(var(--muted-foreground))",
					}}
				>
					{hasSubscription ? "Continue →" : "Skip"}
				</button>
			)}
			<div className="h-full w-full overflow-y-auto">
				<div className="flex flex-col items-center px-8 py-8 max-w-lg mx-auto">
					<h1 className="text-xl font-bold mb-1" style={{ color: "hsl(var(--foreground))" }}>
				Connect your AI
			</h1>
			<p className="text-sm mb-6 text-center" style={{ color: "hsl(var(--muted-foreground))" }}>
				Choose how to connect — your credentials stay on your machine.
			</p>

			<div className="w-full space-y-5">
				{/* ═══ ZONE 1: Quick Start — API Key (most prominent) ═══ */}
				<div
					className="rounded-xl border-2 p-4 space-y-3"
					style={{
						borderColor: "hsl(var(--primary) / 0.3)",
						background: "hsl(var(--primary) / 0.05)",
					}}
				>
					<div className="flex items-center gap-2">
						<span className="text-lg">⚡</span>
						<span className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>
							Quick Start — Paste an API Key
						</span>
					</div>
					<p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
						The fastest way to start. Get a key from OpenCode Go and paste it below.
					</p>

					<input
						type="password"
						value={apiKey}
						onChange={(e) => setApiKey(e.target.value)}
						placeholder="OpenCode Go API key (sk-…)"
						className="w-full px-4 py-2.5 rounded-xl border bg-transparent text-sm outline-none transition-colors"
						style={{
							borderColor: "hsl(var(--border))",
							color: "hsl(var(--foreground))",
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" && apiKey.trim() && !saving) {
								handleSave();
							}
						}}
					/>
					{error && (
						<p className="text-xs" style={{ color: "hsl(var(--destructive))" }}>
							{error}
						</p>
					)}

					<button
						type="button"
						disabled={!apiKey.trim() || saving}
						onClick={handleSave}
						className="w-full px-4 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 cursor-pointer"
						style={{
							background: "hsl(var(--primary))",
							color: "hsl(var(--primary-foreground))",
						}}
					>
						{saving ? "Saving..." : "Save & Start Chatting"}
					</button>
				</div>

				{/* ═══ ZONE 2: OAuth Provider Cards ═══ */}
				<div>
					<div className="flex items-center gap-2 mb-3">
						<div className="flex-1 h-px" style={{ background: "hsl(var(--border))" }} />
						<span
							className="text-[10px] uppercase tracking-wider shrink-0"
							style={{ color: "hsl(var(--muted-foreground))" }}
						>
							or sign in with a subscription
						</span>
						<div className="flex-1 h-px" style={{ background: "hsl(var(--border))" }} />
					</div>

					<div className="space-y-2">
						{PROVIDERS.map((p) => {
							const isExpanded = expandedProvider === p.id;
							return (
								<div
									key={p.id}
									className="rounded-xl border overflow-hidden transition-all"
									style={{
										borderColor: isExpanded
											? "hsl(var(--primary) / 0.3)"
											: "hsl(var(--border))",
									}}
								>
									{/* Card header — always visible */}
									<button
										type="button"
										onClick={() => handleProviderSelect(p.id)}
										className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30 cursor-pointer"
										style={{
											background: isExpanded ? "hsl(var(--muted) / 0.2)" : "transparent",
										}}
									>
										<span className="text-xl">{p.icon}</span>
										<div className="flex-1 min-w-0">
											<div
												className="text-sm font-medium"
												style={{ color: "hsl(var(--foreground))" }}
											>
												{p.label}
											</div>
											<div
												className="text-xs"
												style={{ color: "hsl(var(--muted-foreground))" }}
											>
												{p.desc}
											</div>
										</div>
										<span
											className="text-xs shrink-0"
											style={{ color: "hsl(var(--muted-foreground))" }}
										>
											{isExpanded ? "▲" : "▼"}
										</span>
									</button>

									{/* Expanded ProviderAuthSection */}
									{isExpanded && (
										<div className="px-4 pb-4">
											<ProviderAuthSection provider={p.id} />
										</div>
									)}
								</div>
							);
						})}
					</div>
				</div>

				{/* ═══ ZONE 3: Advanced / Bring your own ═══ */}
				<div className="text-center">
					<p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
						Have a different provider? Use a local model, Google Gemini, or any API.
					</p>
					{onSkipToSettings && (
						<button
							type="button"
							onClick={onSkipToSettings}
							className="mt-2 text-xs font-medium underline-offset-4 hover:underline cursor-pointer"
							style={{ color: "hsl(var(--primary))" }}
						>
							Configure in Settings →
						</button>
					)}
				</div>

				{/* Back */}
				<button
					type="button"
					onClick={() => {
						setStep("splash");
						setExpandedProvider(null);
					}}
					className="block w-full text-center text-xs py-1 cursor-pointer"
					style={{ color: "hsl(var(--muted-foreground))" }}
				>
					← Back
				</button>

				{/* Made in India branding */}
				<p className="text-[10px] text-center pt-4" style={{ color: "hsl(var(--muted-foreground) / 0.4)" }}>
					🇮🇳 Made in India — With ❤️ from Zosma AI
				</p>
			</div>
				</div>
			</div>
		</div>
	);
}

/** A single feature highlight row */
function FeatureRow({ icon, text }: { icon: string; text: string }) {
	return (
		<div
			className="flex items-center gap-3 px-4 py-2.5 rounded-xl"
			style={{
				background: "hsl(var(--muted) / 0.4)",
			}}
		>
			<span className="text-lg shrink-0">{icon}</span>
			<span className="text-sm" style={{ color: "hsl(var(--foreground) / 0.85)" }}>
				{text}
			</span>
		</div>
	);
}
