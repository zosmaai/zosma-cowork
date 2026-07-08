/**
 * HelpDialog — shows all available slash commands when the user runs `/help`.
 *
 * Pure-presentation: takes a `Command[]` list and an `onClose` callback.
 * App.tsx holds the open state and passes `BUILTIN_COMMANDS` as `commands`.
 */

import type { Command } from "@/types/commands";
import { COMMAND_CATEGORY_LABELS, COMMAND_CATEGORY_ORDER } from "@/types/commands";
import { X } from "lucide-react";
import { useEffect } from "react";

interface HelpDialogProps {
	open: boolean;
	commands: Command[];
	onClose: () => void;
}

export function HelpDialog({ open, commands, onClose }: HelpDialogProps) {
	// Close on Escape
	useEffect(() => {
		if (!open) return;
		function handleKey(e: KeyboardEvent) {
			if (e.key === "Escape") onClose();
		}
		document.addEventListener("keydown", handleKey);
		return () => document.removeEventListener("keydown", handleKey);
	}, [open, onClose]);

	if (!open) return null;

	// Group commands by category in canonical order
	const grouped = COMMAND_CATEGORY_ORDER.flatMap((cat) => {
		const cmds = commands.filter((c) => c.category === cat);
		if (cmds.length === 0) return [];
		return [{ cat, label: COMMAND_CATEGORY_LABELS[cat], cmds }];
	});

	return (
		<div
			role="dialog"
			aria-label="Available commands"
			aria-modal="true"
			className="fixed inset-0 z-50 flex items-center justify-center"
		>
			{/* Backdrop */}
			<div
				className="absolute inset-0 bg-black/50"
				onClick={onClose}
				onKeyDown={(e) => e.key === "Escape" && onClose()}
				aria-hidden="true"
			/>

			{/* Panel */}
			<div
				className="relative z-10 w-full max-w-md rounded-xl border border-border
				           bg-popover shadow-2xl overflow-hidden"
				style={{ boxShadow: "0 24px 64px hsl(0 0% 0% / 0.5)" }}
			>
				{/* Header */}
				<div className="flex items-center justify-between px-4 py-3 border-b border-border">
					<span className="text-sm font-semibold text-foreground">Available commands</span>
					<button
						type="button"
						aria-label="Close"
						onClick={onClose}
						className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
					>
						<X className="w-4 h-4" />
					</button>
				</div>

				{/* Command groups */}
				<div className="overflow-y-auto max-h-[60vh] py-2">
					{grouped.map(({ cat, label, cmds }) => (
						<div key={cat}>
							{/* Category header */}
							<div className="flex items-center gap-2 px-4 pt-3 pb-1">
								<span
									role="heading"
									aria-level={3}
									className="text-[9px] font-bold uppercase tracking-widest text-primary/80"
								>
									{label}
								</span>
								<div className="flex-1 h-px bg-primary/15" />
							</div>

							{/* Commands */}
							{cmds.map((cmd) => (
								<div
									key={cmd.id}
									className="flex items-start gap-3 px-4 py-2 hover:bg-accent/40 transition-colors"
								>
									{/* Command name + aliases */}
									<div className="shrink-0 min-w-[120px]">
										<span className="text-xs font-mono font-semibold text-foreground">
											/{cmd.name}
										</span>
										{cmd.argHint && (
											<span className="ml-1.5 text-[10px] font-mono text-primary/70 bg-primary/10 rounded px-1 py-px">
												{cmd.argHint}
											</span>
										)}
										{cmd.aliases && cmd.aliases.length > 0 && (
											<div className="mt-0.5 flex flex-wrap gap-1">
												{cmd.aliases.map((a) => (
													<span key={a} className="text-[10px] font-mono text-muted-foreground/60">
														/{a}
													</span>
												))}
											</div>
										)}
									</div>

									{/* Description */}
									<span className="text-xs text-muted-foreground leading-relaxed">
										{cmd.description}
									</span>
								</div>
							))}
						</div>
					))}
				</div>

				{/* Footer hint */}
				<div className="px-4 py-2.5 border-t border-border">
					<span className="text-[10px] text-muted-foreground/50">
						Type <kbd className="font-mono">/</kbd> in the composer to open the command palette
					</span>
				</div>
			</div>
		</div>
	);
}
