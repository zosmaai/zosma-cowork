import { ActivityBlock, ActivityRecap } from "@/components/ActivityBlock";
import { AttachmentCard } from "@/components/AttachmentCard";
import { markdownComponents } from "@/components/MarkdownComponents";
import { ThinkingBlock } from "@/components/ThinkingBlock";
import { ToolCallTimeline } from "@/components/ToolCallTimeline";
import type { ChatMessage, ModelInfo } from "@/types";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface WorkSessionViewProps {
	messages: ChatMessage[];
	streamingMessage: ChatMessage | null;
	isRunning: boolean;
	models?: ModelInfo[];
	detailsExpanded: boolean;
	workspaceCwd: string;
}

export function WorkSessionView({
	messages,
	streamingMessage,
	isRunning,
	detailsExpanded,
	workspaceCwd,
}: WorkSessionViewProps) {
	const allMessages = streamingMessage ? [...messages, streamingMessage] : messages;

	return (
		<div className="work-result-stack">
			{allMessages.map((message) => {
				if (message.role === "system") {
					return (
						<div
							key={message.id}
							data-message-id={message.id}
							className="py-2 text-center text-[13px] text-muted-foreground"
						>
							{message.content}
						</div>
					);
				}

				if (message.role === "user") {
					return (
						<div key={message.id} data-message-id={message.id}>
							<blockquote className="work-direction-row">
								<ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
									{message.content}
								</ReactMarkdown>
								{message.attachments?.map((attachment) => (
									<AttachmentCard
										key={attachment.path}
										path={attachment.path}
										name={attachment.name}
										size={attachment.size}
										mimeType={attachment.mimeType}
									/>
								))}
							</blockquote>
						</div>
					);
				}

				const toolCalls = message.toolCalls ?? [];
				return (
					<article
						key={message.id}
						data-message-id={message.id}
						className="work-result-document chat-markdown"
					>
						{detailsExpanded && message.thinking && (
							<ThinkingBlock
								thinking={message.thinking}
								isThinking={message.isStreaming}
								expanded
							/>
						)}
						{toolCalls.length > 0 &&
							(detailsExpanded ? (
								<ToolCallTimeline
									toolCalls={toolCalls}
									detailsExpanded
									workspaceCwd={workspaceCwd}
								/>
							) : message.isStreaming && isRunning ? (
								<ActivityBlock toolCalls={toolCalls} active />
							) : (
								<ActivityRecap toolCalls={toolCalls} />
							))}
						{message.content && (
							<ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
								{message.content}
							</ReactMarkdown>
						)}
					</article>
				);
			})}
		</div>
	);
}
