"use client";

import { memo, useState, useRef, useEffect, useMemo, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { MarkdownBody } from "./MarkdownBody";
import { ImagePreview } from "./ImagePreview";
import { copyText } from "@/lib/clipboard";
import { getSessionThinking } from "@/lib/api-v1-client";
import { useI18n } from "@/hooks/useI18n";
import { parseCompactionSummary } from "@/lib/compaction-summary";
import { getAssistantErrorMessage, isEmptyThinkingBlock } from "@/lib/message-display";
import { parseUnifiedPatch, type SplitDiffCell } from "@/lib/patch";
import { isEditToolName } from "@/lib/tool-names";
import { firstUsefulLine, formatToolTitle, getToolCallState, getToolCategory, type ToolCategory } from "@/lib/conversation-flow";
import { TurnWrittenFiles } from "./TurnWrittenFiles";
import type { WrittenFile } from "@/lib/turn-written-files";
import { skillExpansionToCommand } from "@/lib/slash-display";
import { resolveLocalFileHref } from "@/lib/file-links";
import type {
  AgentMessage,
  UserMessage,
  AssistantMessage,
  CustomMessage,
  ToolResultMessage,
  BashExecutionMessage,
  AssistantContentBlock,
  TextContent,
  ImageContent,
  ToolCallContent,
  ThinkingContent,
} from "@/lib/types";

// CJK chars ~1 token each (GLM/DeepSeek/GPT-o200k); other chars ~4 chars/token.
const CJK_PATTERN = /[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\u{20000}-\u{2fa1f}\uac00-\ud7af]/u;
function estimateTokens(text: string): number {
  let cjk = 0;
  let rest = 0;
  for (const ch of text) {
    if (CJK_PATTERN.test(ch)) cjk++;
    else rest++;
  }
  return cjk + rest / 4;
}

interface TokenEstimateCacheEntry {
  text: string;
  tokens: number;
}

export function getTokenEstimateText(block: AssistantContentBlock): string | null {
  if (block.type === "text") return block.text;
  if (block.type === "thinking") return block.thinking;
  if (block.type === "toolCall") return block.rawInput ?? JSON.stringify(block.input ?? {}) ?? "";
  return null;
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

function estimateUpdatedTokens(previous: TokenEstimateCacheEntry | undefined, text: string): number {
  if (!previous || !text.startsWith(previous.text)) return estimateTokens(text);

  let baseTokens = previous.tokens;
  let suffixStart = previous.text.length;
  // A streamed delta can complete a surrogate pair that was counted as two
  // non-CJK code points in the previous update.
  if (
    suffixStart > 0
    && suffixStart < text.length
    && isHighSurrogate(previous.text.charCodeAt(suffixStart - 1))
    && isLowSurrogate(text.charCodeAt(suffixStart))
  ) {
    baseTokens -= 1 / 4;
    suffixStart--;
  }
  return baseTokens + estimateTokens(text.slice(suffixStart));
}

const MAX_THINKING_CACHE_ENTRIES = 100;
const thinkingContentCache = new Map<string, Promise<string>>();

// Messages larger than this skip markdown rendering entirely. react-markdown +
// KaTeX + syntax highlighting on multi-hundred-KB payloads (e.g. pasted HAR or
// log dumps) freezes the browser main thread.
const MAX_MARKDOWN_CHARS = 100_000;

function formatMessageBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} KB`;
  return `${n} B`;
}

/**
 * MarkdownBody with an oversized-content guard: huge messages render as a
 * click-to-reveal plain-text <pre> instead of running the markdown pipeline.
 */
function SafeMarkdownBody({ children, className, ...props }: React.ComponentProps<typeof MarkdownBody>) {
  const { t } = useI18n();
  const [showRaw, setShowRaw] = useState(false);

  if (children.length <= MAX_MARKDOWN_CHARS) {
    return <MarkdownBody className={className} {...props}>{children}</MarkdownBody>;
  }
  if (!showRaw) {
    return (
      <button
        onClick={() => setShowRaw(true)}
        className="block w-full my-1 mx-0 py-[7px] px-2.5 border border-(--border) rounded-md bg-(--bg-panel) text-(--text-muted) cursor-pointer text-xs text-left"
      >
        ⚠ {t("i18n.largeMessageReveal", { size: formatMessageBytes(children.length) })}
      </button>
    );
  }
  return (
    <div className={`${className} max-h-105 overflow-auto text-[12px] leading-[1.5]`}>
      <pre
        className="m-0 py-2 px-2.5 whitespace-pre-wrap break-words font-mono text-(--text-muted)"
      >
        {children}
      </pre>
    </div>
  );
}

// Cap the user "sent" bubble's height so an abnormally long message does not
// push the conversation off screen; overflow scrolls inside the bubble.

// Quiet 28px icon-only message action button (DeepSeek MessageIconActions
// spec: 28px circle, 15px glyph, tertiary -> secondary on a hover fill).
// Revealed on row hover; the accessible name rides an sr-only span.
const MESSAGE_ACTION_BTN =
  "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-transparent p-1.5 text-(--text-dim) transition-colors hover:bg-(--bg-hover) hover:text-(--text-muted)";

function loadThinkingContent(sessionId: string, entryId: string, blockIndex: number): Promise<string> {
  const key = `${sessionId}:${entryId}:${blockIndex}`;
  const cached = thinkingContentCache.get(key);
  if (cached) {
    thinkingContentCache.delete(key);
    thinkingContentCache.set(key, cached);
    return cached;
  }

  const request = getSessionThinking(sessionId, entryId, blockIndex)
    .then((data) => {
      if (typeof data.thinking !== "string") throw new Error("Invalid thinking response");
      return data.thinking;
    })
    .catch((error) => {
      thinkingContentCache.delete(key);
      throw error;
    });

  thinkingContentCache.set(key, request);
  if (thinkingContentCache.size > MAX_THINKING_CACHE_ENTRIES) {
    const oldestKey = thinkingContentCache.keys().next().value;
    if (oldestKey) thinkingContentCache.delete(oldestKey);
  }
  return request;
}

interface Props {
  message: AgentMessage;
  isStreaming?: boolean;
  toolResults?: Map<string, ToolResultMessage>;
  modelNames?: Record<string, string>;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  entryId?: string;
  onFork?: (entryId: string) => void;
  forking?: boolean;
  onNavigate?: (entryId: string) => void;
  prevAssistantEntryId?: string;
  onEditContent?: (message: UserMessage) => void;
  showTimestamp?: boolean;
  prevTimestamp?: number;
  sessionId?: string;
  /** Hide the model/provider label (used for process bubbles nested in the
   *  turn fold, so the turn shows the model name only once). */
  hideModelLabel?: boolean;
  /**
   * Files this turn wrote, derived by the caller from the whole turn's
   * successful write/edit tool calls. ChatWindow computes this because the
   * saved-message path splits tool calls into their own entries, leaving the
   * final answer text-only.
   */
  writtenFiles?: WrittenFile[];
}

export function resolveToolFilePath(block: ToolCallContent, cwd?: string): string | null {
  if (!cwd) return null;
  const rawPath = typeof block.input.path === "string"
    ? block.input.path
    : typeof block.input.file_path === "string"
      ? block.input.file_path
      : undefined;
  return resolveLocalFileHref(rawPath, cwd, cwd);
}

function formatTime(ts?: number): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return time;
  const date = d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
  return `${date} ${time}`;
}

export function replaceUserMessageText(message: UserMessage, text: string): UserMessage {
  if (typeof message.content === "string") return { ...message, content: text };

  const content: Array<TextContent | ImageContent> = [];
  let replaced = false;
  for (const block of message.content) {
    if (block.type !== "text") {
      content.push(block);
      continue;
    }
    if (!replaced) {
      content.push({ ...block, text });
      replaced = true;
    }
  }
  if (!replaced) content.unshift({ type: "text", text });
  return { ...message, content };
}

function haveSameRelevantToolResults(
  message: AgentMessage,
  previous: Map<string, ToolResultMessage> | undefined,
  next: Map<string, ToolResultMessage> | undefined,
): boolean {
  if (previous === next || message.role !== "assistant") return true;
  for (const block of (message as AssistantMessage).content ?? []) {
    if (block.type === "toolCall" && previous?.get(block.toolCallId) !== next?.get(block.toolCallId)) {
      return false;
    }
  }
  return true;
}

export const MessageView = memo(function MessageView({ message, isStreaming, toolResults, modelNames, cwd, onOpenFile, entryId, onFork, forking, onNavigate, prevAssistantEntryId, onEditContent, showTimestamp, prevTimestamp, sessionId, hideModelLabel, writtenFiles }: Props) {
  if (message.role === "user") {
    return <UserMessageView message={message as UserMessage} cwd={cwd} onOpenFile={onOpenFile} entryId={entryId} onFork={onFork} forking={forking} onNavigate={onNavigate} prevAssistantEntryId={prevAssistantEntryId} onEditContent={onEditContent} />;
  }
  if (message.role === "assistant") {
    return <AssistantMessageView message={message as AssistantMessage} isStreaming={isStreaming} toolResults={toolResults} modelNames={modelNames} cwd={cwd} onOpenFile={onOpenFile} showTimestamp={showTimestamp} prevTimestamp={prevTimestamp} sessionId={sessionId} entryId={entryId} hideModelLabel={hideModelLabel} writtenFiles={writtenFiles} />;
  }
  if (message.role === "toolResult") {
    // Rendered inline under its toolCall — skip standalone rendering if paired
    return null;
  }
  if (message.role === "custom") {
    if ((message as CustomMessage).customType === "compaction") {
      return <CompactionMessageView message={message as CustomMessage} />;
    }
    return <CustomMessageView message={message as CustomMessage} cwd={cwd} onOpenFile={onOpenFile} />;
  }
  if (message.role === "bashExecution") {
    return <BashExecutionView message={message as BashExecutionMessage} sessionId={sessionId} />;
  }
  return null;
}, (prev, next) => {
  return prev.message === next.message
    && prev.isStreaming === next.isStreaming
    && haveSameRelevantToolResults(prev.message, prev.toolResults, next.toolResults)
    && prev.modelNames === next.modelNames
    && prev.cwd === next.cwd
    && prev.onOpenFile === next.onOpenFile
    && prev.entryId === next.entryId
    && prev.onFork === next.onFork
    && prev.forking === next.forking
    && prev.onNavigate === next.onNavigate
    && prev.prevAssistantEntryId === next.prevAssistantEntryId
    && prev.hideModelLabel === next.hideModelLabel
    && prev.onEditContent === next.onEditContent
    && prev.showTimestamp === next.showTimestamp
    && prev.prevTimestamp === next.prevTimestamp
    && prev.sessionId === next.sessionId;
});

function UserMessageView({ message, cwd, onOpenFile, entryId, onFork, forking, onNavigate, prevAssistantEntryId, onEditContent }: {
  message: UserMessage;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  entryId?: string;
  onFork?: (entryId: string) => void;
  forking?: boolean;
  onNavigate?: (entryId: string) => void;
  prevAssistantEntryId?: string;
  onEditContent?: (message: UserMessage) => void;
}) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const content =
    typeof message.content === "string"
      ? message.content
      : message.content
          .filter((b): b is TextContent => b.type === "text")
          .map((b) => b.text)
          .join("\n");

  const imageBlocks: ImageContent[] =
    typeof message.content === "string"
      ? []
      : message.content.filter((b): b is ImageContent => b.type === "image");

  const commandText = skillExpansionToCommand(content);
  const commandSeparator = commandText?.search(/\s/) ?? -1;
  const commandName = commandText
    ? commandSeparator === -1 ? commandText : commandText.slice(0, commandSeparator)
    : "";
  const commandArgs = commandText && commandSeparator !== -1
    ? commandText.slice(commandSeparator + 1)
    : "";

  const time = formatTime(message.timestamp);
  const canFork = !!entryId && !!onFork;
  const copyTarget = commandText ?? content;
  const editTarget = commandText ? replaceUserMessageText(message, commandText) : message;

  const imageBlocksNode = imageBlocks.length > 0 && (
    <div className={`flex gap-1.5 flex-wrap ${content ? "mb-2" : "mb-0"}`}>
      {imageBlocks.map((img, i) => {
        // lib/types.ts ImageContent uses {source:{type,data,media_type,url}}
        // pi-ai on-disk format uses flat {data, mimeType} — handle both
        const flat = img as unknown as { data?: string; mimeType?: string };
        const src = img.source
          ? img.source.type === "base64"
            ? `data:${img.source.media_type};base64,${img.source.data}`
            : img.source.url ?? ""
          : flat.data
            ? `data:${flat.mimeType};base64,${flat.data}`
            : "";
        return (
          <ImagePreview key={i} src={src}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt=""
              className="block max-h-60 max-w-60 rounded-md border border-[rgba(59,130,246,0.15)] object-contain"
            />
          </ImagePreview>
        );
      })}
    </div>
  );
  const canNavigate = !!prevAssistantEntryId && !!onNavigate;

  const copyContent = () => {
    copyText(copyTarget).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="user-message flex flex-col items-end mb-4"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="user-message-stack flex items-end gap-2 max-w-[min(525px,82%)]">
        <div className="user-message-bubble min-w-0 box-border rounded-[22px] bg-(--user-bg) px-4 py-2.5 text-[14px] leading-[22px] text-(--text) break-words max-h-[300px] overflow-y-auto [&>div>p:first-child]:mt-0 [&>div>p:last-child]:mb-0">
          {commandText ? (
            <div className="flex flex-col gap-1.5 min-w-0">
              {imageBlocksNode}
              <div className="flex items-start gap-2 flex-wrap">
                <button
                  onClick={() => setExpanded((prev) => !prev)}
                  title={expanded ? t("i18n.collapse") : t("i18n.expand")}
                  aria-expanded={expanded}
                  className="flex items-center gap-1.5 shrink-0 p-0 bg-transparent border-none cursor-pointer text-(--accent) font-mono text-[13px] text-left"
                >
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                    {commandName}
                  </span>
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`shrink-0 opacity-75 transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}
                    aria-hidden="true"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {commandArgs && (
                  <span className="text-(--text) text-sm leading-[1.6] whitespace-pre-wrap break-words min-w-0 flex-1">
                    {commandArgs}
                  </span>
                )}
              </div>
              {expanded && (
                <MarkdownBody className="markdown-user-message" cwd={cwd} onOpenFile={onOpenFile}>{content}</MarkdownBody>
              )}
            </div>
          ) : (
          <>
          {imageBlocksNode}
          {content && <SafeMarkdownBody className="markdown-user-message" cwd={cwd} onOpenFile={onOpenFile}>{content}</SafeMarkdownBody>}
          </>
          )}
        </div>

      </div>

      {/* Bottom row: action buttons + timestamp */}
      {(time || canFork || canNavigate || true) && (
        <div className="message-actions user-message-actions mt-1.5 flex h-7 items-center justify-end gap-2">
          <div className={`message-actions flex items-center gap-2 transition-opacity duration-120 ${hovered ? "opacity-100" : "pointer-events-none opacity-0"}`}>
            <button
              onClick={copyContent}
               title={t("i18n.copyMessage")}
              className={`${MESSAGE_ACTION_BTN} ${copied ? "text-(--accent)" : ""}`}
            >
              {copied ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
              <span className="sr-only">{copied ? t("i18n.copied") : t("i18n.copy")}</span>
            </button>
          </div>
          {(canFork || canNavigate) && (
            <div className={`flex items-center gap-2 transition-opacity duration-120 ${(hovered || forking) ? "opacity-100" : "pointer-events-none opacity-0"}`}>
              {canNavigate && (
                <button
                  onClick={() => { onNavigate!(prevAssistantEntryId!); onEditContent?.(editTarget); }}
                   title={t("i18n.editFromHereTitle")}
                  className={MESSAGE_ACTION_BTN}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 10 20 15 15 20" />
                    <path d="M4 4v7a4 4 0 0 0 4 4h12" />
                  </svg>
                  <span className="sr-only">{t("i18n.editFromHere")}</span>
                </button>
              )}
              {canFork && (
                <button
                  onClick={() => { onFork!(entryId!); }}
                  disabled={forking}
                   title={forking ? t("i18n.creatingSession") : t("i18n.newSessionTitle")}
                  className={`${MESSAGE_ACTION_BTN} ${forking ? "cursor-not-allowed text-(--accent)" : ""}`}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="6" y1="3" x2="6" y2="15" />
                    <circle cx="18" cy="6" r="3" />
                    <circle cx="6" cy="18" r="3" />
                    <path d="M18 9a9 9 0 0 1-9 9" />
                  </svg>
                  <span className="sr-only">{forking ? t("i18n.creating") : t("i18n.newSession")}</span>
                </button>
              )}
            </div>
          )}
          {time && <span className="text-[13px] whitespace-nowrap text-(--text-dim)">{time}</span>}
        </div>
      )}
    </div>
  );
}

function AssistantMessageView({
  message,
  isStreaming,
  toolResults,
  modelNames,
  cwd,
  onOpenFile,
  showTimestamp,
  prevTimestamp,
  sessionId,
  entryId,
  hideModelLabel,
  writtenFiles,
}: {
  message: AssistantMessage;
  isStreaming?: boolean;
  toolResults?: Map<string, ToolResultMessage>;
  modelNames?: Record<string, string>;
  cwd?: string;
  onOpenFile?: (filePath: string) => void;
  showTimestamp?: boolean;
  prevTimestamp?: number;
  sessionId?: string;
  entryId?: string;
  hideModelLabel?: boolean;
  writtenFiles?: WrittenFile[];
}) {
  const { t } = useI18n();
  const time = showTimestamp ? formatTime(message.timestamp) : null;
  const blockItems = useMemo(() => (message.content ?? [])
    .map((block, originalIndex) => ({ block, originalIndex }))
    .filter(({ block }) => !isEmptyThinkingBlock(block, { isStreaming })), [message.content, isStreaming]);
  const blocks = useMemo(() => blockItems.map(({ block }) => block), [blockItems]);
  const providerError = getAssistantErrorMessage(message, { isStreaming });
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const streamStartRef = useRef<number | null>(null);
  const [tps, setTps] = useState<number | null>(null);
  const blockItemsRef = useRef(blockItems);
  useEffect(() => {
    blockItemsRef.current = blockItems;
  });
  const tokenEstimateCacheRef = useRef<Map<number, TokenEstimateCacheEntry>>(new Map());
  const estimatedTokens = useMemo(() => {
    if (!isStreaming) {
      tokenEstimateCacheRef.current = new Map();
      return 0;
    }
    const nextCache = new Map<number, TokenEstimateCacheEntry>();
    let total = 0;
    for (const { block, originalIndex } of blockItems) {
      const text = getTokenEstimateText(block);
      if (text === null) continue;
      const tokens = estimateUpdatedTokens(tokenEstimateCacheRef.current.get(originalIndex), text);
      nextCache.set(originalIndex, { text, tokens });
      total += tokens;
    }
    tokenEstimateCacheRef.current = nextCache;
    return total;
  }, [blockItems, isStreaming]);
  const estimatedTokensRef = useRef(estimatedTokens);
  useEffect(() => {
    estimatedTokensRef.current = estimatedTokens;
  });

  // Streaming-based timing for thinking blocks
  const blockStartTimesRef = useRef<Map<number, number>>(new Map());
  const [streamingDurations, setStreamingDurations] = useState<Map<number, number>>(new Map());

  // Thinking duration derived from file timestamps: time from prev message end to this message end
  // This is the total generation time (thinking + any text before first tool call)
  const thinkingDurationFromFile = useMemo<number | undefined>(() => {
    if (!message.timestamp || !prevTimestamp) return undefined;
    const secs = Math.round((message.timestamp - prevTimestamp) / 1000);
    return secs > 0 ? secs : undefined;
  }, [message.timestamp, prevTimestamp]);

  // Tool call durations derived from session file timestamps (accurate for completed messages)
  // assistant message timestamp = when generation ended = when tools started running
  // toolResult timestamp = when tool execution finished
  const toolCallDurations = useMemo<Map<string, number>>(() => {
    const map = new Map<string, number>();
    if (!toolResults || !message.timestamp) return map;
    for (const [callId, result] of toolResults) {
      if (result.timestamp && message.timestamp) {
        const secs = Math.round((result.timestamp - message.timestamp) / 1000);
        if (secs > 0) map.set(callId, secs);
      }
    }
    return map;
  }, [toolResults, message.timestamp]);

  const textContent = blocks
    .filter((b): b is TextContent => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const copyContent = () => {
    copyText(textContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  useEffect(() => {
    if (!isStreaming) {
      // Finalise any un-finished thinking block durations on stream end
      const now = new Date().getTime();
      setStreamingDurations((prev: Map<number, number>) => {
        const next = new Map(prev);
        for (const [idx, start] of blockStartTimesRef.current) {
          if (!next.has(idx)) next.set(idx, Math.round((now - start) / 1000));
        }
        return next;
      });
      streamStartRef.current = null;
      setTps(null);
      return;
    }
    const tick = () => {
      const items = blockItemsRef.current;
      const now = Date.now();

      // Record start time for each block the first time we see it
      items.forEach(({ originalIndex }) => {
        if (!blockStartTimesRef.current.has(originalIndex)) blockStartTimesRef.current.set(originalIndex, now);
      });

      // When a non-last block has a successor already started, finalise its duration
      setStreamingDurations((prev: Map<number, number>) => {
        let changed = false;
        const next = new Map(prev);
        for (let i = 0; i < items.length - 1; i++) {
          const originalIndex = items[i].originalIndex;
          const nextOriginalIndex = items[i + 1].originalIndex;
          if (!next.has(originalIndex) && blockStartTimesRef.current.has(originalIndex)) {
            const start = blockStartTimesRef.current.get(originalIndex)!;
            const nextStart = blockStartTimesRef.current.get(nextOriginalIndex) ?? now;
            next.set(originalIndex, Math.round((nextStart - start) / 1000));
            changed = true;
          }
        }
        return changed ? next : prev;
      });

      const tokens = estimatedTokensRef.current;
      if (tokens === 0) return;
      if (streamStartRef.current === null) streamStartRef.current = now;
      const elapsed = (now - streamStartRef.current) / 1000;
      if (elapsed > 0.5) setTps(tokens / elapsed);
    };
    const id = setInterval(tick, 300);
    return () => clearInterval(id);
  }, [isStreaming]);

  if (blocks.length === 0 && !isStreaming && !providerError) return null;

  return (
    <div
      className="assistant-message mb-4"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Model label */}
      {!hideModelLabel && (
      <div
        className="text-[11px] text-(--text-dim) mb-1 flex items-center gap-1.5"
      >
        {message.provider && (
          <span>{modelNames?.[`${message.provider}:${message.model}`] ?? modelNames?.[message.model] ?? message.model}</span>
        )}
        {isStreaming && (() => {
          const est = Math.round(estimatedTokens);
          return (
            <>

              {est > 0 && (
                <span className="flex items-center gap-1 text-(--text)" title={t("i18n.estimatedTokens")}>
                  <span className="flex items-center gap-0.5 text-[11px]">
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="1.5" x2="5" y2="8.5" /><polyline points="2 6 5 8.5 8 6" />
                    </svg>
                    {est}
                  </span>
                  {tps !== null && (() => {
                    const tone =
                      tps >= 50 ? "bg-[#53b3cb]" :
                      tps >= 30 ? "bg-[#9bc53d]" :
                      tps >= 15 ? "bg-[#f9c22e]" :
                      "bg-[#e01a4f]";
                    return (
                      <span className={`ml-1.5 rounded-[4px] px-1.5 py-px text-[11px] font-normal text-white ${tone}`}>
                        {tps.toFixed(1)} t/s
                      </span>
                    );
                  })()}
                </span>
              )}
            </>
          );
        })()}
      </div>
      )}

      <div className="assistant-message-blocks flex flex-col gap-2">
        {blockItems.map(({ block, originalIndex }, itemPosition) => (
          <BlockView key={`${entryId ?? "stream"}-${originalIndex}`} block={block} toolResults={toolResults} isStreaming={isStreaming} isActive={Boolean(isStreaming && itemPosition === blockItems.length - 1)} streamingDuration={streamingDurations.get(originalIndex) ?? (block.type === "thinking" ? thinkingDurationFromFile : undefined)} toolCallDurations={toolCallDurations} cwd={cwd} onOpenFile={onOpenFile} sessionId={sessionId} entryId={entryId} blockIndex={originalIndex} />
        ))}
      </div>

      {providerError && (
        <div
          className={`assistant-error rounded-md border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.07)] px-2.5 py-[7px] font-mono text-[12px] leading-[1.5] whitespace-pre-wrap [overflow-wrap:anywhere] text-(--state-error) ${blocks.length > 0 ? "mt-2" : "mt-0"}`}
          role="alert"
        >
          Error: {providerError}
        </div>
      )}

      {writtenFiles && writtenFiles.length > 0 && (
        <TurnWrittenFiles files={writtenFiles} onOpenFile={onOpenFile} />
      )}

      <div className="message-actions assistant-message-actions mt-1 flex h-7 items-center gap-2">
        {message.usage && !isStreaming && (
          <div className="text-[13px] text-(--text-dim)">
            {formatUsage(message.usage)}
          </div>
        )}
        {textContent && !isStreaming && (
          <button
            onClick={copyContent}
             title={t("i18n.copyMessage")}
            className={`${MESSAGE_ACTION_BTN} ${hovered ? "opacity-100" : "pointer-events-none opacity-0"} ${copied ? "text-(--accent)" : ""}`}
          >
            {copied ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
            <span className="sr-only">{copied ? t("i18n.copied") : t("i18n.copy")}</span>
          </button>
        )}
        {time && !isStreaming && (
          <span className="ml-auto text-[13px] whitespace-nowrap text-(--text-dim)">{time}</span>
        )}
      </div>
    </div>
  );
}

/** Smooth open/close for thinking + tool detail sections. Fade+silde (not a
 *  height collapse) so streaming tool input can grow without clipping, and
 *  streamed input stays out of the DOM while collapsed (AnimatePresence drops
 *  it on exit). */
export function Collapsible({ open, children }: { open: boolean; children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const sequence = reduceMotion
    ? { duration: 0 }
    : { duration: 0.2, ease: [0.4, 0, 0.2, 1] } as const;
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={sequence}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ToolCategoryIcon({ category, active }: { category: ToolCategory; active?: boolean }) {
  const size = 16;
  const glyph = () => {
    switch (category) {
      case "search":
        return (<><circle cx="11" cy="11" r="6.5" /><line x1="16" y1="16" x2="21" y2="21" /></>);
      case "terminal":
        return (<><path d="M4 7l4 5-4 5" /><line x1="12" y1="17" x2="20" y2="17" /></>);
      case "file":
        return (<><path d="M7 3h7l5 5v13H7z" /><path d="M10 12h6M10 16h6" /></>);
      case "skill":
        return (<><path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" /><circle cx="12" cy="12" r="2.5" /></>);
      case "chat":
        return (<><path d="M4 5h16v11H9l-4 4z" /></>);
      default:
        return (<><circle cx="6" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="18" cy="12" r="1.6" /></>);
    }
  };
  return (
    <span
      className={active ? "conversation-disclosure-icon conversation-disclosure-icon-active" : "conversation-disclosure-icon"}
      aria-hidden="true"
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        {glyph()}
      </svg>
    </span>
  );
}

function BlockView({ block, toolResults, isStreaming, isActive = false, streamingDuration, toolCallDurations, cwd, onOpenFile, sessionId, entryId, blockIndex }: { block: AssistantContentBlock; toolResults?: Map<string, ToolResultMessage>; isStreaming?: boolean; isActive?: boolean; streamingDuration?: number; toolCallDurations?: Map<string, number>; cwd?: string; onOpenFile?: (filePath: string) => void; sessionId?: string; entryId?: string; blockIndex: number }) {
  if (block.type === "text") {
    return <TextBlock block={block as TextContent} isStreaming={isStreaming} cwd={cwd} onOpenFile={onOpenFile} />;
  }
  if (block.type === "thinking") {
    return <ThinkingBlock block={block as ThinkingContent} running={Boolean(isActive)} active={Boolean(isActive)} duration={streamingDuration} sessionId={sessionId} entryId={entryId} blockIndex={blockIndex} />;
  }
  if (block.type === "toolCall") {
    const tc = block as ToolCallContent;
    const result = toolResults?.get(tc.toolCallId);
    const duration = toolCallDurations?.get(tc.toolCallId);
    return <ToolCallBlock block={tc} result={result} running={Boolean(isActive)} active={Boolean(isActive)} duration={duration} cwd={cwd} onOpenFile={onOpenFile} />;
  }
  return null;
}

function TextBlock({ block, isStreaming, cwd, onOpenFile }: { block: TextContent; isStreaming?: boolean; cwd?: string; onOpenFile?: (filePath: string) => void }) {
  return <SafeMarkdownBody className="markdown-assistant-message" isStreaming={isStreaming} cwd={cwd} onOpenFile={onOpenFile}>{block.text}</SafeMarkdownBody>;
}

function ThinkingBlock({ block, running, active, duration, sessionId, entryId, blockIndex }: {
  block: ThinkingContent;
  running: boolean;
  active: boolean;
  duration?: number;
  sessionId?: string;
  entryId?: string;
  blockIndex: number;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(running);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const body = loading
    ? t("i18n.loadingThinking")
    : error
      ? error
      : block.deferred
        ? content ?? ""
        : block.thinking;

  useEffect(() => setExpanded(Boolean(running)), [running]);

  const toggle = async () => {
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (!nextExpanded || !block.deferred || content !== null) return;
    if (!sessionId || !entryId) {
      setError(t("i18n.thinkingUnavailable"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setContent(await loadThinkingContent(sessionId, entryId, blockIndex));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const status = running ? t("chat.thinkingRunning") : t("chat.thinkingComplete");
  return (
    <div className="conversation-disclosure thinking-row" data-state={running ? "running" : "complete"} data-active={active ? "true" : "false"}>
      <button type="button" onClick={() => void toggle()} aria-expanded={expanded} className="conversation-disclosure-trigger">
        <span className="conversation-disclosure-dot" aria-hidden="true" />
        <span className="conversation-disclosure-title">{t("i18n.thinking")}</span>
        <span className="conversation-disclosure-summary">{status}</span>
        {duration !== undefined && <span className="conversation-disclosure-duration">{duration}s</span>}
        <span className="conversation-disclosure-chevron" aria-hidden="true">⌄</span>
        <span className="sr-only">{status}</span>
      </button>
      <Collapsible open={expanded}>
        <div className={`thinking-detail${error ? " is-error" : ""}`}>{body}</div>
      </Collapsible>
    </div>
  );
}


function ToolCallBlock({ block, result, running, active, duration, cwd, onOpenFile }: { block: ToolCallContent; result?: ToolResultMessage; running: boolean; active: boolean; duration?: number; cwd?: string; onOpenFile?: (filePath: string) => void }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const inputStr = getToolCallInputText(block);
  const isStreamingInput = block.rawInput !== undefined;
  const isEditTool = isEditToolName(block.toolName);
  const toolFilePath = resolveToolFilePath(block, cwd);
  const resultDiff = result && !result.isError ? getResultDiff(result) : null;
  const resultText = result
    ? result.content.filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text).join("\n")
    : null;
  const resultIsEmpty = resultText === null ? false : (resultText.trim() === "(no output)" || resultText.trim() === "");
  const state = getToolCallState(result, Boolean(active));
  const title = formatToolTitle(block.toolName);
  const preview = state === "error"
    ? firstUsefulLine(resultText ?? "") || getToolPreview(block)
    : state === "running" && isStreamingInput
      ? t("chat.generatingToolInput")
      : getToolPreview(block);
  const stateText = state === "running"
    ? t("chat.toolRunning", { name: title })
    : state === "success"
      ? t("chat.toolSucceeded", { name: title })
      : state === "error"
        ? t("chat.toolFailed", { name: title })
        : t("chat.toolInterrupted", { name: title });

  return (
    <div className={`conversation-disclosure tool-row tool-row-${state}`} data-state={state} data-running={running ? "true" : "false"}>
      <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} className="conversation-disclosure-trigger">
        <ToolCategoryIcon category={getToolCategory(block.toolName)} active={active} />
        <span className="conversation-disclosure-title">{title}</span>
        <span className="conversation-disclosure-summary">{preview}</span>
        {duration !== undefined && <span className="conversation-disclosure-duration">{duration}s</span>}
        <span className="conversation-disclosure-chevron" aria-hidden="true">⌄</span>
        <span className="sr-only">{stateText}</span>
      </button>
      <Collapsible open={expanded}>
        {toolFilePath && onOpenFile && (
          <button
            type="button"
            className="tool-file-link"
            title={toolFilePath}
            onClick={() => onOpenFile?.(toolFilePath)}
          >
            {toolFilePath.split(/[\\/]/).pop() || toolFilePath}
          </button>
        )}
        {(isStreamingInput || !isEditTool) && <div className="tool-detail-input"><span className="tool-detail-label">{t("chat.toolInput")}</span><pre className="tool-detail-input-text">{inputStr}</pre></div>}
        {result && (
          resultDiff
            ? <PairedDiffResult diff={resultDiff} />
            : <PairedResult text={resultText ?? ""} isEmpty={resultIsEmpty} isError={state === "error"} />
        )}
      </Collapsible>
    </div>
  );
}

interface ResultDiff {
  text: string;
}

function PairedDiffResult({ diff }: { diff: ResultDiff }) {
  const { t } = useI18n();
  return <div className="tool-detail-output"><span className="tool-detail-label">{t("chat.toolOutput")}</span><SplitPatchView text={diff.text} /></div>;
}

function SplitPatchView({ text }: { text: string }) {
  const { t } = useI18n();
  const files = useMemo(() => parseUnifiedPatch(text), [text]);
  if (!files) return <PatchTextView text={text} />;
  const showFileHeaders = files.length > 1;

  return (
    <div className="max-h-[560px] overflow-x-hidden overflow-y-auto bg-(--bg)">
      {files.map((file, fileIndex) => (
        <div
          key={fileIndex}
          className={`min-w-0 font-mono text-[12px] leading-[1.55] ${fileIndex === 0 ? "border-t-0" : "border-t border-t-(--border)"}`}
        >
          {showFileHeaders && (
            <div
              className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] border-b border-(--border) bg-(--bg-panel)"
            >
               <SplitDiffHeader title={file.oldPath || t("i18n.before")} side="left" />
               <SplitDiffHeader title={file.newPath || t("i18n.after")} side="right" />
            </div>
          )}

          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            {file.rows.map((row, rowIndex) => {
              if (row.type === "hunk") {
                return null;
              }

              return (
                <div key={rowIndex} className="contents">
                  <SplitDiffCellView cell={row.left} side="left" />
                  <SplitDiffCellView cell={row.right} side="right" />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function SplitDiffHeader({ title, side }: { title: string; side: "left" | "right" }) {
  return (
    <div
      title={title}
      className={`py-[5px] px-2.5 text-(--text-dim) overflow-hidden text-ellipsis whitespace-nowrap ${side === "left" ? "border-r border-(--border)" : "border-r-0"}`}
    >
      {title}
    </div>
  );
}

function SplitDiffCellView({ cell, side }: { cell: SplitDiffCell; side: "left" | "right" }) {
  const bg =
    cell.type === "added"
      ? "bg-[rgba(34,197,94,0.12)]"
      : cell.type === "removed"
      ? "bg-[rgba(248,113,113,0.13)]"
      : cell.type === "empty"
      ? "bg-(--bg-subtle)"
      : "bg-transparent";
  const marker =
    cell.type === "added" ? "+" : cell.type === "removed" ? "-" : " ";
  const markerColor =
    cell.type === "added" ? "text-(--state-success)" : cell.type === "removed" ? "text-[#f87171]" : "text-(--text-dim)";

  return (
    <div className={`flex min-w-0 ${bg} ${side === "left" ? "border-r border-r-(--border)" : "border-r-0"}`}>
      <span className="w-[42px] shrink-0 border-r border-r-(--border) bg-(--bg-panel) px-1.5 text-right text-(--text-dim) select-none">
        {cell.lineNo ?? ""}
      </span>
      <span
        className={`w-[18px] shrink-0 px-[5px] select-none ${markerColor} ${cell.type === "context" || cell.type === "empty" ? "font-normal" : "font-bold"}`}
      >
        {marker}
      </span>
      <span
        className={`flex-1 min-w-0 py-0 pr-2.5 pl-0 whitespace-pre-wrap [overflow-wrap:anywhere] ${cell.type === "empty" ? "text-(--text-dim)" : "text-(--text)"}`}
      >
        {cell.text || "\u00a0"}
      </span>
    </div>
  );
}

function PatchTextView({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);

  return (
    <div className="max-h-[520px] min-w-0 overflow-x-hidden overflow-y-auto font-mono text-[12px] leading-[1.55]">
      {lines.map((line, i) => {
        const kind =
          line.startsWith("@@") ? "hunk" :
          line.startsWith("+") && !line.startsWith("+++") ? "added" :
          line.startsWith("-") && !line.startsWith("---") ? "removed" :
          "context";
        const bg =
          kind === "added" ? "bg-[rgba(34,197,94,0.12)]" :
          kind === "removed" ? "bg-[rgba(248,113,113,0.13)]" :
          kind === "hunk" ? "bg-[rgba(96,165,250,0.12)]" :
          "bg-transparent";
        const color =
          kind === "added" ? "text-(--state-success)" :
          kind === "removed" ? "text-[#f87171]" :
          kind === "hunk" ? "text-(--accent)" :
          "text-(--text)";
        const edge =
          kind === "added" ? "border-l-[3px] border-l-(--state-success)" :
          kind === "removed" ? "border-l-[3px] border-l-[#f87171]" :
          kind === "hunk" ? "border-l-[3px] border-l-(--accent)" :
          "border-l-[3px] border-l-transparent";

        return (
          <div key={i} className={`flex ${bg} ${edge}`}>
            <span className="w-12 shrink-0 border-r border-r-(--border) bg-(--bg-panel) px-2 text-right text-(--text-dim) select-none">
              {i + 1}
            </span>
            <span className={`px-2.5 whitespace-pre-wrap [overflow-wrap:anywhere] ${color}`}>
              {line || "\u00a0"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function getResultDiff(result: ToolResultMessage): ResultDiff | null {
  const details = (result as ToolResultMessage & { details?: unknown }).details;
  if (!isRecord(details)) return null;

  const patch = typeof details.patch === "string" ? details.patch : null;
  if (patch) return { text: patch };

  const diff = typeof details.diff === "string" ? details.diff : null;
  if (diff) return { text: diff };

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function PairedResult({ text, isEmpty, isError }: {
  text: string;
  isEmpty: boolean;
  isError: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="tool-detail-output">
      <span className="tool-detail-label">{t("chat.toolOutput")}</span>
      <pre className={`tool-detail-output-text${isError ? " is-error" : ""}`}>
        {isEmpty ? t("i18n.noOutput") : text}
      </pre>
    </div>
  );
}

function CompactionMessageView({ message }: { message: CustomMessage }) {
  const { t } = useI18n();
  const summary = getMessageText(message.content);
  const parsedSummary = useMemo(() => parseCompactionSummary(summary), [summary]);
  const time = formatTime(message.timestamp);

  return (
    <details className="compaction-marker">
      <summary className="conversation-disclosure-trigger">
        <span className="conversation-disclosure-dot" aria-hidden="true" />
        <span className="conversation-disclosure-title">compaction</span>
        <span className="conversation-disclosure-summary">{t("i18n.conversationCompacted")}</span>
        {time && <span className="conversation-disclosure-duration">{time}</span>}
        <span className="conversation-disclosure-chevron" aria-hidden="true">⌄</span>
      </summary>
      <div className="compaction-detail">
        <div className="compaction-summary-title">{t("i18n.conversationCompacted")}</div>
        <div className="compaction-summary-description">{t("i18n.compactionDescription")}</div>
        {parsedSummary.body ? (
          <MarkdownBody className="markdown-compaction-message">{parsedSummary.body}</MarkdownBody>
        ) : (
          <span className="compaction-empty-summary">{t("i18n.noSummary")}</span>
        )}
        <CompactionFileMetadata readFiles={parsedSummary.readFiles} modifiedFiles={parsedSummary.modifiedFiles} />
      </div>
    </details>
  );
}

function CompactionFileMetadata({ readFiles, modifiedFiles }: { readFiles: string[]; modifiedFiles: string[] }) {
  const { t } = useI18n();
  const total = readFiles.length + modifiedFiles.length;
  if (total === 0) return null;

  const parts = [];
  if (readFiles.length > 0) parts.push(`${readFiles.length} read`);
  if (modifiedFiles.length > 0) parts.push(`${modifiedFiles.length} modified`);

  return (
    <details className="compaction-file-details">
       <summary>{t("i18n.fileContext", { details: parts.join(", ") })}</summary>
       {modifiedFiles.length > 0 && <CompactionFileList title={t("i18n.modifiedFiles")} files={modifiedFiles} />}
       {readFiles.length > 0 && <CompactionFileList title={t("i18n.readFiles")} files={readFiles} />}
    </details>
  );
}

function CompactionFileList({ title, files }: { title: string; files: string[] }) {
  return (
    <div className="compaction-file-section">
      <div className="compaction-file-title">{title}</div>
      <ul className="compaction-file-list">
        {files.map((file) => (
          <li key={file}>{file}</li>
        ))}
      </ul>
    </div>
  );
}

function CustomMessageView({ message, cwd, onOpenFile }: { message: CustomMessage; cwd?: string; onOpenFile?: (filePath: string) => void }) {
  const { t } = useI18n();
  const isHiddenDisplay = message.display === false;
  const [contentExpanded, setContentExpanded] = useState(!isHiddenDisplay);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = getMessageText(message.content);
  const images = getMessageImages(message.content);
  const hasDetails = message.details !== undefined;
  const detailsText = hasDetails ? safeJson(message.details) : "";
  const title = formatCustomType(message.customType);
  const time = formatTime(message.timestamp);

  const copyContent = () => {
    copyText(text || detailsText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="mb-4">
      <div className={`overflow-hidden rounded-lg border border-(--border) ${isHiddenDisplay ? "bg-(--bg-subtle)" : "bg-(--bg)"} ${isHiddenDisplay && !contentExpanded ? "opacity-[0.82]" : "opacity-100"}`}>
        <div
          className="flex items-center gap-2 py-[7px] px-2.5 border-b border-(--border) bg-(--bg-panel) text-(--text-muted) text-xs"
        >
          <span className="font-mono text-[11px] font-[650] text-(--text-muted)">
            {title}
          </span>
           {isHiddenDisplay && <span className="text-(--text-dim) text-[11px]">{t("i18n.hiddenExtensionMessage")}</span>}
          {time && <span className="ml-auto text-(--text-dim) text-[10px]">{time}</span>}
        </div>

        {contentExpanded ? (
          <div className="py-1.5 px-[9px]">
            {images.length > 0 && (
              <div className={`flex gap-1.5 flex-wrap ${text ? "mb-2" : "mb-0"}`}>
                {images.map((img, i) => {
                  const src = imageSource(img);
                  if (!src) return null;
                  return (
                    <ImagePreview key={i} src={src}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={src}
                        alt=""
                        className="block max-h-60 max-w-60 rounded-md border border-(--border) object-contain"
                      />
                    </ImagePreview>
                  );
                })}
              </div>
            )}
             {text ? <MarkdownBody className="markdown-custom-message" cwd={cwd} onOpenFile={onOpenFile}>{text}</MarkdownBody> : <span className="text-(--text-dim) text-xs">{t("i18n.noMessage")}</span>}
          </div>
        ) : (
          <button
            onClick={() => setContentExpanded(true)}
            className="block w-full py-2 px-2.5 border-none bg-transparent text-(--text-dim) cursor-pointer text-xs text-left"
          >
             {text ? previewText(text) : t("i18n.showExtensionMessage")}
          </button>
        )}

        <div
          className="flex items-center gap-2 py-1 px-[9px] border-t border-(--border) bg-(--bg-subtle)"
        >
          {text || detailsText ? (
            <button
              onClick={copyContent}
              className={`cursor-pointer border-none bg-transparent px-[7px] py-[3px] text-[11px] ${copied ? "text-(--accent)" : "text-(--text-dim) hover:text-(--accent)"}`}
            >
               {copied ? t("i18n.copied") : t("i18n.copy")}
            </button>
          ) : null}
          {(hasDetails || isHiddenDisplay) && (
            <button
              onClick={() => {
                if (isHiddenDisplay) setContentExpanded((v) => !v);
                else setDetailsExpanded((v) => !v);
              }}
              className="ml-auto cursor-pointer border-none bg-transparent px-[7px] py-[3px] text-[11px] text-(--text-dim) hover:text-(--accent)"
            >
              {isHiddenDisplay
                 ? (contentExpanded ? t("i18n.collapse") : t("i18n.expand"))
                 : (detailsExpanded ? t("i18n.hideDetails") : t("i18n.showDetails"))}
            </button>
          )}
        </div>

        {hasDetails && ((isHiddenDisplay && contentExpanded) || (!isHiddenDisplay && detailsExpanded)) && (
          <pre className="m-0 max-h-90 overflow-auto border-t border-t-(--border) bg-(--bg) px-2.5 py-[9px] font-mono text-[12px] leading-[1.5] whitespace-pre-wrap break-words text-(--text-muted)">
            {detailsText}
          </pre>
        )}
      </div>
    </div>
  );
}

function getMessageText(content: CustomMessage["content"] | UserMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is TextContent => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function getMessageImages(content: CustomMessage["content"] | UserMessage["content"]): ImageContent[] {
  if (typeof content === "string") return [];
  return content.filter((b): b is ImageContent => b.type === "image");
}

function imageSource(img: ImageContent): string {
  const flat = img as unknown as { data?: string; mimeType?: string };
  if (img.source) {
    return img.source.type === "base64"
      ? `data:${img.source.media_type};base64,${img.source.data}`
      : img.source.url ?? "";
  }
  return flat.data ? `data:${flat.mimeType};base64,${flat.data}` : "";
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function getToolCallInputText(block: ToolCallContent): string {
  return block.rawInput ?? JSON.stringify(block.input, null, 2);
}

function formatCustomType(type: string): string {
  return type || "extension";
}

function previewText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "Show extension message";
  return normalized.length > 140 ? `${normalized.slice(0, 140)}...` : normalized;
}


function getToolPreview(block: ToolCallContent): string {
  const input = block.input;
  if (!input || typeof input !== "object") return "";
  const keys = Object.keys(input);
  if (keys.length === 0) return "";

  // Common tool input patterns
  if ("command" in input) return String(input.command).slice(0, 120);
  if ("path" in input) return String(input.path).slice(0, 120);
  if ("file_path" in input) return String(input.file_path).slice(0, 120);
  if ("pattern" in input) return String(input.pattern).slice(0, 120);
  if ("query" in input) return String(input.query).slice(0, 120);

  const first = input[keys[0]];
  return String(first).slice(0, 120);
}

function formatUsage(usage: {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: { total: number };
}): string {
  const parts = [];
  if (usage.input) parts.push(`${usage.input.toLocaleString()} in`);
  if (usage.output) parts.push(`${usage.output.toLocaleString()} out`);
  if (usage.cacheRead) parts.push(`${usage.cacheRead.toLocaleString()} cache R`);
  if (usage.cacheWrite) parts.push(`${usage.cacheWrite.toLocaleString()} cache W`);
  if (usage.cost?.total) parts.push(`$${usage.cost.total.toFixed(4)}`);
  return parts.join(" · ");
}

function BashExecutionView({ message, sessionId }: { message: BashExecutionMessage; sessionId?: string }) {
  const [fullOutput, setFullOutput] = useState<string | null>(null);
  const [loadingFull, setLoadingFull] = useState(false);
  const [fullError, setFullError] = useState<string | null>(null);

  const isPending = !message.output && message.exitCode === undefined && !message.cancelled;
  const isError = message.cancelled || (message.exitCode !== undefined && message.exitCode !== 0);
  const fullOutputUrl = sessionId && message.fullOutputPath
    ? `/api/agent/${encodeURIComponent(sessionId)}/bash-output?path=${encodeURIComponent(message.fullOutputPath)}`
    : null;
  const showFullButton = message.truncated && fullOutputUrl && fullOutput === null;
  const displayOutput = fullOutput ?? message.output;

  async function loadFullOutput() {
    if (!fullOutputUrl) return;
    setLoadingFull(true);
    setFullError(null);
    try {
      const res = await fetch(fullOutputUrl);
      const d = await res.json() as { success?: boolean; data?: { output?: string }; error?: string };
      if (d.success) {
        setFullOutput(d.data?.output ?? "");
      } else {
        setFullError(d.error ?? "failed");
      }
    } catch (e) {
      setFullError(String(e));
    } finally {
      setLoadingFull(false);
    }
  }

  // Reuse the existing ToolCallBlock so user-run bash looks identical to an
  // agent-run bash tool call: same header, collapse behavior, result pane.
  // Synthesize an equivalent ToolCallContent + ToolResultMessage pair.
  const toolName = message.excludeFromContext ? "bash (local)" : "bash";
  const block: ToolCallContent = {
    type: "toolCall",
    toolCallId: `bash-${message.timestamp ?? ""}`,
    toolName,
    input: { command: message.command },
  };
  const result: ToolResultMessage | undefined = isPending
    ? undefined
    : {
        role: "toolResult",
        toolCallId: block.toolCallId,
        toolName,
        content: displayOutput ? [{ type: "text", text: displayOutput }] : [],
        isError,
        timestamp: message.timestamp,
      };

  return (
    <div className="my-1.5 mx-0">
      <ToolCallBlock block={block} result={result} running={false} active={false} />
      {message.truncated && fullOutputUrl && (
        <div className="py-1 px-2.5 text-[11px] mt-[-1px]">
          {showFullButton && (
            <button
              onClick={loadFullOutput}
              disabled={loadingFull}
              className={`bg-transparent border-none text-(--accent) text-[11px] p-0 underline ${loadingFull ? "cursor-default" : "cursor-pointer"}`}
            >
              {loadingFull ? "loading…" : "view full output"}
            </button>
          )}
          <a
            href={`${fullOutputUrl}&download=1`}
            className={`text-(--accent) text-[11px] underline ${showFullButton ? "ml-2.5" : "ml-0"}`}
          >
            download full output
          </a>
          {fullError && <span className="ml-1.5 text-(--text-dim) text-[11px]">({fullError})</span>}
        </div>
      )}
    </div>
  );
}
