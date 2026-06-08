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
	/** Issue #201, PR 2 — queue a steering message on the active session. */
	onSteer?: (text: string) => void;
	/** Issue #201, PR 2 — queue a follow-up message on the active session. */
	onFollowUp?: (text: string) => void;
	/** Issue #201, PR 3 — SDK queue snapshot for composer affordance. */
	queue?: { steering: readonly string[]; followUp: readonly string[] };
	/** Issue #201, PR 3 — user pressed Ctrl+↑ to edit the pending queue. */
	onEditQueue?: () => void;
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
	onSteer,
	onFollowUp,
	queue,
	onEditQueue,
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
	const queuedItems = [
		...(queue?.steering ?? []).map((text, i) => ({
			key: `s:${i}:${text}`,
			kind: "steer" as const,
			text,
		})),
		...(queue?.followUp ?? []).map((text, i) => ({
			key: `f:${i}:${text}`,
			kind: "follow_up" as const,
			text,
		})),
	];

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
						{/* Issue #201 PR3 follow-up: queued messages render AFTER
						    streamingMessage — they are work the agent will do NEXT,
						    so chronologically they belong below the current bubble.
						    Threaded visual: a left vertical line ties the queued
						    items to the in-progress bubble above (pi-TUI inspired).
						    Source of truth is the `queue` prop — NOT state.messages
						    — so clearQueue() drops every bubble atomically. */}
						{queuedItems.length > 0 && (
							<div data-testid="queued-section" className="mx-auto max-w-3xl px-6 mt-1 mb-3">
								<div
									data-testid="queued-thread"
									className="ml-11 border-l-2 pl-4 py-1 space-y-1.5 text-sm"
									style={{ borderColor: "hsl(var(--border))" }}
								>
									{queuedItems.map((item) => (
										<div
											key={item.key}
											className="relative text-muted-foreground/90 leading-relaxed"
										>
											{/* Tiny node-dot connecting each item to the thread line. */}
											<span
												className="absolute -left-[1.30rem] top-2 h-1.5 w-1.5 rounded-full"
												style={{ background: "hsl(var(--border))" }}
												aria-hidden="true"
											/>
											<span className="font-medium text-muted-foreground">
												{item.kind === "steer" ? "Steering " : "Follow-up "}
											</span>
											<span className="text-muted-foreground/60">· </span>
											<span className="whitespace-pre-wrap">{item.text}</span>
										</div>
									))}
									<div className="text-xs text-muted-foreground/60">
										Ctrl+↑ to edit all queued messages
									</div>
								</div>
							</div>
						)}
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
					/* Issue #201: while streaming, the input stays enabled and
					   Enter/Alt+Enter route to steer/follow-up instead of starting
					   a fresh prompt. `disabled` is reserved for hard-blocks like
					   "no model selected" or "sidecar not ready". */
					streaming={isRunning}
					onSteer={onSteer}
					onFollowUp={onFollowUp}
					queue={queue}
					onEditQueue={onEditQueue}
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
