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
	CornerDownLeft,
	Eye,
	MessageSquarePlus,
	SlidersHorizontal,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ComponentType, Fragment, type ReactNode, type RefObject } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface CommandPaletteProps {
	/**
	 * Element the popover is anchored above. The palette renders in a portal on
	 * document.body (to escape the composer's overflow-hidden / transformed
	 * ancestors) and is positioned just above this element.
	 */
	anchorRef: RefObject<HTMLElement | null>;
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

/**
 * Render `text` with the characters that match `query` (as an ordered
 * subsequence, matching commandFilter's scoring) emphasised. Falls back to
 * plain text when there is no query or no subsequence match.
 */
function highlight(text: string, query: string): ReactNode {
	const q = query.trim().toLowerCase();
	if (!q) return text;
	const lower = text.toLowerCase();
	const out: ReactNode[] = [];
	let qi = 0;
	let runStart = -1;
	const flush = (end: number) => {
		if (runStart === -1) return;
		out.push(
			<mark
				key={`m${runStart}`}
				className="bg-transparent font-semibold text-[hsl(var(--primary))]"
			>
				{text.slice(runStart, end)}
			</mark>,
		);
		runStart = -1;
	};
	for (let i = 0; i < text.length; i++) {
		if (qi < q.length && lower[i] === q[qi]) {
			if (runStart === -1) runStart = i;
			qi++;
		} else {
			flush(i);
			out.push(<Fragment key={`t${i}`}>{text[i]}</Fragment>);
		}
	}
	flush(text.length);
	// No full subsequence match (e.g. description-only hit) → plain text.
	return qi === q.length ? out : text;
}

/** Position of the popover, anchored above `anchor`, in viewport coords. */
interface AnchorPos {
	left: number;
	width: number;
	/** Distance from the viewport bottom to the anchor's top (for `bottom`). */
	bottom: number;
}

function useAnchorPosition(
	anchorRef: RefObject<HTMLElement | null>,
	deps: unknown[],
): AnchorPos | null {
	const [pos, setPos] = useState<AnchorPos | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: remeasure on content change
	useLayoutEffect(() => {
		const measure = () => {
			const el = anchorRef.current;
			if (!el) return;
			const r = el.getBoundingClientRect();
			setPos({ left: r.left, width: r.width, bottom: window.innerHeight - r.top });
		};
		measure();
		window.addEventListener("resize", measure);
		window.addEventListener("scroll", measure, true);
		return () => {
			window.removeEventListener("resize", measure);
			window.removeEventListener("scroll", measure, true);
		};
	}, deps);
	return pos;
}

export function CommandPalette({
	anchorRef,
	commands,
	query,
	args = "",
	selectedIndex,
	onRun,
	onSelectIndex,
}: CommandPaletteProps) {
	const filtered = useFilteredCommands(commands, query);
	const listRef = useRef<HTMLDivElement>(null);
	const prefersReducedMotion = useReducedMotion();
	const pos = useAnchorPosition(anchorRef, [query, filtered.length]);

	// Keep the highlighted row in view as the selection moves.
	useEffect(() => {
		const el = listRef.current?.querySelector<HTMLElement>(`[data-cmd-index="${selectedIndex}"]`);
		el?.scrollIntoView({ block: "nearest" });
	}, [selectedIndex]);

	if (typeof document === "undefined") return null;

	// Group the filtered (already ranked) list by category, preserving the
	// category display order and, within a category, the ranked order.
	const grouped = new Map<CommandCategory, { cmd: Command; index: number }[]>();
	filtered.forEach((cmd, index) => {
		const bucket = grouped.get(cmd.category) ?? [];
		bucket.push({ cmd, index });
		grouped.set(cmd.category, bucket);
	});
	const orderedCategories = COMMAND_CATEGORY_ORDER.filter((c) => grouped.has(c));

	return createPortal(
		<motion.div
			role="listbox"
			aria-label="Commands"
			tabIndex={-1}
			initial={prefersReducedMotion ? false : { opacity: 0, y: 6, scale: 0.985 }}
			animate={{ opacity: 1, y: 0, scale: 1 }}
			transition={{ duration: 0.16, ease: [0.2, 0.7, 0.2, 1] }}
			className="fixed z-[60] overflow-hidden rounded-2xl border shadow-2xl backdrop-blur-xl"
			style={{
				left: pos ? `${pos.left}px` : 0,
				width: pos ? `${pos.width}px` : "100%",
				bottom: pos ? `${pos.bottom + 8}px` : "5rem",
				visibility: pos ? "visible" : "hidden",
				background: "hsl(var(--popover) / 0.92)",
				borderColor: "hsl(var(--border))",
			}}
		>
			{/* Header strip */}
			<div
				className="flex items-center gap-2 border-b px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
				style={{ borderColor: "hsl(var(--border) / 0.6)" }}
			>
				<CommandIcon className="h-3.5 w-3.5 opacity-70" />
				<span>Commands</span>
				{filtered.length > 0 && (
					<span className="ml-auto tabular-nums opacity-60">{filtered.length}</span>
				)}
			</div>

			{filtered.length === 0 ? (
				<div className="px-3 py-6 text-center text-[13px] text-muted-foreground">
					No matching commands
				</div>
			) : (
				<ScrollArea className="max-h-80">
					<div ref={listRef} className="py-1.5">
						<AnimatePresence initial={false}>
							{orderedCategories.map((category) => {
								const CategoryIcon = CATEGORY_ICON[category];
								return (
									<div key={category} role="group" aria-label={COMMAND_CATEGORY_LABELS[category]}>
										<div className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
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
														// Keep focus on the textarea before we run.
														e.preventDefault();
														onRun(cmd, args);
													}}
													className="group relative mx-1.5 flex w-[calc(100%-0.75rem)] items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors"
													style={{
														background: isSelected ? "hsl(var(--accent))" : "transparent",
														color: isSelected
															? "hsl(var(--accent-foreground))"
															: "hsl(var(--foreground))",
													}}
												>
													{/* Selected accent bar */}
													<span
														className="absolute inset-y-1.5 left-0 w-0.5 rounded-full transition-opacity"
														style={{
															background: "hsl(var(--primary))",
															opacity: isSelected ? 1 : 0,
														}}
													/>
													<RowIcon
														className="h-4 w-4 shrink-0"
														style={{ opacity: isSelected ? 0.9 : 0.55 }}
													/>
													<span className="shrink-0 font-medium tracking-tight">
														<span className="opacity-40">/</span>
														{highlight(cmd.name, query)}
													</span>
													<span
														className="truncate text-[12px]"
														style={{ color: "hsl(var(--muted-foreground))" }}
													>
														{cmd.description}
													</span>
													<span className="ml-auto flex shrink-0 items-center gap-2">
														{cmd.argHint && (
															<span
																className="rounded px-1.5 py-0.5 text-[10px] tabular-nums"
																style={{
																	background: "hsl(var(--muted))",
																	color: "hsl(var(--muted-foreground))",
																	opacity: isSelected ? 1 : 0.7,
																}}
															>
																{cmd.argHint}
															</span>
														)}
														{isSelected && (
															<CornerDownLeft className="h-3.5 w-3.5 opacity-60" aria-hidden />
														)}
													</span>
												</button>
											);
										})}
									</div>
								);
							})}
						</AnimatePresence>
					</div>
				</ScrollArea>
			)}

			{/* Keyboard hint footer */}
			<div
				className="flex items-center gap-3 border-t px-3 py-1.5 text-[10px] text-muted-foreground/70"
				style={{ borderColor: "hsl(var(--border) / 0.6)" }}
			>
				<Hint keys="↑↓" label="navigate" />
				<Hint keys="↵" label="run" />
				<Hint keys="tab" label="complete" />
				<Hint keys="esc" label="dismiss" />
			</div>
		</motion.div>,
		document.body,
	);
}

function Hint({ keys, label }: { keys: string; label: string }) {
	return (
		<span className="flex items-center gap-1">
			<kbd
				className="rounded px-1 py-0.5 font-mono text-[9px] leading-none"
				style={{ background: "hsl(var(--muted))", color: "hsl(var(--foreground) / 0.7)" }}
			>
				{keys}
			</kbd>
			<span>{label}</span>
		</span>
	);
}
