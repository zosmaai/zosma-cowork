"use client";
import { registerAbortHandler } from "@/hooks/useKeyboardShortcuts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BlockingExtensionUiRequest, SessionInfo, SessionTreeNode, UserMessage } from "@/lib/types";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { ZosmaLoadingState } from "./ZosmaLoadingState";
import { NoticeShelf } from "./NoticeShelf";
import { ExtensionDialog, ExtensionCustomPanel } from "./ExtensionOverlays";
import { ExtensionStatusBar, partitionExtensionWidgets } from "./ExtensionStatusBar";
import { SessionMetricsLine } from "./SessionMetricsLine";
import { ZosmaBrand } from "./ZosmaBrand";
import { Collapsible, MessageView } from "./MessageView";
import { useI18n } from "@/hooks/useI18n";
import { useAgentSession } from "@/hooks/useAgentSession";
import { useDragDrop } from "@/hooks/useDragDrop";
import { forwardDroppedImages } from "@/lib/conversation-flow";
import { getUserInputText } from "@/lib/chat-message-grouping";
import type { SessionStatsInfo } from "@/lib/pi-types";
import type { AgentMessage, AssistantContentBlock, AssistantMessage, BashExecutionMessage, ToolResultMessage } from "@/lib/types";
import { getAssistantErrorMessage, splitFinalAssistantBlocks } from "@/lib/message-display";
import { extractTurnWrittenFiles, type WrittenFile } from "@/lib/turn-written-files";
import {
  findFinalAssistantIndex,
  hasDisplayableProcessMessage,
  isGroupAnchor,
  phaseLabel,
  withAssistantBlocks,
} from "@/lib/chat-message-grouping";
import {
  captureScrollDistance,
  CHAT_SCROLL_TAIL_TOLERANCE,
  getNextVisibleCount,
  getVisibleRenderWindow,
  isScrollAtTail,
  restoreScrollTop,
  VISIBLE_PAGE_SIZE,
} from "@/lib/chat-lazy-load";
import type { StreamingState } from "@/lib/streaming-message";
import type { AgentPhase } from "@/hooks/agent-session-types";

/** Hero title rotation for brand-new sessions (empty composer). */
export const NEW_SESSION_TITLES = [
  "What’s on your mind?",
  "Let’s get started",
  "Bring an idea to life",
  "What can we create together?",
  "Start with an idea",
  "Your next idea starts here",
  "Let’s make something",
  "Ready when you are",
  "Turn thoughts into action",
  "A fresh start",
] as const;

export function pickNewSessionTitle(): string {
  return NEW_SESSION_TITLES[Math.floor(Math.random() * NEW_SESSION_TITLES.length)] ?? NEW_SESSION_TITLES[0];
}

interface Props {
  session: SessionInfo | null;
  sessionRunning?: boolean;
  newSessionCwd: string | null;
  newSessionDraftKey: string | null;
  /** Workspace context for the empty-composer header (rail owns the picker). */
  validatedProject?: unknown;
  currentProjectKey?: string | null;
  onComposerWorkspaceSelect?: (cwd: string, root: string, key: string) => void;
  onComposerAddFolder?: () => void;
  onAgentEnd?: () => void;
  onAttentionNeeded?: (request: BlockingExtensionUiRequest) => void;
  onSessionCreated?: (session: SessionInfo, sourceDraftKey: string) => void;
  onSessionForked?: (newSessionId: string) => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
  onSystemPromptLoaderChange?: (loader: (() => Promise<void>) | null) => void;
  onSessionStatsChange?: (stats: SessionStatsInfo | null) => void;
  onSessionStatsPanelOpen?: () => void;
  onContextUsageChange?: (usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => void;
  onOpenFile?: (filePath: string) => void;
  /** Open a settings pane from the hero (Plugins / Skills CTAs). */
  onOpenSettings?: (category: "models" | "plugins" | "skills") => void;
  /** Completion sound state + controls, owned by AppShell so tasks finishing in
   *  a non-active workspace can still ring. */
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
  playDoneSound?: () => void;
  unlockAudio?: () => void;
}

/**
 * The whole chat surface, rebuilt from scratch:
 *
 *  - ONE scroll container, mounted once. No hero/chat tree swap, no crossfade
 *    layers, no staged components — the hero and the message column are two
 *    branches of the same container. The composer below never moves.
 *  - The message column is a flat render pass: turn-group the entries, render
 *    each bubble, append the streaming tail. Memoized MessageViews skip
 *    re-renders on streaming deltas because committed messages keep identity.
 *  - Autoscroll: stick to the tail while at the bottom (streaming follow);
 *    lazy-load history upward via a sentinel + IntersectionObserver.
 */
export function ChatWindow({ session, sessionRunning, newSessionCwd, newSessionDraftKey, onAgentEnd, onAttentionNeeded, onSessionCreated, onSessionForked, modelsRefreshKey, chatInputRef, onBranchDataChange, onSystemPromptChange, onSystemPromptLoaderChange, onSessionStatsChange, onSessionStatsPanelOpen, onContextUsageChange, onOpenFile, onOpenSettings, soundEnabled = true, onSoundToggle, playDoneSound = () => {}, unlockAudio }: Props) {
  const { t } = useI18n();

  const newSessionTitleKey = session?.id ?? newSessionDraftKey ?? newSessionCwd ?? "new";
  const newSessionTitlesRef = useRef(new Map<string, string>());
  const [newSessionTitle, setNewSessionTitle] = useState<string>(NEW_SESSION_TITLES[0]);

  useEffect(() => {
    let title = newSessionTitlesRef.current.get(newSessionTitleKey);
    if (!title) {
      title = pickNewSessionTitle();
      newSessionTitlesRef.current.set(newSessionTitleKey, title);
    }
    setNewSessionTitle(title);
  }, [newSessionTitleKey]);

  // Completion sound on agent end (wrapped so the hook's internal ref sync
  // cannot clobber an externally installed handler).
  const playDoneSoundRef = useRef(playDoneSound);
  const soundEnabledRef = useRef(soundEnabled);
  useEffect(() => {
    playDoneSoundRef.current = playDoneSound;
    soundEnabledRef.current = soundEnabled;
  });
  const soundedExtensionDialogIdRef = useRef<string | null>(null);
  const wrappedOnAgentEnd = useCallback(() => {
    if (soundEnabledRef.current) {
      playDoneSoundRef.current();
    }
    onAgentEnd?.();
  }, [onAgentEnd]);

  const handleEditContent = useCallback((message: UserMessage) => {
    chatInputRef?.current?.replaceMessage(message);
  }, [chatInputRef]);

  const {
    loading, error, messages, entryIds, streamState,
    agentRunning, aborting, bashRunning, pendingBash, modelNames, modelList, modelError, modelScopeWarnings, modelThinkingLevels, modelThinkingLevelMaps, toolPreset, thinkingLevel,
    retryInfo, contextUsage, forkingEntryId,
    isCompacting, compactError, compactResult, displayModel: displayModelValue, modelSwitching, sessionStats,
    slashCommands, slashCommandsLoading, queuedMessages,
    notices, extensionDialog, extensionCustomUi, extensionStatuses, extensionWidgets, respondToExtensionUi, sendExtensionCustomInput,
    isAutoModelSelection,
    agentPhase,
    isNew,
    sessionIdRef, messagesEndRef, scrollContainerRef,
    handleSend, handleAbort, handleFork, handleNavigate, handleModelChange,
    handleCompact, handleSteer, handleFollowUp, handlePromptWithStreamingBehavior, handleAbortCompaction,
    sessionLost, resumeSession,
    handleRecallQueue,
    handleBuiltinSlashCommand,
    handleToolPresetChange, handleThinkingLevelChange, loadSlashCommands,
  } = useAgentSession({
    session, sessionRunning, newSessionCwd, newSessionDraftKey, onAgentEnd: wrappedOnAgentEnd, onAttentionNeeded, onSessionCreated, onSessionForked,
    modelsRefreshKey, chatInputRef, onBranchDataChange, onSystemPromptChange, onSystemPromptLoaderChange, onSessionStatsPanelOpen,
  });
  const sessionBusy = agentRunning || bashRunning;

  const extensionWidgetGroups = useMemo(
    () => partitionExtensionWidgets(extensionWidgets),
    [extensionWidgets],
  );

  useEffect(() => {
    if (!extensionDialog || soundedExtensionDialogIdRef.current === extensionDialog.id) return;
    soundedExtensionDialogIdRef.current = extensionDialog.id;
    playDoneSoundRef.current();
  }, [extensionDialog]);

  useEffect(() => {
    registerAbortHandler(sessionBusy ? handleAbort : null);
  }, [sessionBusy, handleAbort]);

  // Push stats/context up to AppShell; compare scalars to avoid loops.
  const statsKey = sessionStats
    ? [
      sessionStats.sessionId,
      sessionStats.sessionFile ?? "",
      sessionStats.sessionName ?? "",
      sessionStats.userMessages,
      sessionStats.assistantMessages,
      sessionStats.toolCalls,
      sessionStats.toolResults,
      sessionStats.totalMessages,
      sessionStats.tokens.input,
      sessionStats.tokens.output,
      sessionStats.tokens.cacheRead,
      sessionStats.tokens.cacheWrite,
      sessionStats.tokens.total,
      sessionStats.cost ?? 0,
      sessionStats.totalActiveMs ?? 0,
    ].join("|")
    : null;
  const sessionStatsRef = useRef(sessionStats);
  useEffect(() => {
    sessionStatsRef.current = sessionStats;
  });
  useEffect(() => {
    onSessionStatsChange?.(sessionStatsRef.current);
  }, [statsKey, onSessionStatsChange]);
  useEffect(() => () => { onSessionStatsChange?.(null); }, [onSessionStatsChange]);

  const ctxKey = contextUsage
    ? `${contextUsage.percent ?? "null"}|${contextUsage.contextWindow}|${contextUsage.tokens ?? "null"}`
    : null;
  const contextUsageRef = useRef(contextUsage);
  useEffect(() => {
    contextUsageRef.current = contextUsage;
  });
  useEffect(() => {
    onContextUsageChange?.(contextUsageRef.current);
  }, [ctxKey, onContextUsageChange]);
  useEffect(() => () => { onContextUsageChange?.(null); }, [onContextUsageChange]);

  const onDrop = useCallback((files: File[]) => {
    forwardDroppedImages(chatInputRef?.current, files);
  }, [chatInputRef]);
  const { handleDragEnter, handleDragOver, handleDragLeave, handleDrop } = useDragDrop(onDrop);

  const inputHistory = useMemo(() => {
    const seen = new Set<string>();
    const history: string[] = [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const text = getUserInputText(messages[i]);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      history.push(text);
      if (history.length >= 50) break;
    }
    return history.reverse();
  }, [messages]);

  const isEmptyNew = isNew && messages.length === 0 && !streamState.isStreaming && !sessionBusy;
  const messageCwd = session?.cwd ?? newSessionCwd ?? undefined;
  const sessionId = session?.id ?? sessionIdRef.current ?? undefined;

  const availableThinkingLevels = displayModelValue
    ? (modelThinkingLevels[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;
  const currentThinkingLevelMap = displayModelValue
    ? (modelThinkingLevelMaps[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const chatInputElement = (
    <ChatInput
      ref={chatInputRef}
      onSend={sessionLost ? () => {} : handleSend}
      onAbort={handleAbort}
      aborting={aborting}
      onSteer={agentRunning ? handleSteer : undefined}
      onFollowUp={agentRunning ? handleFollowUp : undefined}
      onPromptWithStreamingBehavior={agentRunning ? handlePromptWithStreamingBehavior : undefined}
      isStreaming={sessionBusy}
      isNewSession={isEmptyNew}
      model={displayModelValue}
      isAutoModelSelection={isAutoModelSelection}
      modelNames={modelNames}
      modelList={modelList}
      modelError={modelError}
      modelScopeWarnings={modelScopeWarnings}
      onModelChange={handleModelChange}
      modelSwitching={modelSwitching}
      onCompact={session || isNew ? handleCompact : undefined}
      onAbortCompaction={handleAbortCompaction}
      isCompacting={isCompacting}
      compactError={compactError}
      compactResult={compactResult}
      toolPreset={toolPreset}
      onToolPresetChange={session || isNew ? handleToolPresetChange : undefined}
      thinkingLevel={thinkingLevel}
      onThinkingLevelChange={session || isNew ? handleThinkingLevelChange : undefined}
      availableThinkingLevels={availableThinkingLevels}
      thinkingLevelMap={currentThinkingLevelMap}
      retryInfo={retryInfo}
      queuedMessages={queuedMessages}
      inputHistory={inputHistory}
      onRecallQueue={handleRecallQueue}
      slashCommands={slashCommands}
      slashCommandsLoading={slashCommandsLoading}
      onLoadSlashCommands={loadSlashCommands}
      onBuiltinCommand={handleBuiltinSlashCommand}
      soundEnabled={soundEnabled}
      onSoundToggle={onSoundToggle}
      onAudioUnlock={unlockAudio}
      draftKey={session?.id ?? newSessionDraftKey ?? undefined}
      cwd={session?.cwd ?? newSessionCwd}
    />
  );

  const sessionLostBanner = sessionLost ? (
    <div
      role="alert"
      className="mx-3 mb-2 flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-(--base-solid) px-3 py-1.5 text-xs text-(--text-dim)"
    >
      <span>Session lost — this session is no longer reachable.</span>
      <button
        type="button"
        onClick={() => { void resumeSession(); }}
        className="shrink-0 cursor-pointer rounded-md px-2.5 py-0.5 text-xs font-semibold"
      >
        Resume
      </button>
    </div>
  ) : null;

  if (loading) {
    return <ZosmaLoadingState label={t("chat.loadingSession")} />;
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-red-400">
        {error}
      </div>
    );
  }

  return (
    <div
      className={`relative flex h-full min-w-0 flex-col overflow-hidden${isEmptyNew ? " new-session-empty" : ""}`}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {extensionDialog && (
        <ExtensionDialog
          request={extensionDialog}
          onRespond={respondToExtensionUi}
        />
      )}

      {extensionCustomUi && (
        <ExtensionCustomPanel
          request={extensionCustomUi}
          onInput={sendExtensionCustomInput}
        />
      )}

      {/* Floating notices above the conversation; click-through to the stage. */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 0,
          right: 0,
          zIndex: 40,
          display: "flex",
          justifyContent: "center",
          padding: "0 16px",
          pointerEvents: "none",
        }}
      >
        <NoticeShelf notices={notices} floating />
      </div>

      {/* --- The conversation surface: one container, two branches --- */}
      <ConversationSurface
        isEmptyNew={isEmptyNew}
        newSessionTitle={newSessionTitle}
        newSessionCwd={newSessionCwd}
        messages={messages}
        entryIds={entryIds}
        streamState={streamState}
        sessionBusy={sessionBusy}
        agentRunning={agentRunning}
        agentPhase={agentPhase}
        bashRunning={bashRunning}
        pendingBash={pendingBash}
        isNew={isNew}
        forkingEntryId={forkingEntryId}
        onFork={handleFork}
        onNavigate={handleNavigate}
        onEditContent={handleEditContent}
        modelNames={modelNames}
        onOpenFile={onOpenFile}
        messageCwd={messageCwd}
        sessionId={sessionId}
        scrollContainerRef={scrollContainerRef}
        messagesEndRef={messagesEndRef}
        chatInputRef={chatInputRef}
        onOpenSettings={onOpenSettings}
      />

      <div className="relative">
        <ExtensionStatusBar statuses={[]} widgets={extensionWidgetGroups.aboveEditor} placement="aboveEditor" />
        {sessionLostBanner}
        {chatInputElement}
        <SessionMetricsLine stats={sessionStats} contextUsage={contextUsage} />
        <ExtensionStatusBar statuses={extensionStatuses} widgets={extensionWidgetGroups.belowEditor} placement="belowEditor" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Surface: hero (empty) or message column. One scroll container for the whole
// session lifetime — the ref never detaches, so scroll state survives the
// hero→chat transition and session switches.
// ---------------------------------------------------------------------------

interface SurfaceProps {
  isEmptyNew: boolean;
  newSessionTitle: string;
  newSessionCwd: string | null;
  messages: AgentMessage[];
  entryIds: (string | undefined)[];
  streamState: StreamingState;
  sessionBusy: boolean;
  agentRunning: boolean;
  agentPhase: AgentPhase;
  bashRunning: boolean;
  pendingBash: { command: string; excludeFromContext: boolean } | null;
  isNew: boolean;
  forkingEntryId: string | null;
  onFork: (entryId: string) => void;
  onNavigate: (entryId: string) => void;
  onEditContent: (message: UserMessage) => void;
  modelNames: Record<string, string>;
  onOpenFile?: (filePath: string) => void;
  messageCwd?: string;
  sessionId?: string | null;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onOpenSettings?: (category: "models" | "plugins" | "skills") => void;
}

function ConversationSurface({
  isEmptyNew, newSessionTitle, newSessionCwd, messages, entryIds, streamState,
  sessionBusy, agentRunning, agentPhase, bashRunning, pendingBash, isNew,
  forkingEntryId, onFork, onNavigate, onEditContent, modelNames, onOpenFile,
  messageCwd, sessionId, scrollContainerRef, messagesEndRef, chatInputRef,
  onOpenSettings,
}: SurfaceProps) {
  const [visibleCount, setVisibleCount] = useState(VISIBLE_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const prevScrollDistanceRef = useRef<number | null>(null);
  const stickToBottomRef = useRef(true);

  const onShowMore = useCallback(() => {
    setVisibleCount((prev) => getNextVisibleCount(prev));
  }, []);

  // Upward lazy-load: reveal an older page when the top sentinel is visible,
  // preserving the user's scroll distance (the list grows above the viewport).
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container || isEmptyNew) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          prevScrollDistanceRef.current = captureScrollDistance(container.scrollHeight, container.scrollTop);
          onShowMore();
        }
      },
      { root: container, threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [onShowMore, visibleCount, messages.length, scrollContainerRef, isEmptyNew]);

  useEffect(() => {
    if (prevScrollDistanceRef.current == null) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTop = restoreScrollTop(container.scrollHeight, prevScrollDistanceRef.current);
    prevScrollDistanceRef.current = null;
  }, [visibleCount, scrollContainerRef]);

  // Track whether the user is at the tail (autoscroll follow).
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const onScroll = () => {
      stickToBottomRef.current = isScrollAtTail(
        container.scrollTop,
        container.scrollHeight,
        container.clientHeight,
        CHAT_SCROLL_TAIL_TOLERANCE,
      );
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [scrollContainerRef]);

  // Follow the tail on new messages / streaming deltas while pinned to it.
  useEffect(() => {
    if (isEmptyNew) return;
    if (!stickToBottomRef.current) return;
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, streamState.streamingMessage, streamState.isStreaming, isEmptyNew, messagesEndRef]);

  // Stable Map so memoized MessageViews skip re-render on streaming updates.
  const toolResultsMap = useMemo(() => {
    const map = new Map<string, ToolResultMessage>();
    for (const msg of messages) {
      if (msg.role === "toolResult") {
        map.set((msg as ToolResultMessage).toolCallId, msg as ToolResultMessage);
      }
    }
    return map;
  }, [messages]);

  return (
    <div
      ref={scrollContainerRef}
      className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto scrollbar-none"
      style={{ scrollbarGutter: "stable" }}
    >
      {isEmptyNew ? (
        <HeroView
          title={newSessionTitle}
          cwd={newSessionCwd}
          onOpenSettings={onOpenSettings}
        />
      ) : (
        <MessageColumn
          messages={messages}
          entryIds={entryIds}
          streamState={streamState}
          sessionBusy={sessionBusy}
          agentRunning={agentRunning}
          agentPhase={agentPhase}
          bashRunning={bashRunning}
          pendingBash={pendingBash}
          isNew={isNew}
          forkingEntryId={forkingEntryId}
          onFork={onFork}
          onNavigate={onNavigate}
          onEditContent={onEditContent}
          modelNames={modelNames}
          onOpenFile={onOpenFile}
          messageCwd={messageCwd}
          sessionId={sessionId}
          toolResultsMap={toolResultsMap}
          messagesEndRef={messagesEndRef}
          sentinelRef={sentinelRef}
          visibleCount={visibleCount}
        />
      )}
    </div>
  );
}

/** Consumer-friendly one-liners under the Plugins / Skills hero CTAs. */
const HERO_PLUGINS_SUB = "Plugins & integrations";
const HERO_SKILLS_SUB = "Skills & workflows";

function HeroView({ title, cwd, onOpenSettings }: {
  title: string;
  cwd: string | null;
  onOpenSettings?: (category: "models" | "plugins" | "skills") => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 py-8">
      <div className="new-session-panel w-full" style={{ maxWidth: "var(--shell-composer-max-width)" }}>
        <div className="mx-auto flex max-w-140 flex-col items-center text-center">
          {/* Hero: brand mark + rotating title on one centered axis. */}
          <div className="flex items-center justify-center gap-3">
            <ZosmaBrand className="new-session-brand" />
            <span className="new-session-title-text">{title}</span>
          </div>

          {/* Workspace context chip — a quiet monospace path, centered. */}
          {cwd ? (
            <div className="mt-4 flex items-center gap-2 text-[12px] text-(--text-muted)">
              <span className="uppercase tracking-[0.4px] text-[10px] text-(--text-dim)">
                {t("sidebar.workspaces")}
              </span>
              <span className="max-w-[52ch] overflow-hidden text-ellipsis whitespace-nowrap font-mono text-(--text-dim)">
                {cwd}
              </span>
            </div>
          ) : null}

          {/* Capability CTAs: open the Plugins / Skills settings panes. */}
          <div
            className="new-session-suggestions mt-8 grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2"
            role="group"
            aria-label={`${t("common.plugins")} ${t("common.skills")}`}
          >
            <button
              type="button"
              className="new-session-suggestion"
              onClick={() => onOpenSettings?.("plugins")}
              aria-label={`${t("hero.addPower")} — ${HERO_PLUGINS_SUB}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 7V2" /><path d="M15 7V2" />
                <path d="M6 13V8a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v5a6 6 0 0 1-12 0Z" />
                <path d="M12 19v3" />
              </svg>
              <span className="min-w-0">
                <span className="block">{t("hero.addPower")}</span>
                <span className="block text-[12px] text-(--text-dim)">{HERO_PLUGINS_SUB}</span>
              </span>
            </button>
            <button
              type="button"
              className="new-session-suggestion"
              onClick={() => onOpenSettings?.("skills")}
              aria-label={`${t("hero.workflows")} — ${HERO_SKILLS_SUB}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
              <span className="min-w-0">
                <span className="block">{t("hero.workflows")}</span>
                <span className="block text-[12px] text-(--text-dim)">{HERO_SKILLS_SUB}</span>
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Parent fold for a single assistant turn's process (all thinking + tool
 * steps together, like GPT's collapsed "reasoning" block). Holds the child
 * thinking/tool folds; collapsed by default once the turn is committed so
 * the final answer reads as the primary result.
 */
function TurnProcessFold({ summary, count, children }: {
  summary: string;
  count: number;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="conversation-disclosure turn-process-fold" data-open={open || undefined}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="conversation-disclosure-trigger">
        <span className="conversation-disclosure-dot" aria-hidden="true" />
        <span className="conversation-disclosure-title">
          {summary}
        </span>
        <span className="conversation-disclosure-count">{count}</span>
        <span className="conversation-disclosure-chevron" aria-hidden="true">⌄</span>
        <span className="sr-only">{open ? t("chat.collapseProcess") : t("chat.expandProcess")}</span>
      </button>
      <Collapsible open={open}>
        <div className="turn-process-children">
          {children}
        </div>
      </Collapsible>
    </div>
  );
}

interface ColumnProps {
  messages: AgentMessage[];
  entryIds: (string | undefined)[];
  streamState: StreamingState;
  sessionBusy: boolean;
  agentRunning: boolean;
  agentPhase: AgentPhase;
  bashRunning: boolean;
  pendingBash: { command: string; excludeFromContext: boolean } | null;
  isNew: boolean;
  forkingEntryId: string | null;
  onFork: (entryId: string) => void;
  onNavigate: (entryId: string) => void;
  onEditContent: (message: UserMessage) => void;
  modelNames: Record<string, string>;
  onOpenFile?: (filePath: string) => void;
  messageCwd?: string;
  sessionId?: string | null;
  toolResultsMap: Map<string, ToolResultMessage>;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  sentinelRef: React.RefObject<HTMLDivElement | null>;
  visibleCount: number;
}

function MessageColumn({
  messages, entryIds, streamState, sessionBusy, agentRunning, agentPhase,
  bashRunning, pendingBash, isNew, forkingEntryId, onFork, onNavigate,
  onEditContent, modelNames, onOpenFile, messageCwd, sessionId, toolResultsMap,
  messagesEndRef, sentinelRef, visibleCount,
}: ColumnProps) {
  const { t } = useI18n();

  // Streaming tail: only render once a block holds visible content
  // (a *_start frame with an empty block would flash an empty container).
  const hasStreamingContent = Boolean(
    streamState.streamingMessage?.content.some((block) => {
      if (block.type === "text") return block.text.length > 0;
      if (block.type === "thinking") return block.thinking.length > 0;
      return true;
    }),
  );

  // Group anchors: the last user message or a compaction summary mid-turn.
  let lastAnchorIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isGroupAnchor(messages[i])) { lastAnchorIdx = i; break; }
  }

  const rendered: React.ReactNode[] = [];
  for (let idx = 0; idx < messages.length;) {
    const msg = messages[idx];
    if (!isGroupAnchor(msg)) {
      rendered.push(renderBubble(messages, idx, { entryIds, toolResultsMap, modelNames, messageCwd, onOpenFile, sessionId, sessionBusy, isNew, forkingEntryId, onFork, onNavigate, onEditContent, streamState }));
      idx += 1;
      continue;
    }

    const userIdx = idx;
    let endIdx = userIdx + 1;
    while (endIdx < messages.length && !isGroupAnchor(messages[endIdx])) endIdx += 1;

    const finalAssistantIdx = findFinalAssistantIndex(messages, userIdx, endIdx);

    if (finalAssistantIdx === -1) {
      for (let renderIdx = userIdx; renderIdx < endIdx; renderIdx++) {
        rendered.push(renderBubble(messages, renderIdx, { entryIds, toolResultsMap, modelNames, messageCwd, onOpenFile, sessionId, sessionBusy, isNew, forkingEntryId, onFork, onNavigate, onEditContent, streamState }));
      }
      idx = endIdx;
      continue;
    }

    // Live streaming turn: render everything plainly; the streamed tail
    // renders live below the committed entries.
    const isLiveTail = (sessionBusy || streamState.isStreaming) && endIdx === messages.length && userIdx === lastAnchorIdx;
    if (isLiveTail) {
      for (let renderIdx = userIdx; renderIdx < endIdx; renderIdx++) {
        rendered.push(renderBubble(messages, renderIdx, { entryIds, toolResultsMap, modelNames, messageCwd, onOpenFile, sessionId, sessionBusy, isNew, forkingEntryId, onFork, onNavigate, onEditContent, streamState }));
      }
      idx = endIdx;
      continue;
    }

    rendered.push(renderBubble(messages, userIdx, { entryIds, toolResultsMap, modelNames, messageCwd, onOpenFile, sessionId, sessionBusy, isNew, forkingEntryId, onFork, onNavigate, onEditContent, streamState }));

    const processIndices: number[] = [];
    for (let processIdx = userIdx + 1; processIdx < finalAssistantIdx; processIdx++) {
      processIndices.push(processIdx);
    }
    const visibleProcessIndices = processIndices.filter((processIdx) => hasDisplayableProcessMessage(messages[processIdx]));
    const finalAssistant = messages[finalAssistantIdx] as AssistantMessage;
    const finalSplit = splitFinalAssistantBlocks(finalAssistant);
    const finalProcessMessage = finalSplit.processBlocks.length > 0
      ? withAssistantBlocks(finalAssistant, finalSplit.processBlocks, { omitUsage: true })
      : null;
    const finalAnswerMessage = finalSplit.answerBlocks.length > 0 || getAssistantErrorMessage(finalAssistant)
      ? withAssistantBlocks(finalAssistant, finalSplit.answerBlocks)
      : null;

    const processBubbles: React.ReactNode[] = [];
    if (visibleProcessIndices.length > 0 || finalProcessMessage) {
      visibleProcessIndices.forEach((processIdx) => {
        processBubbles.push(renderBubble(messages, processIdx, { entryIds, toolResultsMap, modelNames, messageCwd, onOpenFile, sessionId, sessionBusy, isNew, forkingEntryId, onFork, onNavigate, onEditContent, streamState, keyPrefix: "process" }));
      });
      if (finalProcessMessage) {
        processBubbles.push(renderBubble(messages, finalAssistantIdx, {
          entryIds, toolResultsMap, modelNames, messageCwd, onOpenFile, sessionId, sessionBusy, isNew, forkingEntryId, onFork, onNavigate, onEditContent, streamState,
          keyPrefix: "process-final",
          messageOverride: finalProcessMessage,
          showTimestamp: false,
        }));
      }
    }

    if (processBubbles.length > 0) {
      const count = visibleProcessIndices.length + (finalProcessMessage ? 1 : 0);
      rendered.push(
        <TurnProcessFold
          key={`turn-process-${userIdx}`}
          summary={t("chat.turnProcess")}
          count={count}
        >
          {processBubbles}
        </TurnProcessFold>,
      );
    }

    if (finalAnswerMessage) {
      const turnContent: AssistantContentBlock[] = [];
      for (let i = userIdx + 1; i <= finalAssistantIdx; i++) {
        const m = messages[i];
        if (m?.role === "assistant") {
          for (const b of (m as AssistantMessage).content ?? []) turnContent.push(b);
        }
      }
      const writtenFiles = extractTurnWrittenFiles(turnContent, toolResultsMap, messageCwd);
      rendered.push(renderBubble(messages, finalAssistantIdx, {
        entryIds, toolResultsMap, modelNames, messageCwd, onOpenFile, sessionId, sessionBusy, isNew, forkingEntryId, onFork, onNavigate, onEditContent, streamState,
        messageOverride: finalAnswerMessage,
        writtenFiles,
      }));
    }
    for (let renderIdx = finalAssistantIdx + 1; renderIdx < endIdx; renderIdx++) {
      rendered.push(renderBubble(messages, renderIdx, { entryIds, toolResultsMap, modelNames, messageCwd, onOpenFile, sessionId, sessionBusy, isNew, forkingEntryId, onFork, onNavigate, onEditContent, streamState }));
    }
    idx = endIdx;
  }

  const { startIndex, hasMore } = getVisibleRenderWindow(rendered.length, visibleCount);

  return (
    <div
      className="conversation-column flex min-h-full min-w-0 flex-col pt-4"
      style={{
        width: "100%",
        maxWidth: "var(--shell-content-max-width)",
        margin: "0 auto",
      }}
    >
      <div className="min-w-0">
        {hasMore && (
          <div ref={sentinelRef} className="py-3 text-center text-xs text-text-muted">
            {t("chat.loadEarlier", { count: startIndex })}
          </div>
        )}
        {rendered.slice(startIndex)}
      </div>
      <div style={{ minWidth: 0, marginTop: "auto" }}>
        {streamState.streamingMessage && hasStreamingContent && (
          <MessageView
            message={streamState.streamingMessage as AgentMessage}
            isStreaming
            modelNames={modelNames}
            cwd={messageCwd}
            onOpenFile={onOpenFile}
          />
        )}

        {agentRunning && !hasStreamingContent && agentPhase && (
          <div className="conversation-status is-running wrap-break-word py-2 text-[13px] text-text-muted">
            <span>{phaseLabel(agentPhase, t)}</span>
          </div>
        )}

        {bashRunning && !pendingBash && (
          <div className="conversation-status is-running py-2 text-[13px] text-text-muted">
            <span>{t("chat.runningCommand")}</span>
          </div>
        )}

        {pendingBash && (
          <MessageView
            message={{
              role: "bashExecution",
              command: pendingBash.command,
              output: "",
              excludeFromContext: pendingBash.excludeFromContext,
            } as BashExecutionMessage}
            sessionId={sessionId ?? undefined}
          />
        )}

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}

interface BubbleOptions {
  entryIds: (string | undefined)[];
  toolResultsMap: Map<string, ToolResultMessage>;
  modelNames: Record<string, string>;
  messageCwd?: string;
  onOpenFile?: (filePath: string) => void;
  sessionId?: string | null;
  sessionBusy: boolean;
  isNew: boolean;
  forkingEntryId: string | null;
  onFork: (entryId: string) => void;
  onNavigate: (entryId: string) => void;
  onEditContent: (message: UserMessage) => void;
  streamState: StreamingState;
  keyPrefix?: string;
  messageOverride?: AgentMessage;
  showTimestamp?: boolean;
  writtenFiles?: WrittenFile[];
}

function renderBubble(messages: AgentMessage[], idx: number, opts: BubbleOptions): React.ReactNode {
  const {
    entryIds, toolResultsMap, modelNames, messageCwd, onOpenFile, sessionId,
    sessionBusy, isNew, forkingEntryId, onFork, onNavigate, onEditContent,
    streamState, keyPrefix = "message", messageOverride, showTimestamp: forcedShowTimestamp, writtenFiles,
  } = opts;
  const msg = messageOverride ?? messages[idx];
  const isVisible = msg.role === "user" || msg.role === "assistant";
  const prevAssistantEntryId =
    msg.role === "user" && idx > 0 && messages[idx - 1].role === "assistant"
      ? entryIds[idx - 1]
      : undefined;

  let showTimestamp = false;
  if (msg.role === "assistant") {
    showTimestamp = true;
    for (let j = idx + 1; j < messages.length; j++) {
      const r = messages[j].role;
      if (r === "user") break;
      if (r === "assistant") { showTimestamp = false; break; }
    }
    if (showTimestamp && streamState.isStreaming && idx === messages.length - 1) {
      showTimestamp = false;
    }
  }
  if (forcedShowTimestamp !== undefined) showTimestamp = forcedShowTimestamp;

  const view = (
    <MessageView
      key={`${keyPrefix}-view-${idx}`}
      message={msg}
      toolResults={toolResultsMap}
      modelNames={modelNames}
      cwd={messageCwd}
      onOpenFile={onOpenFile}
      entryId={entryIds[idx]}
      onFork={sessionBusy || isNew || (idx === 0 && msg.role === "user") ? undefined : onFork}
      forking={forkingEntryId === entryIds[idx]}
      onNavigate={sessionBusy ? undefined : onNavigate}
      prevAssistantEntryId={sessionBusy ? undefined : prevAssistantEntryId}
      onEditContent={onEditContent}
      showTimestamp={showTimestamp}
      prevTimestamp={idx > 0 ? (messages[idx - 1] as AgentMessage & { timestamp?: number }).timestamp : undefined}
      sessionId={sessionId ?? undefined}
      writtenFiles={writtenFiles}
    />
  );
  if (!isVisible) return view;
  return (
    <div key={`${keyPrefix}-${idx}`}>
      {view}
    </div>
  );
}