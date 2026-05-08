import { ChatMessageItem } from "@/components/ChatMessage";
import { ErrorBanner } from "@/components/ErrorBanner";
import { MessageInput } from "@/components/MessageInput";
import { StatusBar } from "@/components/StatusBar";
import type { ChatMessage, ModelInfo } from "@/types";
import { useCallback, useEffect, useRef } from "react";

export type StreamStateStatus = "idle" | "thinking" | "tool_call" | "responding" | "error";

interface ChatViewProps {
	messages: ChatMessage[];
	streamingMessage: ChatMessage | null;
	isRunning: boolean;
	status: StreamStateStatus;
	error: string | null;
	onSend: (text: string) => void;
	onAbort: () => void;
	onRetry?: () => void;
	models?: ModelInfo[];
	currentModelId?: string;
	onModelSelect?: (provider: string, modelId: string) => void;
}

export function ChatView({
	messages,
	streamingMessage,
	isRunning,
	status,
	error,
	onSend,
	onAbort,
	onRetry,
	models,
	currentModelId,
	onModelSelect,
}: ChatViewProps) {
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<{ focus: () => void }>(null);
	const isUserScrolledUp = useRef(false);

	const handleScroll = useCallback(() => {
		const container = scrollContainerRef.current;
		if (!container) return;
		const { scrollTop, scrollHeight, clientHeight } = container;
		isUserScrolledUp.current = scrollHeight - scrollTop - clientHeight > 100;
	}, []);

	useEffect(() => {
		// Re-run when messages change or streaming content updates
		const _ml = messages.length;
		const _sc = streamingMessage?.content.length;
		const _st = streamingMessage?.thinking?.length;
		void _ml;
		void _sc;
		void _st;
		if (!isUserScrolledUp.current) {
			messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
		}
	}, [messages.length, streamingMessage?.content.length, streamingMessage?.thinking?.length]);

	const allMessages = streamingMessage ? [...messages, streamingMessage] : messages;
	const isEmpty = messages.length === 0 && !streamingMessage;

	return (
		<>
			<div
				ref={scrollContainerRef}
				onScroll={handleScroll}
				className="flex-1 overflow-y-auto"
				style={{ scrollbarGutter: "stable" }}
			>
				{isEmpty ? (
					<div className="flex flex-col items-center justify-center h-full gap-5 px-8">
						<div className="text-4xl font-bold" style={{ color: "hsl(var(--primary))" }}>
							✦
						</div>
						<h1 className="text-2xl font-semibold" style={{ color: "hsl(var(--foreground))" }}>
							What are you working on?
						</h1>
						<p
							className="text-sm max-w-md text-center"
							style={{ color: "hsl(var(--muted-foreground))" }}
						>
							Type a message to start chatting with Zosma Cowork.
						</p>
					</div>
				) : (
					<div className="pb-4">
						{allMessages.map((msg, idx) => (
							<ChatMessageItem
								key={msg.id}
								message={msg}
								isLatest={idx === allMessages.length - 1}
							/>
						))}
						<div ref={messagesEndRef} />
					</div>
				)}
			</div>

			{error && <ErrorBanner error={error} onRetry={onRetry} onSwitchModel={onRetry} />}

			<StatusBar
				isRunning={isRunning}
				status={status}
				streamingMessage={streamingMessage}
				onAbort={onAbort}
			/>

			<MessageInput
				ref={inputRef}
				onSend={onSend}
				disabled={isRunning}
				models={models}
				currentModelId={currentModelId}
				onModelSelect={onModelSelect}
			/>
		</>
	);
}
