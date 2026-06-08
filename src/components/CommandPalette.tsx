/**
 * CommandPalette — slash-command autocomplete popover (#181, epic #179).
 *
 * Pure presentation: given a list of {@link Command}s and a `query`, it renders
 * a floating popover (positioned by the parent, above the composer) with
 * fuzzy-filtered, category-grouped rows and a controlled selection. It owns no
 * business logic — selecting a row calls `onRun(cmd, args)`; the command
 * implementations live in later slices (A2–A4).
 *
 * Keyboard handling lives in the parent (MessageInput) so a single keydown
 * pipeline can decide palette-vs-send precedence; this component only reflects
 * `selectedIndex` and exposes click + hover.
 */

import { ScrollArea } from "@/components/ui/scroll-area";
import { filterCommands } from "@/lib/commandFilter";
import {
	COMMAND_CATEGORY_LABELS,
	COMMAND_CATEGORY_ORDER,
	type Command,
	type CommandCategory,
} from "@/types/commands";
import {
	Blocks,
	BookOpen,
	Command as CommandIcon,
	Eye,
	MessageSquarePlus,
	SlidersHorizontal,
} from "lucide-react";
import type { ComponentType } from "react";
import { useEffect, useMemo, useRef } from "react";

interface CommandPaletteProps {
	/** Full command set; filtered internally by `query`. */
	commands: Command[];
	/** Text typed after the leading `/`, excluding arguments. */
	query: string;
	/** Arguments typed after the command name (passed through to `onRun`). */
	args?: string;
	/** Index into the *filtered* list that is currently highlighted. */
	selectedIndex: number;
	/** Run a command (Enter / click). */
	onRun: (cmd: Command, args: string) => void;
	/** Hover/keyboard selection change (index into the filtered list). */
	onSelectIndex: (index: number) => void;
}

const CATEGORY_ICON: Record<CommandCategory, ComponentType<{ className?: string }>> = {
	session: MessageSquarePlus,
	model: SlidersHorizontal,
	view: Eye,
	extensions: Blocks,
	skills: BookOpen,
};

const ICON_MAP: Record<string, ComponentType<{ className?: string }>> = {
	MessageSquarePlus,
	SlidersHorizontal,
	Eye,
	Blocks,
	BookOpen,
	Command: CommandIcon,
};

/**
 * Compute the filtered list once and expose it so the parent can stay in sync
 * (e.g. clamp `selectedIndex`, know the Enter target). Kept as a hook so the
 * parent and palette derive the *same* list from the same input.
 */
export function useFilteredCommands(commands: Command[], query: string): Command[] {
	return useMemo(() => filterCommands(commands, query), [commands, query]);
}

export function CommandPalette({
	commands,
	query,
	args = "",
	selectedIndex,
	onRun,
	onSelectIndex,
}: CommandPaletteProps) {
	const filtered = useFilteredCommands(commands, query);
	const listRef = useRef<HTMLDivElement>(null);

	// Keep the highlighted row in view as the selection moves.
	useEffect(() => {
		const el = listRef.current?.querySelector<HTMLElement>(`[data-cmd-index="${selectedIndex}"]`);
		el?.scrollIntoView({ block: "nearest" });
	}, [selectedIndex]);

	if (filtered.length === 0) {
		return (
			<div
				role="listbox"
				aria-label="Commands"
				tabIndex={-1}
				className="absolute bottom-full left-0 mb-2 w-full overflow-hidden rounded-xl border shadow-lg"
				style={{ background: "hsl(var(--popover))", borderColor: "hsl(var(--border))" }}
			>
				<div className="px-3 py-2.5 text-[13px] text-muted-foreground">No matching commands</div>
			</div>
		);
	}

	// Group the filtered (already ranked) list by category, preserving the
	// category display order and, within a category, the ranked order.
	const grouped = new Map<CommandCategory, { cmd: Command; index: number }[]>();
	filtered.forEach((cmd, index) => {
		const bucket = grouped.get(cmd.category) ?? [];
		bucket.push({ cmd, index });
		grouped.set(cmd.category, bucket);
	});
	const orderedCategories = COMMAND_CATEGORY_ORDER.filter((c) => grouped.has(c));

	return (
		<div
			role="listbox"
			aria-label="Commands"
			tabIndex={-1}
			className="absolute bottom-full left-0 mb-2 w-full overflow-hidden rounded-xl border shadow-lg"
			style={{ background: "hsl(var(--popover))", borderColor: "hsl(var(--border))" }}
		>
			<ScrollArea className="max-h-72">
				<div ref={listRef} className="py-1">
					{orderedCategories.map((category) => {
						const CategoryIcon = CATEGORY_ICON[category];
						return (
							<div key={category} role="group" aria-label={COMMAND_CATEGORY_LABELS[category]}>
								<div className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
									<CategoryIcon className="h-3 w-3" />
									{COMMAND_CATEGORY_LABELS[category]}
								</div>
								{grouped.get(category)?.map(({ cmd, index }) => {
									const RowIcon = cmd.icon ? (ICON_MAP[cmd.icon] ?? CommandIcon) : CommandIcon;
									const isSelected = index === selectedIndex;
									return (
										<button
											type="button"
											key={cmd.id}
											data-cmd-index={index}
											role="option"
											aria-selected={isSelected}
											onMouseEnter={() => onSelectIndex(index)}
											onMouseDown={(e) => {
												// Prevent the textarea from losing focus before we run.
												e.preventDefault();
												onRun(cmd, args);
											}}
											className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] transition-colors"
											style={{
												background: isSelected ? "hsl(var(--accent))" : "transparent",
												color: isSelected
													? "hsl(var(--accent-foreground))"
													: "hsl(var(--foreground))",
											}}
										>
											<RowIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
											<span className="shrink-0 font-medium">/{cmd.name}</span>
											<span className="truncate text-muted-foreground">{cmd.description}</span>
											{isSelected && cmd.argHint && (
												<span
													className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground"
													style={{ background: "hsl(var(--muted))" }}
												>
													{cmd.argHint}
												</span>
											)}
										</button>
									);
								})}
							</div>
						);
					})}
				</div>
			</ScrollArea>
		</div>
	);
}
