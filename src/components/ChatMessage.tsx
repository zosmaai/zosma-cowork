import { trackEvent } from "@/lib/telemetry";
import type { ChatMessage as ChatMessageType } from "@/types";
import { invoke } from "@tauri-apps/api/core";
import { Clipboard, Download, FolderOpen } from "lucide-react";
import { useCallback, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FeedbackButtons } from "./FeedbackButtons";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCallSummary, ToolCallTimeline } from "./ToolCallTimeline";

interface ChatMessageProps {
	message: ChatMessageType;
	detailsExpanded?: boolean;
}

function extractFilePath(content: string): string | null {
	const match = content.match(
		/(?:Written|Created|Wrote)\s+(?:\d+\s+lines\s+)?(?:to\s+)?(.+?)(?:\s+\(|$)/m,
	);
	return match?.[1]?.trim() ?? null;
}

export function ChatMessageItem({ message, detailsExpanded }: ChatMessageProps) {
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
		<div
			className="group flex gap-3 py-3 px-5 transition-colors animate-fade-in"
			style={{
				background: isUser ? "hsl(var(--chat-user-bg))" : "hsl(var(--chat-assistant-bg))",
			}}
		>
			{/* Avatar */}
			<div className="flex-shrink-0">
				{isUser ? (
					<div
						className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-semibold"
						style={{
							background: "hsl(var(--chat-avatar-user-bg))",
							color: "hsl(var(--chat-avatar-user-fg))",
						}}
					>
						You
					</div>
				) : (
					<div
						className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold"
						style={{
							background: "hsl(var(--chat-avatar-assistant-bg))",
							color: "hsl(var(--chat-avatar-assistant-fg))",
						}}
					>
						Z
					</div>
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
					{message.model && (
						<span className="text-[10px] text-muted-foreground/50 bg-muted/60 px-1.5 py-0 rounded font-mono">
							{message.provider}/{message.model}
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

				{/* Thinking block */}
				{!isUser && message.thinking && (
					<ThinkingBlock
						thinking={message.thinking}
						isThinking={message.isStreaming && message.thinking.length > 0}
						expanded={detailsExpanded}
					/>
				)}

				{/* Tool calls — flat inline timeline */}
				{!isUser && message.toolCalls && message.toolCalls.length > 0 && (
					<ToolCallTimeline toolCalls={message.toolCalls} detailsExpanded={detailsExpanded} />
				)}

				{/* Content */}
				{(message.content || message.isStreaming) && (
					<div
						className="prose prose-sm max-w-none"
						style={{ color: isUser ? "hsl(var(--chat-user-fg))" : "hsl(var(--chat-assistant-fg))" }}
					>
						<ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content || ""}</ReactMarkdown>
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
	);
}
