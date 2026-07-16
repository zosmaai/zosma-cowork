import {
	ChevronLeft,
	FileText,
	FolderCog,
	Info,
	KeyRound,
	MessageSquare,
	Palette,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { FeedbackDialog } from "./FeedbackDialog";
import { About } from "./settings/About";
import { Appearance } from "./settings/Appearance";
import { Authentication } from "./settings/Authentication";
import { Instructions } from "./settings/Instructions";
import { Workspace } from "./settings/Workspace";

interface SettingsPageProps {
	onClose: () => void;
	onShowKeyEntry?: () => void;
}

type SectionId = "authentication" | "custom-instructions" | "appearance" | "workspace" | "about";

type Section = {
	id: SectionId;
	label: string;
	Icon: React.ComponentType<{ className?: string }>;
};

const GROUPS: { label: string; items: Section[] }[] = [
	{
		label: "Account",
		items: [{ id: "authentication", label: "Authentication", Icon: KeyRound }],
	},
	{
		label: "Preferences",
		items: [
			{ id: "custom-instructions", label: "Custom Instructions", Icon: FileText },
			{ id: "appearance", label: "Appearance", Icon: Palette },
			{ id: "workspace", label: "Workspace", Icon: FolderCog },
		],
	},
	{
		label: "Help",
		items: [{ id: "about", label: "About", Icon: Info }],
	},
];

const SECTIONS: Section[] = GROUPS.flatMap((g) => g.items);

const easeOutExpo = [0.16, 1, 0.3, 1] as const;

export function SettingsPage({ onClose, onShowKeyEntry }: SettingsPageProps) {
	const [showFeedback, setShowFeedback] = useState(false);
	const [activeSection, setActiveSection] = useState<SectionId>("authentication");
	const [prevIndex, setPrevIndex] = useState(0);
	const containerRef = useRef<HTMLDivElement>(null);
	const reduced = useReducedMotion();

	const activeIndex = SECTIONS.findIndex((s) => s.id === activeSection);

	function handleNavClick(id: SectionId) {
		setPrevIndex(activeIndex);
		setActiveSection(id);
	}

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape" && !showFeedback) onClose();
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [onClose, showFeedback]);

	useEffect(() => {
		containerRef.current?.focus();
	}, []);

	const direction = activeIndex >= prevIndex ? 1 : -1;
	const xOffset = reduced ? 0 : 10 * direction;

	return (
		<div ref={containerRef} tabIndex={-1} className="flex flex-col h-full outline-none">
			{/* ── Mobile-only top bar ── */}
			<div
				className="md:hidden settings-rail settings-rail-bottom flex items-center gap-2 px-3 shrink-0"
				style={{ height: 44 }}
			>
				<button
					type="button"
					aria-label="Close settings"
					onClick={onClose}
					className="flex items-center justify-center w-7 h-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
				>
					<ChevronLeft className="w-4 h-4" />
				</button>
				<span className="text-[13px] font-semibold text-foreground">Settings</span>
			</div>

			{/* ── Mobile-only horizontal tab strip ── */}
			<div className="md:hidden settings-rail settings-rail-bottom overflow-x-auto shrink-0">
				<div className="flex gap-1 px-2 py-1.5 min-w-max">
					{SECTIONS.map((s) => {
						const isActive = activeSection === s.id;
						return (
							<button
								key={s.id}
								type="button"
								onClick={() => handleNavClick(s.id)}
								className={`px-3 py-1.5 rounded-md text-[11px] whitespace-nowrap shrink-0 transition-colors ${
									isActive
										? "border border-primary/25 bg-primary/12 text-foreground font-medium"
										: "text-muted-foreground hover:text-foreground hover:bg-muted/40"
								}`}
							>
								{s.label}
							</button>
						);
					})}
					<button
						type="button"
						onClick={() => setShowFeedback(true)}
						className="px-3 py-1.5 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors whitespace-nowrap shrink-0"
					>
						Send Feedback
					</button>
				</div>
			</div>

			{/* ── Body: two floating glass panels (rail + content) like home ── */}
			<div className="flex flex-1 min-h-0 md:gap-2.5">
				{/* Desktop sidebar — rounded floating glass panel, same as home */}
				<motion.aside
					className="hidden md:flex flex-col shrink-0 panel-sidebar overflow-hidden"
					style={{ width: 220 }}
					initial={reduced ? false : { x: -10, opacity: 0 }}
					animate={{ x: 0, opacity: 1 }}
					transition={{ duration: 0.28, ease: easeOutExpo }}
				>
					{/* Header row */}
					<div
						className="flex items-center gap-2 px-3 shrink-0 border-b border-[hsl(var(--elev-border)/0.6)]"
						style={{ height: 48 }}
					>
						<motion.button
							type="button"
							aria-label="Close settings"
							onClick={onClose}
							className="flex items-center justify-center w-7 h-7 rounded-lg text-muted-foreground"
							whileHover={
								reduced
									? {}
									: {
											color: "hsl(var(--foreground))",
											background: "hsl(var(--muted) / 0.6)",
										}
							}
							whileTap={reduced ? {} : { scale: 0.92 }}
							transition={{ duration: 0.14, ease: easeOutExpo }}
						>
							<ChevronLeft className="w-4 h-4" />
						</motion.button>
						<span className="text-[13px] font-semibold text-foreground">Settings</span>
					</div>

					{/* Nav items — grouped */}
					<nav className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
						{GROUPS.map((group) => (
							<div key={group.label} className="space-y-px">
								<p className="px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/55">
									{group.label}
								</p>
								{group.items.map((s) => {
									const isActive = activeSection === s.id;
									return (
										<div key={s.id} className="relative">
											{isActive && (
												<motion.div
													layoutId="settings-nav-pill"
													className="absolute inset-0 rounded-lg border border-primary/25 bg-primary/12"
													transition={{ duration: reduced ? 0 : 0.2, ease: easeOutExpo }}
												/>
											)}
											<button
												type="button"
												onClick={() => handleNavClick(s.id)}
												className="relative z-10 w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left"
												style={{
													color: isActive
														? "hsl(var(--foreground))"
														: "hsl(var(--muted-foreground))",
												}}
											>
												<s.Icon
													className={`w-3.5 h-3.5 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground/60"}`}
												/>
												<span className={`text-[12px] truncate ${isActive ? "font-medium" : ""}`}>
													{s.label}
												</span>
											</button>
										</div>
									);
								})}
							</div>
						))}
					</nav>

					{/* Feedback */}
					<div className="px-2 py-2 shrink-0 border-t border-[hsl(var(--elev-border)/0.6)]">
						<motion.button
							type="button"
							onClick={() => setShowFeedback(true)}
							className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] text-muted-foreground"
							whileHover={
								reduced
									? {}
									: {
											color: "hsl(var(--foreground))",
											background: "hsl(var(--muted) / 0.5)",
										}
							}
							whileTap={reduced ? {} : { scale: 0.97 }}
							transition={{ duration: 0.14, ease: easeOutExpo }}
						>
							<MessageSquare className="w-3.5 h-3.5 shrink-0" />
							Send Feedback
						</motion.button>
					</div>
				</motion.aside>

				{/* ── Content panel ── */}
				<main className="flex-1 min-w-0 panel-raised overflow-hidden flex flex-col">
					<div className="flex-1 overflow-y-auto flex flex-col min-h-0">
						<motion.div
							key={activeSection}
							className="flex-1 flex flex-col min-h-0"
							initial={reduced ? { opacity: 0 } : { opacity: 0, x: xOffset, scale: 0.985 }}
							animate={{ opacity: 1, x: 0, scale: 1 }}
							transition={{ duration: 0.26, ease: easeOutExpo }}
						>
							<div className="px-6 md:px-8 py-6 md:py-7 flex-1 flex flex-col min-h-0">
								<SectionContent activeSection={activeSection} onShowKeyEntry={onShowKeyEntry} />
							</div>
						</motion.div>
					</div>
				</main>
			</div>

			<FeedbackDialog open={showFeedback} onClose={() => setShowFeedback(false)} />
		</div>
	);
}

// ── Section content router ───────────────────────────────────────
function SectionContent({
	activeSection,
	onShowKeyEntry,
}: {
	activeSection: SectionId;
	onShowKeyEntry?: () => void;
}) {
	return (
		<>
			{activeSection === "authentication" && <Authentication onShowKeyEntry={onShowKeyEntry} />}
			{activeSection === "custom-instructions" && <Instructions />}
			{activeSection === "appearance" && <Appearance />}
			{activeSection === "workspace" && <Workspace />}
			{activeSection === "about" && <About />}
		</>
	);
}
