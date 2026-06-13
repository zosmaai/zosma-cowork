import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";

interface InThreadFindProps {
	open: boolean;
	query: string;
	/** Number of the active match (1-based for display), or 0 when none. */
	current: number;
	total: number;
	onQueryChange: (q: string) => void;
	onNext: () => void;
	onPrev: () => void;
	onClose: () => void;
}

const easeOutExpo = [0.16, 1, 0.3, 1] as const;

/**
 * Floating find-in-conversation bar (ChatGPT/Slack-style). Lives at the top of
 * the chat pane; navigates matches with Enter / Shift+Enter and ↑/↓, closes on
 * Escape. Opened via Cmd/Ctrl+F (wired by the parent).
 */
export function InThreadFind({
	open,
	query,
	current,
	total,
	onQueryChange,
	onNext,
	onPrev,
	onClose,
}: InThreadFindProps) {
	const reduced = useReducedMotion();
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (open) {
			inputRef.current?.focus();
			inputRef.current?.select();
		}
	}, [open]);

	const hasQuery = query.trim().length > 0;

	return (
		<AnimatePresence>
			{open && (
				<motion.div
					className="absolute top-2 left-1/2 z-20 -translate-x-1/2"
					initial={reduced ? { opacity: 0 } : { opacity: 0, y: -12 }}
					animate={{ opacity: 1, y: 0 }}
					exit={reduced ? { opacity: 0 } : { opacity: 0, y: -12 }}
					transition={{ duration: 0.2, ease: easeOutExpo }}
					role="search"
					aria-label="Find in conversation"
				>
					<div
						className="flex items-center gap-1.5 rounded-xl border px-2 py-1.5 shadow-lg backdrop-blur-md"
						style={{
							borderColor: "hsl(var(--border))",
							background: "hsl(var(--popover) / 0.92)",
						}}
					>
						<Search
							className="w-3.5 h-3.5 shrink-0"
							style={{ color: "hsl(var(--muted-foreground) / 0.6)" }}
						/>
						<input
							ref={inputRef}
							type="text"
							placeholder="Find in conversation…"
							aria-label="Find in conversation"
							value={query}
							onChange={(e) => onQueryChange(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									if (e.shiftKey) onPrev();
									else onNext();
								} else if (e.key === "Escape") {
									e.preventDefault();
									onClose();
								}
							}}
							className="w-52 bg-transparent text-[13px] focus:outline-none text-foreground"
						/>

						{/* Match counter */}
						<span
							className="min-w-[3.2rem] text-center text-[11px] tabular-nums select-none"
							style={{
								color: hasQuery
									? total > 0
										? "hsl(var(--muted-foreground))"
										: "hsl(var(--destructive))"
									: "hsl(var(--muted-foreground) / 0.4)",
							}}
						>
							{hasQuery ? (total > 0 ? `${current}/${total}` : "0/0") : "—"}
						</span>

						<div className="flex items-center">
							<button
								type="button"
								aria-label="Previous match"
								disabled={total === 0}
								onClick={onPrev}
								className="flex items-center justify-center w-6 h-6 rounded-md transition-colors disabled:opacity-30 hover:bg-muted text-foreground"
							>
								<ChevronUp className="w-3.5 h-3.5" />
							</button>
							<button
								type="button"
								aria-label="Next match"
								disabled={total === 0}
								onClick={onNext}
								className="flex items-center justify-center w-6 h-6 rounded-md transition-colors disabled:opacity-30 hover:bg-muted text-foreground"
							>
								<ChevronDown className="w-3.5 h-3.5" />
							</button>
						</div>

						<div className="w-px h-4 mx-0.5 bg-border" aria-hidden="true" />

						<button
							type="button"
							aria-label="Close find"
							onClick={onClose}
							className="flex items-center justify-center w-6 h-6 rounded-md transition-colors hover:bg-muted text-muted-foreground"
						>
							<X className="w-3.5 h-3.5" />
						</button>
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
