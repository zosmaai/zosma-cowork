import type { ExtensionToast, ExtensionWidget, ExtensionWorking } from "@/hooks/useExtensionUi";
import { cn } from "@/lib/utils";
import { AlertTriangle, Info, Loader2, X, XCircle } from "lucide-react";

/**
 * Ambient extension surfaces — the GUI renderer for pi's fire-and-forget
 * ExtensionUIContext methods (notify / setStatus / setWidget + Tier-2 working
 * indicators). Mounted once via ExtensionUiHost; positioned as fixed overlays
 * so they need no prop plumbing through the app tree.
 */

const TOAST_ICON = {
	info: Info,
	warning: AlertTriangle,
	error: XCircle,
} as const;

const TOAST_ACCENT = {
	info: "border-border bg-background text-foreground",
	warning: "border-amber-500/40 bg-amber-500/10 text-foreground",
	error: "border-red-500/40 bg-red-500/10 text-foreground",
} as const;

/** notify() → stacked toasts, top-right, auto-dismissing. */
export function ExtensionToasts({
	toasts,
	onDismiss,
}: {
	toasts: ExtensionToast[];
	onDismiss: (id: string) => void;
}) {
	if (toasts.length === 0) return null;
	return (
		<div className="fixed top-3 right-3 z-[60] flex flex-col gap-2 w-80 max-w-[calc(100vw-1.5rem)] pointer-events-none">
			{toasts.map((t) => {
				const Icon = TOAST_ICON[t.type];
				return (
					<div
						key={t.id}
						role="status"
						className={cn(
							"pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 shadow-lg backdrop-blur-md animate-in slide-in-from-right-2 fade-in",
							TOAST_ACCENT[t.type],
						)}
					>
						<Icon className="mt-0.5 h-4 w-4 shrink-0 opacity-80" />
						<p className="flex-1 text-xs leading-relaxed whitespace-pre-wrap break-words">
							{t.message}
						</p>
						<button
							type="button"
							onClick={() => onDismiss(t.id)}
							aria-label="Dismiss"
							className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
						>
							<X className="h-3.5 w-3.5" />
						</button>
					</div>
				);
			})}
		</div>
	);
}

/**
 * setStatus() chips are NOT rendered here — they fold natively into the
 * StatusLine footer (see StatusLine.tsx → ExtensionStatusChips), so they sit
 * inline with the model/context/token telemetry instead of floating over it.
 */

/** setWidget() → text-line cards, bottom-right. */
export function ExtensionWidgets({ widgets }: { widgets: ExtensionWidget[] }) {
	if (widgets.length === 0) return null;
	return (
		<div className="fixed bottom-3 right-3 z-[55] flex flex-col gap-2 w-72 max-w-[calc(100vw-1.5rem)] pointer-events-none">
			{widgets.map((w) => (
				<div
					key={w.key}
					className="pointer-events-auto overflow-hidden rounded-lg border border-border bg-background/90 shadow-lg backdrop-blur-md"
				>
					<div className="flex items-center gap-1.5 border-b border-border/60 bg-muted/30 px-2.5 py-1">
						<span className="h-1.5 w-1.5 rounded-full bg-primary/70" />
						<span className="truncate text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground">
							{w.key}
						</span>
					</div>
					<pre className="whitespace-pre-wrap break-words px-2.5 py-2 font-mono text-[0.6875rem] leading-relaxed text-foreground/90">
						{w.lines.join("\n")}
					</pre>
				</div>
			))}
		</div>
	);
}

/** Tier-2 working indicator → small badge, bottom-center. */
export function ExtensionWorkingBadge({ working }: { working: ExtensionWorking }) {
	if (!working.visible) return null;
	const text = working.message ?? working.label ?? "Working…";
	return (
		<div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-[55] pointer-events-none">
			<span className="inline-flex items-center gap-2 rounded-full border border-border bg-background/90 px-3 py-1 text-[0.6875rem] text-muted-foreground shadow-sm backdrop-blur-md">
				<Loader2 className="h-3 w-3 animate-spin" />
				{text}
			</span>
		</div>
	);
}
