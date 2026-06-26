import { ChatMessageItem } from "@/components/ChatMessage";
import { ErrorBanner } from "@/components/ErrorBanner";
import { InThreadFind } from "@/components/InThreadFind";
import { MessageInput } from "@/components/MessageInput";
import { StatusLine } from "@/components/StatusLine";
import { useGreeting } from "@/hooks/useGreeting";
import type { ToolPhase } from "@/hooks/usePiStream";
import { findModel } from "@/lib/model-key";
import type { SessionStats, ThinkingState } from "@/lib/sessionStats";
import type { ChatMessage, ModelInfo } from "@/types";
import type { Command } from "@/types/commands";
import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
	/** #268 — session telemetry for the always-on status line. */
	sessionStats?: SessionStats | null;
	/** #268 — reasoning level slice (level + supported ladder). */
	thinking?: ThinkingState;
	/** #268 — cycle the reasoning effort from the status-line pill. */
	onCycleThinking?: () => void;
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
	sessionStats,
	thinking,
	onCycleThinking,
}: ChatViewProps) {
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<{ focus: () => void }>(null);
	const isUserScrolledUp = useRef(false);
	const [detailsExpanded, setDetailsExpanded] = useState(false);

	// ── In-thread find (Cmd/Ctrl+F) ──
	const [findOpen, setFindOpen] = useState(false);
	const [findQuery, setFindQuery] = useState("");
	const [activeMatch, setActiveMatch] = useState(0);
	const reducedScroll = useReducedMotion();
	const greeting = useGreeting();

	// Flat, top-to-bottom list of every match (one entry per occurrence).
	const findMatches = useMemo(() => {
		const q = findQuery.trim().toLowerCase();
		if (!findOpen || !q) return [] as Array<{ messageId: string; localIndex: number }>;
		const out: Array<{ messageId: string; localIndex: number }> = [];
		for (const m of messages) {
			const text = typeof m.content === "string" ? m.content.toLowerCase() : "";
			if (!text) continue;
			let from = 0;
			let local = 0;
			let at = text.indexOf(q, from);
			while (at !== -1) {
				out.push({ messageId: m.id, localIndex: local });
				local++;
				from = at + q.length;
				at = text.indexOf(q, from);
			}
		}
		return out;
	}, [messages, findQuery, findOpen]);

	// Reset to the first match whenever the query changes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on query change
	useEffect(() => {
		setActiveMatch(0);
	}, [findQuery]);

	// Keep the active pointer in range as matches shift.
	const safeActive = findMatches.length === 0 ? 0 : Math.min(activeMatch, findMatches.length - 1);
	const activeEntry = findMatches[safeActive];

	// Open find with Cmd/Ctrl+F.
	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
				e.preventDefault();
				setFindOpen(true);
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	// Close + clear find when switching sessions.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on session change
	useEffect(() => {
		setFindOpen(false);
		setFindQuery("");
		setActiveMatch(0);
	}, [sessionKey]);

	// Scroll the active match (or its message) into view.
	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll on active match change
	useEffect(() => {
		if (!findOpen || findMatches.length === 0 || !activeEntry) return;
		const container = scrollContainerRef.current;
		if (!container) return;
		const behavior: ScrollBehavior = reducedScroll ? "auto" : "smooth";
		const active = container.querySelector('[data-find-active="true"]');
		if (active) {
			active.scrollIntoView({ block: "center", behavior });
			return;
		}
		const esc =
			typeof CSS !== "undefined" && CSS.escape
				? CSS.escape(activeEntry.messageId)
				: activeEntry.messageId;
		const msgEl = container.querySelector(`[data-message-id="${esc}"]`);
		msgEl?.scrollIntoView({ block: "center", behavior });
	}, [safeActive, findMatches.length, findOpen]);

	const goNextMatch = useCallback(() => {
		setActiveMatch((i) => {
			const n = findMatches.length;
			return n === 0 ? 0 : (i + 1) % n;
		});
	}, [findMatches.length]);
	const goPrevMatch = useCallback(() => {
		setActiveMatch((i) => {
			const n = findMatches.length;
			return n === 0 ? 0 : (i - 1 + n) % n;
		});
	}, [findMatches.length]);
	const closeFind = useCallback(() => {
		setFindOpen(false);
		setFindQuery("");
	}, []);

	const findTerm = findOpen && findQuery.trim() ? findQuery.trim() : undefined;

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
		<div className="chat-font relative flex flex-col flex-1 min-h-0">
			<InThreadFind
				open={findOpen}
				query={findQuery}
				current={findMatches.length === 0 ? 0 : safeActive + 1}
				total={findMatches.length}
				onQueryChange={setFindQuery}
				onNext={goNextMatch}
				onPrev={goPrevMatch}
				onClose={closeFind}
			/>

			{/* #268 statusbar — pinned to the very top edge of the chat panel.
			    Active chat only: the empty state stays ultra-clean (decision C). */}
			{!isEmpty && thinking && (
				<StatusLine
					stats={sessionStats ?? null}
					thinking={thinking}
					modelName={findModel(models, currentModelId)?.name}
					onCycleThinking={onCycleThinking}
					isRunning={isRunning}
					status={status}
					streamingMessage={streamingMessage}
					toolPhase={toolPhase}
				/>
			)}

			<div
				ref={scrollContainerRef}
				onScroll={handleScroll}
				className="flex-1 overflow-y-auto"
				style={{ scrollbarGutter: "stable" }}
			>
				{!isEmpty && (
					<div className="pt-1 pb-6">
						{allMessages.map((msg) => {
							const isStreaming = msg.id === streamingMessage?.id;
							return (
								<ChatMessageItem
									key={msg.id}
									message={msg}
									detailsExpanded={detailsExpanded}
									models={models}
									findTerm={isStreaming ? undefined : findTerm}
									activeFindIndex={
										activeEntry && activeEntry.messageId === msg.id
											? activeEntry.localIndex
											: undefined
									}
								/>
							);
						})}
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
									className="ml-11 border-l-2 pl-4 py-1 space-y-1.5 text-sm border-border"
								>
									{queuedItems.map((item) => (
										<div
											key={item.key}
											className="relative text-muted-foreground/90 leading-relaxed"
										>
											{/* Tiny node-dot connecting each item to the thread line. */}
											<span
												className="absolute -left-[1.30rem] top-2 h-1.5 w-1.5 rounded-full bg-border"
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

			{/* AI greeting above the centered input — empty state only. No
			    animation: it simply appears with the empty state and is gone once a
			    message exists. min-h reserves the line so the static→AI swap-in
			    causes no layout jump. */}
			{isEmpty && (
				<div
					data-testid="greeting"
					className="mx-auto w-full max-w-3xl px-6 pb-3 text-center text-lg text-muted-foreground min-h-7"
				>
					{greeting}
				</div>
			)}

			{error && <ErrorBanner error={error} onRetry={onRetry} onSwitchModel={onRetry} />}

			{/* Single persistent MessageInput. Flex positions it: centered (empty,
			    via the bottom spacer) or pinned to the bottom (active). `layout=
			    "position"` smoothly slides it between the two over 500ms — position
			    only, so the composer's own height changes while typing are NOT
			    animated. Never remounted (key=sessionKey) so focus/draft survive. */}
			<motion.div
				layout={reducedScroll ? false : "position"}
				transition={{ layout: { duration: 0.5, ease: "easeInOut" } }}
				className="overflow-hidden"
			>
				<MessageInput
					key={sessionKey}
					ref={inputRef}
					onSend={onSend}
					/* Issue #201: while streaming, the input stays enabled and
					   Enter/Alt+Enter route to steer/follow-up instead of starting
					   a fresh prompt. `disabled` is reserved for hard-blocks like
					   "no model selected" or "sidecar not ready". */
					streaming={isRunning}
					/* Stop now lives in the composer (replaces the old StatusBar). */
					onAbort={onAbort}
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
			</motion.div>

			{/* Bottom spacer balances the (empty) scroll area above so the
			    greeting + input group sits vertically centered. Removed on first
			    message, which lets the input settle at the bottom. */}
			{isEmpty && <div className="flex-1" aria-hidden="true" />}
		</div>
	);
}
