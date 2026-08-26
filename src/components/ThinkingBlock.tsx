import { Brain, ChevronRight } from "lucide-react";
import { useState } from "react";

interface ThinkingBlockProps {
	thinking: string;
	isThinking?: boolean;
	expanded?: boolean;
	/**
	 * Simple (non-technical) presentation: shimmer header, only the latest bit
	 * of thinking shown, no char counts or keyboard hints. Used by the default
	 * Perplexity-style activity view (issue #173).
	 */
	simple?: boolean;
}

export function ThinkingBlock({
	thinking,
	isThinking,
	expanded: expandedProp,
	simple,
}: ThinkingBlockProps) {
	const [localExpanded, setLocalExpanded] = useState(false);
	// Controlled by global Ctrl+O toggle via expanded prop
	const expanded = expandedProp !== undefined ? expandedProp : localExpanded;

	if (!thinking && !isThinking) return null;

	if (simple) {
		return (
			<SimpleThinking
				thinking={thinking}
				isThinking={isThinking}
				expanded={localExpanded}
				onToggle={() => setLocalExpanded((v) => !v)}
			/>
		);
	}

	return (
		<div className="mb-1">
			<button
				type="button"
				onClick={() => setLocalExpanded(!localExpanded)}
				className="flex items-center gap-1 text-[0.8125rem] opacity-60 hover:opacity-90 transition-opacity"
			>
				<ChevronRight
					className="w-3 h-3 flex-shrink-0 transition-transform"
					style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
				/>
				<Brain className="w-3 h-3 flex-shrink-0" />
				<span>
					{isThinking ? "Thinking" : "Thoughts"}
					{thinking && ` · ${thinking.length} chars`}
				</span>
				{!expanded && thinking && (
					<span className="text-[0.8125rem] opacity-40 ml-1">· Ctrl+O to expand</span>
				)}
			</button>
			{expanded && (
				<div className="mt-0.5 pl-4 text-[0.8125rem] whitespace-pre-wrap opacity-70 leading-relaxed">
					{thinking || "..."}
				</div>
			)}
		</div>
	);
}

/** Latest ~2 sentences / lines of the thinking stream, for the simple view. */
function latestThought(thinking: string): string {
	const trimmed = thinking.trim();
	if (!trimmed) return "";
	// Prefer the last non-empty paragraph/line; keep it short.
	const lines = trimmed.split(/\n+/).filter(Boolean);
	const last = lines[lines.length - 1] ?? trimmed;
	return last.length > 160 ? `…${last.slice(-160)}` : last;
}

function SimpleThinking({
	thinking,
	isThinking,
	expanded,
	onToggle,
}: {
	thinking: string;
	isThinking?: boolean;
	expanded: boolean;
	onToggle: () => void;
}) {
	const preview = latestThought(thinking);
	const hasMore = thinking.trim().length > preview.length;

	return (
		<div
			className="my-1.5 rounded-md px-3 py-2 animate-fade-in"
			style={{
				// Neutral/muted — deliberately distinct from the green "activity"
				// (tool) block so thinking doesn't look like a tool is running.
				background: "hsl(var(--muted) / 0.5)",
				borderLeft: "2px solid hsl(var(--muted-foreground) / 0.35)",
			}}
		>
			<button type="button" onClick={onToggle} className="flex w-full items-center gap-2 text-left">
				<Brain
					className={`h-3.5 w-3.5 flex-shrink-0 ${isThinking ? "animate-pulse-dot" : ""}`}
					style={{ color: "hsl(var(--muted-foreground))" }}
				/>
				<span
					className={`text-sm font-medium ${isThinking ? "animate-shimmer-text" : ""}`}
					style={isThinking ? undefined : { color: "hsl(var(--foreground))" }}
				>
					{isThinking ? "Thinking…" : "Thought for a moment"}
				</span>
				{(hasMore || (expanded && thinking)) && (
					<ChevronRight
						className="ml-auto h-3 w-3 flex-shrink-0 opacity-40 transition-transform"
						style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
					/>
				)}
			</button>

			{/* Latest snippet (collapsed) or full thinking (expanded) */}
			{expanded ? (
				thinking && (
					<div className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap pl-6 text-[0.75rem] leading-relaxed opacity-70">
						{thinking}
					</div>
				)
			) : preview ? (
				<div className="mt-1 truncate pl-6 text-[0.75rem] opacity-55">{preview}</div>
			) : null}
		</div>
	);
}
