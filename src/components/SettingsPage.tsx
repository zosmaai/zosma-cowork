import { CustomInstructions } from "./CustomInstructions";
import { ExtensionPanel } from "./ExtensionPanel";
import { FeedbackDialog } from "./FeedbackDialog";
import { ProviderAuthSection } from "./ProviderAuthSection";
import { SkillsPanel } from "./SkillsPanel";
import { THEMES, applyTheme, getSavedTheme } from "@/lib/themes";
import type { Theme } from "@/lib/themes";
import {
	Check,
	ChevronRight,
	Info,
	Key,
	MessageSquare,
	Package,
	Palette,
	Puzzle,
	ShieldCheck,
	X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

// ─── Section definitions ──────────────────────────────────────────

interface SettingsSection {
	id: string;
	label: string;
	icon: typeof Key;
}

const SECTIONS: SettingsSection[] = [
	{ id: "authentication", label: "Authentication", icon: Key },
	{ id: "extensions", label: "Extensions", icon: Puzzle },
	{ id: "skills", label: "Skills", icon: Package },
	{ id: "custom-instructions", label: "Custom Instructions", icon: MessageSquare },
	{ id: "theme", label: "Theme", icon: Palette },
	{ id: "telemetry", label: "Telemetry", icon: ShieldCheck },
	{ id: "about", label: "About", icon: Info },
];

interface SettingsPageProps {
	onClose: () => void;
	onShowKeyEntry?: () => void;
	telemetryEnabled?: boolean;
	onTelemetryToggle?: (enabled: boolean) => void;
}

export function SettingsPage({
	onClose,
	onShowKeyEntry,
	telemetryEnabled,
	onTelemetryToggle,
}: SettingsPageProps) {
	const [appVersion, setAppVersion] = useState<string | null>(null);
	const [currentTheme, setCurrentTheme] = useState(getSavedTheme);
	const [showFeedback, setShowFeedback] = useState(false);
	const [activeSection, setActiveSection] = useState(SECTIONS[0].id);
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		import("@tauri-apps/api/app")
			.then(({ getVersion }) => getVersion().then(setAppVersion))
			.catch(() => {});
	}, []);

	// Close on Escape
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !showFeedback) {
				onClose();
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [onClose, showFeedback]);

	// Focus trap: auto-focus the container on mount
	useEffect(() => {
		containerRef.current?.focus();
	}, []);

	function handleThemeChange(theme: Theme) {
		applyTheme(theme);
		setCurrentTheme(theme);
	}

	return (
		<div
			ref={containerRef}
			tabIndex={-1}
			className="flex h-full bg-background"
		>
			{/* ── Desktop: left sidebar nav ── */}
			<aside className="hidden md:flex w-56 flex-col border-r border-border bg-muted/20 shrink-0">
				{/* Header */}
				<div className="flex items-center justify-between px-4 h-12 border-b border-border shrink-0">
					<span className="text-sm font-semibold text-foreground">Settings</span>
					<button
						type="button"
						aria-label="Close settings"
						onClick={onClose}
						className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
					>
						<X className="w-4 h-4" />
					</button>
				</div>

				{/* Navigation items */}
				<nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
					{SECTIONS.map((section) => {
						const Icon = section.icon;
						const isActive = activeSection === section.id;
						return (
							<button
								key={section.id}
								type="button"
								onClick={() => setActiveSection(section.id)}
								className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all text-left group ${
									isActive
										? "bg-accent text-accent-foreground font-medium"
										: "text-foreground/70 hover:text-foreground hover:bg-muted/60"
								}`}
							>
								<Icon className="w-4 h-4 shrink-0" />
								<span className="flex-1 truncate">{section.label}</span>
								{isActive && (
									<ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
								)}
							</button>
						);
					})}
				</nav>

				{/* Feedback button at bottom */}
				<div className="p-2 border-t border-border shrink-0">
					<button
						type="button"
						onClick={() => setShowFeedback(true)}
						className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-foreground/70 hover:text-foreground hover:bg-muted/60 transition-colors"
					>
						<MessageSquare className="w-4 h-4 shrink-0" />
						<span>Send Feedback</span>
					</button>
				</div>
			</aside>

			{/* ── Mobile: top tab bar ── */}
			<div className="md:hidden flex items-center justify-between px-3 h-10 border-b border-border shrink-0">
				<span className="text-sm font-semibold text-foreground">Settings</span>
				<button
					type="button"
					aria-label="Close settings"
					onClick={onClose}
					className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
				>
					<X className="w-4 h-4" />
				</button>
			</div>

			{/* ── Mobile: horizontal scrollable section tabs ── */}
			<div className="md:hidden overflow-x-auto border-b border-border shrink-0">
				<div className="flex gap-1 p-1.5 min-w-max">
					{SECTIONS.map((section) => {
						const Icon = section.icon;
						const isActive = activeSection === section.id;
						return (
							<button
								key={section.id}
								type="button"
								onClick={() => setActiveSection(section.id)}
								className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors whitespace-nowrap shrink-0 ${
									isActive
										? "bg-accent text-accent-foreground font-medium"
										: "text-foreground/60 hover:text-foreground hover:bg-muted/50"
								}`}
							>
								<Icon className="w-3.5 h-3.5" />
								{section.label}
							</button>
						);
					})}
					{/* Feedback tab */}
					<button
						type="button"
						onClick={() => setShowFeedback(true)}
						className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors whitespace-nowrap shrink-0"
					>
						<MessageSquare className="w-3.5 h-3.5" />
						Feedback
					</button>
				</div>
			</div>

			{/* ── Content area ── */}
			<main className="flex-1 overflow-y-auto min-w-0">
				<div className="max-w-3xl mx-auto p-6 lg:p-8 space-y-8">
					{/* ── Authentication ── */}
					{activeSection === "authentication" && (
						<section>
							<div className="flex items-center gap-2 mb-4">
								<Key className="w-4 h-4 text-foreground/50" />
								<h2 className="text-sm font-semibold text-foreground">
									Authentication
								</h2>
							</div>
							<div className="rounded-lg border border-border bg-card p-5 space-y-4">
								<ProviderOAuthRow provider="anthropic" icon="🤖" />
								<ProviderOAuthRow provider="github-copilot" icon="🐙" />
								<ProviderOAuthRow provider="openai-codex" icon="💬" />
								<div className="h-px bg-border" />
								<div>
									<p className="text-xs text-muted-foreground mb-2">
										Or use an API key for other providers.
									</p>
									{onShowKeyEntry && (
										<button
											type="button"
											onClick={onShowKeyEntry}
											className="text-xs px-3 py-1.5 rounded-lg transition-colors text-center bg-primary/10 text-primary hover:bg-primary/15"
										>
											Change API Key
										</button>
									)}
								</div>
							</div>
						</section>
					)}

					{/* ── Extensions ── */}
					{activeSection === "extensions" && (
						<section>
							<div className="flex items-center gap-2 mb-4">
								<Puzzle className="w-4 h-4 text-foreground/50" />
								<h2 className="text-sm font-semibold text-foreground">
									Extensions
								</h2>
							</div>
							<div className="rounded-lg border border-border bg-card p-5">
								<ExtensionPanel onReload={() => {}} />
							</div>
						</section>
					)}

					{/* ── Skills ── */}
					{activeSection === "skills" && (
						<section>
							<div className="flex items-center gap-2 mb-4">
								<Package className="w-4 h-4 text-foreground/50" />
								<h2 className="text-sm font-semibold text-foreground">Skills</h2>
							</div>
							<div className="rounded-lg border border-border bg-card p-5">
								<SkillsPanel />
							</div>
						</section>
					)}

					{/* ── Custom Instructions ── */}
					{activeSection === "custom-instructions" && (
						<section>
							<div className="flex items-center gap-2 mb-4">
								<MessageSquare className="w-4 h-4 text-foreground/50" />
								<h2 className="text-sm font-semibold text-foreground">
									Custom Instructions
								</h2>
							</div>
							<div className="rounded-lg border border-border bg-card p-5">
								<CustomInstructions />
							</div>
						</section>
					)}

					{/* ── Theme ── */}
					{activeSection === "theme" && (
						<section>
							<div className="flex items-center gap-2 mb-4">
								<Palette className="w-4 h-4 text-foreground/50" />
								<h2 className="text-sm font-semibold text-foreground">Theme</h2>
							</div>
							<div className="space-y-1.5">
								{THEMES.map((theme) => {
									const isActive = currentTheme.id === theme.id;
									const accentSample = theme.vars.primary || "255 70% 65%";
									const bgSample = theme.vars.background || "215 20% 8%";
									return (
										<button
											key={theme.id}
											type="button"
											onClick={() => handleThemeChange(theme)}
											className="w-full text-left px-4 py-3 rounded-lg transition-colors flex items-center gap-3 hover:bg-muted/30 border border-transparent"
											style={{
												background: isActive
													? "hsl(var(--accent) / 0.3)"
													: "transparent",
												borderColor: isActive
													? "hsl(var(--border))"
													: "transparent",
											}}
										>
											<div
												className="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center border"
												style={{
													background: `hsl(${bgSample})`,
													borderColor: `hsl(${theme.vars.border || "215 15% 20%"})`,
												}}
											>
												<div
													className="w-4 h-4 rounded-full"
													style={{ background: `hsl(${accentSample})` }}
												/>
											</div>
											<div className="flex-1 min-w-0">
												<div className="flex items-center gap-2">
													<span className="text-sm font-medium text-foreground truncate">
														{theme.name}
													</span>
													<span className="text-[10px] uppercase text-muted-foreground/40">
														{theme.type}
													</span>
													{isActive && (
														<Check className="w-3.5 h-3.5 ml-auto shrink-0 text-primary" />
													)}
												</div>
												<p className="text-xs text-muted-foreground/60 truncate mt-0.5">
													{theme.description}
												</p>
											</div>
										</button>
									);
								})}
							</div>
						</section>
					)}

					{/* ── Telemetry ── */}
					{activeSection === "telemetry" && onTelemetryToggle && (
						<section>
							<div className="flex items-center gap-2 mb-4">
								<ShieldCheck className="w-4 h-4 text-foreground/50" />
								<h2 className="text-sm font-semibold text-foreground">
									Telemetry
								</h2>
							</div>
							<div className="rounded-lg border border-border bg-card p-5">
								<div className="flex items-center justify-between">
									<div className="flex-1 min-w-0 pr-4">
										<p className="text-sm text-foreground font-medium">
											Share anonymous usage data and crash reports
										</p>
										<p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
											Help improve Zosma Cowork by sending completely anonymous
											usage statistics and crash reports. Nothing is sent unless
											enabled. No personal data, no tracking.
										</p>
									</div>
									<label className="relative inline-flex items-center cursor-pointer shrink-0">
										<input
											type="checkbox"
											className="sr-only peer"
											checked={telemetryEnabled ?? false}
											onChange={(e) => onTelemetryToggle(e.target.checked)}
										/>
										<div className="w-11 h-6 bg-muted rounded-full peer peer-checked:bg-primary peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-ring after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-background after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full peer-checked:after:bg-primary-foreground" />
									</label>
								</div>
							</div>
						</section>
					)}

					{/* ── About ── */}
					{activeSection === "about" && (
						<section>
							<div className="flex items-center gap-2 mb-4">
								<Info className="w-4 h-4 text-foreground/50" />
								<h2 className="text-sm font-semibold text-foreground">About</h2>
							</div>
							<div className="rounded-lg border border-border bg-card p-5 space-y-3">
								<div className="flex items-center gap-3">
									<div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
										<span className="text-sm font-bold text-primary">ZC</span>
									</div>
									<div>
										<p className="text-sm font-medium text-foreground">
											Zosma Cowork
										</p>
										<p className="text-xs text-muted-foreground">
											India's first Non-Coding Agentic Work Harness
										</p>
									</div>
								</div>
								<div className="h-px bg-border" />
								<div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
									<span className="text-muted-foreground">Version</span>
									<span className="text-foreground/70 font-mono">
										{appVersion ?? (
											<span className="italic text-muted-foreground/50">loading...</span>
										)}
									</span>
									<span className="text-muted-foreground">Built on</span>
									<a
										href="https://github.com/earendil-works/pi-mono"
										target="_blank"
										rel="noopener noreferrer"
										className="underline hover:text-foreground text-foreground/70"
									>
										pi-mono SDK
									</a>
									<span className="text-muted-foreground">License</span>
									<span className="text-foreground/70">MIT — free and open source</span>
								</div>
							</div>
						</section>
					)}
				</div>
			</main>

			{/* Feedback Dialog (overlays everything) */}
			<FeedbackDialog open={showFeedback} onClose={() => setShowFeedback(false)} />
		</div>
	);
}

// ─── OAuth Row ────────────────────────────────────────────────────

function ProviderOAuthRow({
	provider,
	icon,
}: {
	provider: string;
	icon: string;
}) {
	return (
		<div className="flex items-start gap-3 py-0.5">
			<span className="text-base mt-0.5 shrink-0">{icon}</span>
			<div className="flex-1 min-w-0">
				<ProviderAuthSection provider={provider} compact />
			</div>
		</div>
	);
}
