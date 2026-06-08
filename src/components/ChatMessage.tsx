import { trackEvent } from "@/lib/telemetry";
import type { ChatMessage as ChatMessageType, ModelInfo } from "@/types";
import { invoke } from "@tauri-apps/api/core";
import { Clipboard, Download, FolderOpen, User } from "lucide-react";
import { useCallback, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ActivityBlock, ActivityRecap } from "./ActivityBlock";
import { markdownComponents } from "./MarkdownComponents";
import { FeedbackButtons } from "./FeedbackButtons";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCallSummary, ToolCallTimeline } from "./ToolCallTimeline";

interface ChatMessageProps {
	message: ChatMessageType;
	detailsExpanded?: boolean;
	/** Model catalog, used to show a friendly model name instead of raw id. */
	models?: ModelInfo[];
}

/**
 * Friendly label for the model that produced a message. Prefer the catalog's
 * display name (e.g. "Claude Sonnet 4") so it matches the model selector; fall
 * back to the raw `provider/id` when the model isn't in the catalog.
 */
function modelLabel(message: ChatMessageType, models?: ModelInfo[]): string {
	// Match on provider+id: ids are not unique across providers, so matching by
	// id alone could show the wrong provider's display name.
	const match = models?.find((m) => m.id === message.model && m.provider === message.provider);
	if (match) return match.name;
	return message.provider ? `${message.provider}/${message.model}` : (message.model ?? "");
}

function extractFilePath(content: string): string | null {
	const match = content.match(
		/(?:Written|Created|Wrote)\s+(?:\d+\s+lines\s+)?(?:to\s+)?(.+?)(?:\s+\(|$)/m,
	);
	return match?.[1]?.trim() ?? null;
}

export function ChatMessageItem({ message, detailsExpanded, models }: ChatMessageProps) {
	const [copied, setCopied] = useState(false);
	const [saving, setSaving] = useState(false);
	const isUser = message.role === "user";
	const isSystem = message.role === "system";

	const filePath = !isUser && message.content ? extractFilePath(message.content) : null;

	const copyToClipboard = useCallback(async (text: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
			trackEvent("export_action", { type: "copy" });
		} catch {
			// fallback
		}
	}, []);

	const saveToFile = useCallback(async (content: string) => {
		try {
			const { save } = await import("@tauri-apps/plugin-dialog");
			const path = await save({
				defaultPath: "zosma-export.md",
				filters: [
					{
						name: "Markdown",
						extensions: ["md", "mdx", "txt"],
					},
					{
						name: "All files",
						extensions: ["*"],
					},
				],
			});
			if (!path) return;
			setSaving(true);
			await invoke("write_user_file", { path, content });
			trackEvent("export_action", { type: "save" });
		} catch {
			// ignore
		} finally {
			setSaving(false);
		}
	}, []);

	const openFolder = useCallback(async (path: string) => {
		try {
			// Get parent directory
			const parentDir = path.substring(0, path.lastIndexOf("/"));
			if (parentDir) {
				await invoke("open_url", { url: `file://${parentDir}` });
				trackEvent("export_action", { type: "open_folder" });
			}
		} catch {
			// ignore
		}
	}, []);

	if (isSystem) {
		return (
			<div className="flex justify-center py-2">
				<span
					className="px-3 py-1 rounded-full text-xs"
					style={{
						background: "hsl(var(--chat-system-bg))",
						color: "hsl(var(--chat-system-fg))",
					}}
				>
					{message.content}
				</span>
			</div>
		);
	}

	return (
		<div className="group px-4 py-1.5 animate-fade-in">
			<div
				className="flex gap-3.5 mx-auto w-full rounded-2xl px-4 py-3 transition-colors"
				style={{
					maxWidth: "var(--chat-max-width, 820px)",
					background: isUser ? "hsl(var(--chat-user-bg))" : "hsl(var(--chat-assistant-bg))",
				}}
			>
			{/* Avatar */}
			<div className="flex-shrink-0">
				{isUser ? (
					<div
						className="w-7 h-7 rounded-lg flex items-center justify-center"
						style={{
							background:
								"linear-gradient(135deg, hsl(var(--primary) / 0.9), hsl(var(--primary) / 0.6))",
							color: "hsl(var(--primary-foreground))",
						}}
					>
						<User className="w-4 h-4" strokeWidth={2.5} />
					</div>
				) : (
					<img
						src="/zosma-mark.png"
						alt="Zosma"
						className="w-7 h-7 rounded-lg object-cover"
						draggable={false}
					/>
				)}
			</div>

			{/* Content */}
			<div className="flex-1 min-w-0">
				{/* Header row */}
				<div className="flex items-center gap-2 mb-0.5">
					<span className="text-xs font-medium" style={{ color: "hsl(var(--foreground))" }}>
						{isUser ? "You" : "Zosma"}
					</span>
					<span className="text-[10px] text-muted-foreground tabular-nums">
						{new Date(message.timestamp).toLocaleTimeString([], {
							hour: "2-digit",
							minute: "2-digit",
						})}
					</span>
					{/* Queued steer/follow-up badges were removed in the #201 PR3
					    follow-up: queued messages no longer live in state.messages,
					    so this code path is unreachable. ChatView renders queued
					    items inline (pi-style) from streamState.queue instead. */}
					{message.model && (
						<span className="text-[10px] text-muted-foreground/50 bg-muted/60 px-1.5 py-0 rounded font-mono">
							{modelLabel(message, models)}
						</span>
					)}
					{message.isStreaming && (
						<span
							className="inline-flex items-center gap-1 text-[10px] font-medium"
							style={{ color: "hsl(var(--status-active-fg))" }}
						>
							<span
								className="w-1.5 h-1.5 rounded-full animate-pulse-dot"
								style={{ background: "hsl(var(--primary))" }}
							/>
							streaming
						</span>
					)}
					{!isUser && message.toolCalls && message.toolCalls.length > 0 && !message.isStreaming && (
						<ToolCallSummary toolCalls={message.toolCalls} />
					)}
				</div>

				{/* Thinking block — simple (Perplexity-style) by default, full when
				    details are expanded via Ctrl+O. */}
				{!isUser && message.thinking && (
					<ThinkingBlock
						thinking={message.thinking}
						isThinking={message.isStreaming && message.thinking.length > 0}
						expanded={detailsExpanded}
						simple={!detailsExpanded}
					/>
				)}

				{/* Activity / tool calls.
				    - details view (Ctrl+O): full technical ToolCallTimeline
				    - simple + streaming: single friendly ActivityBlock
				    - simple + finished: compact one-line recap */}
				{!isUser &&
					message.toolCalls &&
					message.toolCalls.length > 0 &&
					(detailsExpanded ? (
						<ToolCallTimeline toolCalls={message.toolCalls} detailsExpanded={detailsExpanded} />
					) : message.isStreaming ? (
						<ActivityBlock toolCalls={message.toolCalls} active />
					) : (
						<ActivityRecap toolCalls={message.toolCalls} />
					))}

				{/* Content */}
				{(message.content || message.isStreaming) && (
					<div
						className="chat-markdown"
						style={{ color: isUser ? "hsl(var(--chat-user-fg))" : "hsl(var(--chat-assistant-fg))" }}
					>
						<ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
							{message.content || ""}
						</ReactMarkdown>
						{message.isStreaming && (
							<span
								className="inline-block w-2 h-4 ml-0.5 align-middle animate-pulse"
								style={{ background: "hsl(var(--primary))" }}
							/>
						)}
					</div>
				)}

				{/* Feedback & Export Actions */}
				{!isUser && message.content && !message.isStreaming && (
					<div className="flex items-center justify-between mt-1.5">
						<FeedbackButtons />
						<div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
							<button
								type="button"
								onClick={() => copyToClipboard(message.content)}
								aria-label="Copy content"
								className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
							>
								<Clipboard size={12} />
								{copied ? "Copied!" : "Copy"}
							</button>
							<button
								type="button"
								onClick={() => saveToFile(message.content)}
								disabled={saving}
								aria-label="Save to file"
								className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-50"
							>
								<Download size={12} />
								{saving ? "Saving..." : "Save"}
							</button>
							{filePath && (
								<button
									type="button"
									onClick={() => openFolder(filePath)}
									aria-label="Open folder"
									className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
								>
									<FolderOpen size={12} />
									Open Folder
								</button>
							)}
						</div>
					</div>
				)}
			</div>
			</div>
		</div>
	);
}
