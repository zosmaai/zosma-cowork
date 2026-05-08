import { useCallback, useState } from "react";

interface OnboardingProps {
	onComplete: (apiKey: string) => Promise<void>;
}

type Step = "welcome" | "api-key";

export function HomeView({ onComplete }: OnboardingProps) {
	const [step, setStep] = useState<Step>("welcome");
	const [apiKey, setApiKey] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

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

	if (step === "welcome") {
		return (
			<div className="flex flex-col items-center justify-center h-full px-8 py-12 max-w-lg mx-auto">
				<div className="text-center mb-8">
					<div className="w-14 h-14 rounded-2xl bg-blue-500/10 flex items-center justify-center mx-auto mb-4">
						<span className="text-2xl">✦</span>
					</div>
					<h1 className="text-2xl font-bold text-foreground mb-3">Welcome to Zosma Cowork</h1>
					<p className="text-sm text-muted-foreground leading-relaxed">
						Zosma Cowork uses <strong>OpenCode Go</strong> to give you access to top open-source
						coding models for a low monthly fee.
					</p>
				</div>

				<div className="w-full space-y-4 mb-8">
					<div className="bg-muted/50 rounded-xl p-4 space-y-3">
						<div className="flex items-start gap-3">
							<span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-500 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
								1
							</span>
							<div>
								<p className="text-sm font-medium text-foreground">Sign up for OpenCode Go</p>
								<p className="text-xs text-muted-foreground mt-1">
									Subscribe for <strong>$5</strong> your first month, then{" "}
									<strong>$10/month</strong>. Cancel anytime.
								</p>
							</div>
						</div>
						<div className="flex items-start gap-3">
							<span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-500 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
								2
							</span>
							<div>
								<p className="text-sm font-medium text-foreground">Get your API key</p>
								<p className="text-xs text-muted-foreground mt-1">
									Copy the key from your OpenCode dashboard.
								</p>
							</div>
						</div>
						<div className="flex items-start gap-3">
							<span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-500 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
								3
							</span>
							<div>
								<p className="text-sm font-medium text-foreground">Paste it here</p>
								<p className="text-xs text-muted-foreground mt-1">
									Enter your key on the next screen and start coding.
								</p>
							</div>
						</div>
					</div>
				</div>

				<div className="w-full space-y-3">
					<button
						type="button"
						onClick={async () => {
							const { invoke } = await import("@tauri-apps/api/core");
							invoke("open_url", { url: "https://opencode.ai/auth" }).catch(() => {
								window.open("https://opencode.ai/auth", "_blank");
							});
						}}
						className="block w-full text-center px-4 py-2.5 rounded-lg text-sm font-medium transition-all hover:opacity-90 cursor-pointer"
						style={{
							background: "hsl(var(--primary))",
							color: "hsl(var(--primary-foreground))",
						}}
					>
						Sign up for OpenCode Go →
					</button>
					<button
						type="button"
						onClick={() => setStep("api-key")}
						className="block w-full text-center px-4 py-2.5 rounded-lg text-sm font-medium text-foreground hover:bg-muted/50 transition-all cursor-pointer"
					>
						I already have a key — Next
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col items-center justify-center h-full px-8 py-12 max-w-lg mx-auto">
			<div className="text-center mb-8">
				<div className="w-14 h-14 rounded-2xl bg-blue-500/10 flex items-center justify-center mx-auto mb-4">
					<span className="text-2xl">🔑</span>
				</div>
				<h1 className="text-2xl font-bold text-foreground mb-2">Enter your API Key</h1>
				<p className="text-sm text-muted-foreground">
					Paste your OpenCode Go API key below. It stays on your machine.
				</p>
			</div>

			<div className="w-full space-y-4">
				<div>
					<input
						type="password"
						value={apiKey}
						onChange={(e) => setApiKey(e.target.value)}
						placeholder="sk-..."
						className="w-full px-4 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
						onKeyDown={(e) => {
							if (e.key === "Enter" && apiKey.trim() && !saving) {
								handleSave();
							}
						}}
					/>
					{error && <p className="text-xs text-red-500 mt-2">{error}</p>}
				</div>

				<button
					type="button"
					disabled={!apiKey.trim() || saving}
					onClick={handleSave}
					className="w-full px-4 py-2.5 rounded-lg text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 cursor-pointer"
					style={{
						background: "hsl(var(--primary))",
						color: "hsl(var(--primary-foreground))",
					}}
				>
					{saving ? "Saving..." : "Start Chatting"}
				</button>

				<button
					type="button"
					onClick={() => setStep("welcome")}
					className="block w-full text-center text-xs text-muted-foreground hover:text-foreground"
				>
					← Back
				</button>
			</div>
		</div>
	);
}
