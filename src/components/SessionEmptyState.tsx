import type { SessionMode } from "@/types/session-runtime";
import { FolderOpen, MessageCircle, PenLine, Search } from "lucide-react";
import type { Sparkles } from "lucide-react";
import { SessionModeSwitcher } from "./SessionModeSwitcher";

const STARTERS: Record<SessionMode, Array<{ label: string; icon: typeof Sparkles }>> = {
	chat: [
		{ label: "Explain or explore something", icon: MessageCircle },
		{ label: "Help me write", icon: PenLine },
	],
	work: [
		{ label: "Research and produce a report", icon: Search },
		{ label: "Create or improve a document", icon: PenLine },
	],
};

export function SessionEmptyIntro({
	mode,
	onModeChange,
	disabled,
	error,
}: {
	mode: SessionMode;
	onModeChange: (mode: SessionMode) => void;
	disabled?: boolean;
	error?: string | null;
}) {
	return (
		<div className="flex flex-col items-center gap-5 px-6 text-center">
			<SessionModeSwitcher mode={mode} onChange={onModeChange} disabled={disabled} />
			<h1 className="session-empty-heading font-semibold leading-tight tracking-[-0.02em] text-foreground">
				{mode === "chat" ? "What’s on your mind today?" : "What should we work on?"}
			</h1>
			{error && <p role="alert" className="text-[0.8125rem] text-destructive">{error}</p>}
		</div>
	);
}

export function SessionStarterPrompts({
	mode,
	workspaceCwd,
	onSelect,
}: {
	mode: SessionMode;
	workspaceCwd?: string | null;
	onSelect: (text: string) => void;
}) {
	return (
		<div className="flex w-full max-w-2xl flex-col items-center gap-3 px-6">
			<div className="flex flex-wrap justify-center gap-2">
				{STARTERS[mode].map(({ label, icon: Icon }) => (
					<button
						key={label}
						type="button"
						onClick={() => onSelect(label)}
						className="inline-flex items-center gap-2 rounded-full border border-border bg-background/60 px-4 py-2 text-sm text-foreground/80 transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<Icon className="h-4 w-4 text-primary" aria-hidden />
						{label}
					</button>
				))}
			</div>
			{mode === "work" && workspaceCwd && (
				<div className="flex max-w-full items-center gap-2 text-[0.8125rem] text-muted-foreground">
					<FolderOpen className="h-4 w-4 shrink-0" aria-hidden />
					<span>Workspace</span>
					<span className="truncate font-mono text-foreground/70" title={workspaceCwd}>{workspaceCwd}</span>
				</div>
			)}
		</div>
	);
}