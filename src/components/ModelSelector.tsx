import { findModel, modelKey } from "@/lib/model-key";
import type { ModelInfo } from "@/types";
import { Check, ChevronUp, Search, Sparkles, Zap } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface ModelSelectorProps {
	models: ModelInfo[];
	/** Active model identity as a `provider/id` key (see lib/model-key). */
	currentModelId?: string;
	onSelect: (provider: string, modelId: string) => void;
	/**
	 * Controlled open state. When provided the trigger still works but the
	 * parent can also open the dropdown programmatically (e.g. `/model` with
	 * no args from the slash-command palette).
	 */
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}

/** Short readable provider label */
function providerShort(provider: string): string {
	return provider.replace(/-?(api|ai|platform|provider)$/i, "").split("-")[0];
}

export function ModelSelector({
	models,
	currentModelId,
	onSelect,
	open: controlledOpen,
	onOpenChange,
}: ModelSelectorProps) {
	const [internalOpen, setInternalOpen] = useState(false);
	// Use controlled value when provided, otherwise fall back to internal state.
	const open = controlledOpen !== undefined ? controlledOpen : internalOpen;

	const setOpen = useCallback((value: boolean) => {
		setInternalOpen(value);
		onOpenChange?.(value);
	}, [onOpenChange]);
	const [query, setQuery] = useState("");
	const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
	// Max height of the whole dropdown box, clamped to the space actually
	// available between the trigger and the viewport edge (see recalcPosition).
	// The list inside flex-fills this and scrolls. Previously the list used a
	// fixed 272px cap with no viewport clamp, so on smaller windows its last
	// items rendered off-screen and — being a fixed-position scroll container —
	// were unreachable.
	const [boxMaxHeight, setBoxMaxHeight] = useState(320);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const searchRef = useRef<HTMLInputElement>(null);

	const current = findModel(models, currentModelId);
	const label = current ? current.name : "Default";
	const shortProvider = current ? providerShort(current.provider) : "";

	// Position the portal dropdown so the WHOLE box stays inside the viewport.
	// We place it on whichever side of the trigger has more room (above is
	// favoured on ties since the input sits at the bottom), cap the box height
	// to that space, then compute an explicit `top` and clamp it into
	// [MARGIN, vh - MARGIN - boxH]. The list inside flex-fills the box and
	// scrolls, so every model — including the last — is reachable. Anchoring
	// with a clamped `top` (not `bottom`) keeps it on-screen by construction;
	// previously the box could run past the bottom edge, hiding the last models.
	const recalcPosition = useCallback(() => {
		if (!triggerRef.current) return;
		const rect = triggerRef.current.getBoundingClientRect();
		const vh = window.innerHeight;
		const vw = window.innerWidth;
		const DROPDOWN_W = 264;
		const GAP = 6; // gap between trigger and dropdown
		const MARGIN = 12; // min gap from the viewport edge
		const MIN_BOX = 160;
		const MAX_BOX = 401; // search (~41) + ~360 of list

		const spaceAbove = rect.top - GAP - MARGIN;
		const spaceBelow = vh - rect.bottom - GAP - MARGIN;
		const placeAbove = spaceAbove >= spaceBelow;
		const avail = Math.max(spaceAbove, spaceBelow);
		const boxH = Math.max(MIN_BOX, Math.min(MAX_BOX, avail));
		setBoxMaxHeight(boxH);

		// Preferred top for the chosen side, then clamp so the whole box stays
		// within [MARGIN, vh - MARGIN]. boxH <= avail keeps it from needing to
		// shrink; the clamp also guards odd rect / innerHeight readings.
		const rawTop = placeAbove ? rect.top - GAP - boxH : rect.bottom + GAP;
		const top = Math.max(MARGIN, Math.min(rawTop, vh - MARGIN - boxH));
		const left = Math.min(rect.left, vw - DROPDOWN_W - 8);

		setDropdownStyle({ position: "fixed", left, top, width: DROPDOWN_W, zIndex: 9999 });
	}, []);

	const handleOpen = useCallback(() => {
		recalcPosition();
		setOpen(true);
		setQuery("");
	}, [recalcPosition, setOpen]);

	useEffect(() => {
		if (!open) return;
		function close(e: MouseEvent) {
			if (
				triggerRef.current &&
				!triggerRef.current.contains(e.target as Node) &&
				!(e.target as HTMLElement).closest("[data-model-dropdown]")
			)
				setOpen(false);
		}
		function onScroll() {
			recalcPosition();
		}
		document.addEventListener("mousedown", close);
		window.addEventListener("scroll", onScroll, true);
		return () => {
			document.removeEventListener("mousedown", close);
			window.removeEventListener("scroll", onScroll, true);
		};
	}, [open, recalcPosition, setOpen]);

	useEffect(() => {
		if (open) requestAnimationFrame(() => searchRef.current?.focus());
	}, [open]);

	const grouped = useMemo(() => {
		const q = query.toLowerCase().trim();
		const filtered = q
			? models.filter(
					(m) => m.name.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q),
				)
			: models;
		const map = new Map<string, ModelInfo[]>();
		for (const m of filtered) {
			if (!map.has(m.provider)) map.set(m.provider, []);
			map.get(m.provider)?.push(m);
		}
		return map;
	}, [models, query]);

	const totalFiltered = useMemo(() => [...grouped.values()].flat().length, [grouped]);

	return (
		<>
			{/* ── Trigger ── */}
			<button
				ref={triggerRef}
				type="button"
				aria-haspopup="listbox"
				aria-expanded={open}
				onClick={open ? () => setOpen(false) : handleOpen}
				className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition-colors
				           text-muted-foreground hover:text-foreground hover:bg-accent/60"
			>
				<Sparkles className="w-3 h-3 shrink-0 text-primary/70" />
				<span className="max-w-[110px] truncate">{label}</span>
				{shortProvider && (
					<span
						className="shrink-0 rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wider
					                 bg-primary/10 text-primary"
					>
						{shortProvider}
					</span>
				)}
				<ChevronUp
					className={`w-3 h-3 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
				/>
			</button>

			{/* ── Portal dropdown ── */}
			{createPortal(
				<AnimatePresence>
					{open && (
						<motion.div
							data-model-dropdown=""
							role="listbox"
							aria-label="Select a model"
							initial={{ opacity: 0, y: 6, scale: 0.97 }}
							animate={{ opacity: 1, y: 0, scale: 1 }}
							exit={{ opacity: 0, y: 6, scale: 0.97 }}
							transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
							className="rounded-xl border overflow-hidden flex flex-col"
							style={{
								...dropdownStyle,
								maxHeight: boxMaxHeight,
								background: "hsl(var(--popover))",
								borderColor: "hsl(var(--border))",
								boxShadow: "0 16px 48px hsl(0 0% 0% / 0.35), 0 2px 8px hsl(0 0% 0% / 0.2)",
							}}
						>
							{/* Search */}
							<div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
								<Search className="w-3.5 h-3.5 shrink-0 text-muted-foreground/60" />
								<input
									ref={searchRef}
									type="text"
									placeholder="Search models…"
									value={query}
									onChange={(e) => setQuery(e.target.value)}
									onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
									aria-label="Search models"
									className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
								/>
								{query && (
									<span className="text-[10px] text-muted-foreground/50 tabular-nums">
										{totalFiltered}
									</span>
								)}
							</div>

							{/* List */}
							<div className="flex-1 min-h-0 overflow-y-auto">
								{grouped.size === 0 ? (
									<p className="px-3 py-6 text-center text-xs text-muted-foreground/50">
										No models found
									</p>
								) : (
									[...grouped.entries()].map(([provider, providerModels]) => (
										<div key={provider}>
											{/* Provider heading */}
											<div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
												<span className="text-[9px] font-bold uppercase tracking-widest text-primary/80">
													{providerShort(provider)}
												</span>
												<div className="flex-1 h-px bg-primary/15" />
											</div>

											{/* Models */}
											{providerModels.map((model) => {
												const isActive = modelKey(model.provider, model.id) === currentModelId;
												return (
													<button
														key={modelKey(model.provider, model.id)}
														type="button"
														role="option"
														aria-selected={isActive}
														onClick={() => {
															onSelect(model.provider, model.id);
															setOpen(false);
														}}
														className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors
														            ${
																					isActive
																						? "bg-primary/10 text-foreground"
																						: "text-foreground/80 hover:bg-accent/50 hover:text-foreground"
																				}`}
													>
														{/* Icon: reasoning = sparkle (primary), fast = zap (muted) */}
														{model.reasoning ? (
															<Sparkles className="w-3 h-3 shrink-0 text-primary/70" />
														) : (
															<Zap className="w-3 h-3 shrink-0 text-muted-foreground/40" />
														)}

														{/* Name + context window */}
														<div className="flex-1 min-w-0">
															<span
																className={`text-xs truncate block ${isActive ? "font-semibold text-foreground" : ""}`}
															>
																{model.name}
															</span>
															{model.contextWindow > 0 && (
																<span className="text-[10px] text-muted-foreground/50 block">
																	{model.contextWindow >= 1000
																		? `${Math.round(model.contextWindow / 1000)}k ctx`
																		: `${model.contextWindow} ctx`}
																</span>
															)}
														</div>

														{/* Active tick */}
														{isActive && <Check className="w-3.5 h-3.5 shrink-0 text-primary" />}
													</button>
												);
											})}
										</div>
									))
								)}
							</div>
						</motion.div>
					)}
				</AnimatePresence>,
				document.body,
			)}
		</>
	);
}
