/**
 * Dialog primitive — reusable modal shell with motion, focus management,
 * scroll lock, and Esc/click-outside dismissal.
 *
 * Compose with DialogHeader / DialogBody / DialogFooter for consistent
 * structure, or pass arbitrary children.
 */
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { AnimatePresence, type HTMLMotionProps, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

type DialogSize = "sm" | "md" | "lg";

const SIZE_CLASS: Record<DialogSize, string> = {
	sm: "max-w-sm",
	md: "max-w-md",
	lg: "max-w-2xl",
};

interface DialogProps {
	open: boolean;
	onClose: () => void;
	children: ReactNode;
	size?: DialogSize;
	/** Click on backdrop dismisses (default true). Set false for destructive flows. */
	closeOnBackdrop?: boolean;
	/** aria-labelledby target id — pass DialogTitle's id for proper labeling */
	labelledBy?: string;
	className?: string;
}

export function Dialog({
	open,
	onClose,
	children,
	size = "md",
	closeOnBackdrop = true,
	labelledBy,
	className,
}: DialogProps) {
	const reduced = useReducedMotion();
	const panelRef = useRef<HTMLDivElement>(null);

	// Esc to close + initial focus + scroll lock
	useEffect(() => {
		if (!open) return;

		const handleKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", handleKey);

		// Lock background scroll
		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";

		// Focus first interactive element inside panel. A consumer can mark a
		// preferred target with `data-autofocus` (e.g. a text field) so focus does
		// not default to the header close button.
		const panel = panelRef.current;
		if (panel) {
			const focusable =
				panel.querySelector<HTMLElement>("[data-autofocus]:not([disabled])") ??
				panel.querySelector<HTMLElement>(
					'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
				);
			// Small timeout so the focus lands after the entrance animation begins
			const id = window.setTimeout(() => focusable?.focus(), 50);
			return () => {
				window.removeEventListener("keydown", handleKey);
				document.body.style.overflow = prevOverflow;
				window.clearTimeout(id);
			};
		}

		return () => {
			window.removeEventListener("keydown", handleKey);
			document.body.style.overflow = prevOverflow;
		};
	}, [open, onClose]);

	return createPortal(
		<AnimatePresence>
			{open && (
				<div className="fixed inset-0 z-50 flex items-center justify-center">
					{/* Backdrop */}
					<motion.button
						type="button"
						aria-label="Close dialog"
						tabIndex={-1}
						className="absolute inset-0 bg-black/40 backdrop-blur-md cursor-default"
						initial={reduced ? false : { opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
						onClick={closeOnBackdrop ? onClose : undefined}
					/>

					{/* Panel */}
					<motion.div
						ref={panelRef}
						role="dialog"
						aria-modal="true"
						aria-labelledby={labelledBy}
						className={cn(
							"relative w-full mx-4 overflow-hidden panel-raised",
							SIZE_CLASS[size],
							className,
						)}
						initial={reduced ? false : { opacity: 0, y: 16, scale: 0.96 }}
						animate={{ opacity: 1, y: 0, scale: 1 }}
						exit={
							reduced
								? { opacity: 0 }
								: { opacity: 0, scale: 0.97, transition: { duration: 0.12, ease: "easeIn" } }
						}
						transition={{
							type: "spring",
							stiffness: 380,
							damping: 32,
							mass: 0.8,
						}}
					>
						{children}
					</motion.div>
				</div>
			)}
		</AnimatePresence>,
		document.body,
	);
}

/* ─────────────────────────────────────────────────────────── */
/* Sub-components for consistent dialog structure              */
/* ─────────────────────────────────────────────────────────── */

export function DialogHeader({
	title,
	description,
	onClose,
	icon,
	titleId,
}: {
	title: ReactNode;
	description?: ReactNode;
	onClose?: () => void;
	icon?: ReactNode;
	titleId?: string;
}) {
	const fallbackId = useId();
	const id = titleId ?? fallbackId;
	return (
		<div className="flex items-start gap-3 px-5 py-4 border-b border-border">
			{icon && <div className="shrink-0 mt-0.5">{icon}</div>}
			<div className="min-w-0 flex-1">
				<h2 id={id} className="text-sm font-semibold text-foreground truncate">
					{title}
				</h2>
				{description && (
					<p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{description}</p>
				)}
			</div>
			{onClose && (
				<button
					type="button"
					onClick={onClose}
					aria-label="Close"
					className="shrink-0 p-1 -m-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors active:scale-95"
				>
					<X className="w-4 h-4" />
				</button>
			)}
		</div>
	);
}

export function DialogBody({
	children,
	className,
	scrollable = false,
}: {
	children: ReactNode;
	className?: string;
	scrollable?: boolean;
}) {
	return (
		<div className={cn("px-5 py-4", scrollable && "max-h-[60vh] overflow-y-auto", className)}>
			{children}
		</div>
	);
}

export function DialogFooter({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-muted/30",
				className,
			)}
		>
			{children}
		</div>
	);
}

/**
 * Staggered motion wrapper for dialog body children — gives the contents
 * a subtle reveal after the panel lands. Use sparingly: one stagger group
 * per dialog max.
 */
export function DialogStagger({
	children,
	delayChildren = 0.08,
	stagger = 0.04,
	...rest
}: HTMLMotionProps<"div"> & { delayChildren?: number; stagger?: number }) {
	const reduced = useReducedMotion();
	return (
		<motion.div
			initial="hidden"
			animate="show"
			variants={{
				hidden: {},
				show: {
					transition: reduced ? {} : { delayChildren, staggerChildren: stagger },
				},
			}}
			{...rest}
		>
			{children}
		</motion.div>
	);
}

export function DialogStaggerItem({
	children,
	className,
}: { children: ReactNode; className?: string }) {
	const reduced = useReducedMotion();
	return (
		<motion.div
			className={className}
			variants={{
				hidden: reduced ? {} : { opacity: 0, y: 6 },
				show: {
					opacity: 1,
					y: 0,
					transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] },
				},
			}}
		>
			{children}
		</motion.div>
	);
}
