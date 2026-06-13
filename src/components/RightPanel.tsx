import type { StreamState } from "@/hooks/usePiStream";
import type { ToolCallInfo } from "@/types";
import { AlertCircle, Check, Loader2, Terminal, X } from "lucide-react";

interface RightPanelProps {
	streamState: StreamState;
	onClose: () => void;
}

export function RightPanel({ streamState, onClose }: RightPanelProps) {
	const toolCalls = streamState.streamingMessage?.toolCalls || [];
	const hasTools = toolCalls.length > 0;

	return (
		<div className="w-[280px] flex flex-col gap-4 p-4 border-l overflow-y-auto shrink-0 bg-sidebar-background border-sidebar-border">
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-semibold text-sidebar-foreground">Context</h3>
				<button
					type="button"
					onClick={onClose}
					className="p-1 rounded transition-colors hover:bg-accent text-muted-foreground"
					aria-label="Close panel"
				>
					<X className="w-4 h-4" />
				</button>
			</div>

			{/* Status */}
			<div className="rounded-xl border p-4 bg-card border-border">
				<h3 className="text-sm font-semibold mb-3 text-card-foreground">Status</h3>
				<div className="flex items-center gap-2">
					{streamState.isRunning ? (
						<>
							<Loader2 className="w-4 h-4 animate-spin text-status-active-fg" />
							<span className="text-xs capitalize text-muted-foreground">
								{streamState.status.replace("_", " ")}
							</span>
						</>
					) : (
						<>
							<Check className="w-4 h-4 text-success" />
							<span className="text-xs text-muted-foreground">Idle</span>
						</>
					)}
				</div>
				{streamState.streamingMessage?.model && (
					<p
						className="text-[10px] mt-2 font-mono"
						style={{ color: "hsl(var(--muted-foreground) / 0.6)" }}
					>
						{streamState.streamingMessage.provider}/{streamState.streamingMessage.model}
					</p>
				)}
			</div>

			{/* Tool calls */}
			{hasTools && (
				<div className="rounded-xl border p-4 bg-card border-border">
					<h3 className="text-sm font-semibold mb-3 text-card-foreground">
						Tool Calls ({toolCalls.length})
					</h3>
					<div className="space-y-2">
						{toolCalls.map((tc) => (
							<ToolCard key={tc.id} toolCall={tc} />
						))}
					</div>
				</div>
			)}

			{/* Usage */}
			{streamState.messages.length > 0 && (
				<div className="rounded-xl border p-4 bg-card border-border">
					<h3 className="text-sm font-semibold mb-3 text-card-foreground">Session</h3>
					<div className="space-y-1 text-xs text-muted-foreground">
						<div className="flex justify-between">
							<span>Messages</span>
							<span style={{ color: "hsl(var(--foreground))" }}>{streamState.messages.length}</span>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

function ToolCard({ toolCall }: { toolCall: ToolCallInfo }) {
	return (
		<div
			className="rounded-lg border p-2"
			style={{
				background:
					toolCall.status === "running"
						? "hsl(var(--tool-running-bg))"
						: toolCall.status === "error"
							? "hsl(var(--tool-error-bg))"
							: "hsl(var(--tool-complete-bg))",
				borderColor:
					toolCall.status === "running"
						? "hsl(var(--tool-running-border))"
						: toolCall.status === "error"
							? "hsl(var(--tool-error-border))"
							: "hsl(var(--tool-complete-border))",
			}}
		>
			<div className="flex items-center gap-2">
				{toolCall.status === "running" ? (
					<Loader2 className="w-3.5 h-3.5 animate-spin text-tool-running-fg" />
				) : toolCall.status === "error" ? (
					<AlertCircle className="w-3.5 h-3.5 text-tool-error-fg" />
				) : (
					<Check className="w-3.5 h-3.5 text-tool-complete-fg" />
				)}
				<Terminal className="w-3.5 h-3.5 text-muted-foreground" />
				<span className="text-xs font-medium flex-1 text-foreground">{toolCall.name}</span>
			</div>
			{toolCall.result && (
				<pre
					className="mt-1 text-[10px] rounded p-1.5 overflow-x-auto whitespace-pre-wrap"
					style={{
						background: "hsl(var(--muted) / 0.5)",
						color: "hsl(var(--muted-foreground))",
					}}
				>
					{toolCall.result}
				</pre>
			)}
		</div>
	);
}
