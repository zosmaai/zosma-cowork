import { ChatMessageItem } from "@/components/ChatMessage";
import { ErrorBanner } from "@/components/ErrorBanner";
import { MessageInput } from "@/components/MessageInput";
import { StatusBar } from "@/components/StatusBar";
import { SuggestedActions } from "@/components/SuggestedActions";
import type { ToolPhase } from "@/hooks/usePiStream";
import type { ChatMessage, ModelInfo } from "@/types";
import type { Command } from "@/types/commands";
import { useCallback, useEffect, useRef, useState } from "react";

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
	toolPhase?: ToolPhase | null;
	/** Changing this remounts the input, retriggering its entrance animation */
	sessionKey?: string;
	/** External draft (e.g. a prompt template) to load into the composer for editing. */
	draft?: { text: string; nonce: number };
	/** Slash-command registry + dispatch (epic #179). */
	commands?: Command[];
	onRunCommand?: (cmd: Command, args: string) => void;
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
	toolPhase,
	sessionKey,
	draft,
	commands,
	onRunCommand,
}: ChatViewProps) {
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<{ focus: () => void }>(null);
	const isUserScrolledUp = useRef(false);
	const [detailsExpanded, setDetailsExpanded] = useState(false);

	// Ctrl+O toggles expanded detail view (thinking, tool calls)
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (e.ctrlKey && e.key === "o") {
				e.preventDefault();
				setDetailsExpanded((prev) => !prev);
			}
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	const handleScroll = useCallback(() => {
		const container = scrollContainerRef.current;
		if (!container) return;
		const { scrollTop, scrollHeight, clientHeight } = container;
		isUserScrolledUp.current = scrollHeight - scrollTop - clientHeight > 100;
	}, []);

	// Build a stable key from tool call state so scroll fires on tool changes too
	const toolCallsKey =
		streamingMessage?.toolCalls
			?.map(
				(tc) => `${tc.id}:${tc.status}:${tc.partialOutput?.length ?? 0}:${tc.result?.length ?? 0}`,
			)
			.join("|") ?? "";

	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll on any content change including tools
	useEffect(() => {
		if (!isUserScrolledUp.current && messagesEndRef.current) {
			// Use instant scroll for streaming to avoid jitter from queued smooth animations
			messagesEndRef.current.scrollIntoView({ behavior: "auto" });
		}
	}, [
		messages.length,
		streamingMessage?.content.length,
		streamingMessage?.thinking?.length,
		toolCallsKey,
	]);

	const allMessages = streamingMessage ? [...messages, streamingMessage] : messages;
	const isEmpty = messages.length === 0 && !streamingMessage;

	return (
		<div className="chat-font flex flex-col flex-1 min-h-0">
			<div
				ref={scrollContainerRef}
				onScroll={handleScroll}
				className="flex-1 overflow-y-auto"
				style={{ scrollbarGutter: "stable" }}
			>
				{isEmpty ? (
					<SuggestedActions onSend={onSend} />
				) : (
					<div className="pt-1 pb-6">
						{allMessages.map((msg) => (
							<ChatMessageItem
								key={msg.id}
								message={msg}
								detailsExpanded={detailsExpanded}
								models={models}
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
				toolPhase={toolPhase}
				onAbort={onAbort}
			/>

			{/* overflow-hidden gives the slide-up animation a clean clip edge */}
			<div className="overflow-hidden">
				<MessageInput
					key={sessionKey}
					ref={inputRef}
					onSend={onSend}
					disabled={isRunning}
					models={models}
					currentModelId={currentModelId}
					onModelSelect={onModelSelect}
					draft={draft}
					commands={commands}
					onRunCommand={onRunCommand}
				/>
			</div>
		</div>
	);
}
