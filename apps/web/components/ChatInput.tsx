"use client";

import React, { useRef, useState, useCallback, useEffect, useLayoutEffect, useImperativeHandle, forwardRef, KeyboardEvent } from "react";
import {
  ArrowUp, ArrowRight, X, Check, ChevronDown, Plus, Shield, BrainCircuit, Shrink,
  Volume2, VolumeX, Square, Paperclip, RotateCcw, Undo2, TriangleAlert,
  CircleCheck,
} from "lucide-react";
import { PiLoader } from "./PiLoader";
import type { BuiltinSlashCommandResult, CompactResultInfo, QueuedMessages, SlashCommandInfo } from "@/hooks/useAgentSession";
import type { SkillsResponse } from "@/lib/api-types";
import type { TextContent, UserMessage } from "@/lib/types";
import {
  clearDraft,
  getDraft,
  mergeRestoredSubmissionDraft,
  mergeRestoredSubmissionText,
  rekeyDraft as rekeyStoredDraft,
  setDraft,
  type ChatDraftImage,
} from "@/lib/draft-store";
import {
  MAX_ATTACHED_IMAGE_BYTES,
  MAX_ATTACHED_IMAGES,
  isBase64ImageWithinLimits,
} from "@/lib/image-attachments";
import {
  buildEntriesFromFiles, buildAtInsertText, extractAtQuery, filterFileEntries,
  type AtQueryMatch, type FileIndexEntry,
} from "@/lib/file-fuzzy";
import { FolderIcon, getFileIcon } from "./FileIcons";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import type { ToolPreset } from "@/lib/tool-presets";

export interface AttachedImage {
  data: string;   // base64, no prefix
  mimeType: string;
  previewUrl: string; // object URL for display
}

interface ModelOption {
  provider: string;
  modelId: string;
  name: string;
}

interface Props {
  onSend: (message: string, images?: AttachedImage[]) => void;
  onAbort: () => void;
  /** Abort RPC in flight — stop button shows a pending/spinner state. */
  aborting?: boolean;
  onSteer?: (message: string, images?: AttachedImage[]) => void;
  onFollowUp?: (message: string, images?: AttachedImage[]) => void;
  onPromptWithStreamingBehavior?: (message: string, behavior: "steer" | "followUp", images?: AttachedImage[]) => void;
  isStreaming: boolean;
  isNewSession?: boolean;
  model?: { provider: string; modelId: string } | null;
  isAutoModelSelection?: boolean;
  modelNames?: Record<string, string>;
  modelList?: { id: string; name: string; provider: string }[];
  modelError?: string | null;
  /** Diagnostics from resolving `enabledModels`, e.g. a pattern that matched nothing. */
  modelScopeWarnings?: string[];
  onModelChange?: (provider: string, modelId: string) => void;
  modelSwitching?: boolean;
  onCompact?: () => void;
  onAbortCompaction?: () => void;
  isCompacting?: boolean;
  compactError?: string | null;
  compactResult?: CompactResultInfo | null;
  toolPreset?: ToolPreset;
  onToolPresetChange?: (preset: ToolPreset) => void;
  thinkingLevel?: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  onThinkingLevelChange?: (level: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max") => void;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;
  retryInfo?: { attempt: number; maxAttempts: number; errorMessage?: string } | null;
  queuedMessages?: QueuedMessages | null;
  inputHistory?: string[];
  onRecallQueue?: () => void;
  slashCommands?: SlashCommandInfo[];
  slashCommandsLoading?: boolean;
  onLoadSlashCommands?: () => Promise<SlashCommandInfo[]> | SlashCommandInfo[];
  onBuiltinCommand?: (message: string) => Promise<BuiltinSlashCommandResult>;
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
  onAudioUnlock?: () => void;
  draftKey?: string;
  /** Session working directory — enables the @ file autocomplete menu */
  cwd?: string | null;
}

export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (text: string) => void;
  replaceMessage: (message: UserMessage) => void;
  prependText: (text: string) => void;
  addImages: (files: File[]) => void;
  rekeyDraft: (previousKey: string, nextKey: string) => void;
  restoreSubmission: (text: string, images?: ChatDraftImage[], targetDraftKey?: string) => void;
}

const TOOL_PRESETS = ["off", "read-only", "default", "full"] as const;
type ToolPresetLabel = typeof TOOL_PRESETS[number];
const TOOL_PRESET_MAP: Record<ToolPresetLabel, ToolPreset> = {
  off: "none",
  "read-only": "read-only",
  default: "default",
  full: "full",
};
const COMPOSITION_END_ENTER_GRACE_MS = 100;
const MODEL_FILTER_THRESHOLD = 8;
const MODEL_OPTION_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const ANCHORED_MENU_GAP = 8; const COMPOSER_TEXTAREA_MAX_HEIGHT = 336;

export function getUpwardMenuMaxHeight(menuBottom: number, visibleTop: number, gap = ANCHORED_MENU_GAP): number {
  return Math.max(0, Math.floor(menuBottom - visibleTop - gap));
}

function getVisibleTopBoundary(element: HTMLElement): number {
  let visibleTop = window.visualViewport?.offsetTop ?? 0;

  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const overflowY = window.getComputedStyle(parent).overflowY;
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "hidden" || overflowY === "clip") {
      visibleTop = Math.max(visibleTop, parent.getBoundingClientRect().top + parent.clientTop);
    }
  }

  return visibleTop;
}

function compareModelOptions(a: ModelOption, b: ModelOption): number {
  return MODEL_OPTION_COLLATOR.compare(a.name || a.modelId, b.name || b.modelId)
    || MODEL_OPTION_COLLATOR.compare(a.provider, b.provider)
    || MODEL_OPTION_COLLATOR.compare(a.modelId, b.modelId);
}

export function filterModelOptions(options: ModelOption[], query: string): ModelOption[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return options;

  return options.filter((option) => (
    `${option.name} ${option.modelId}`
      .toLocaleLowerCase()
      .includes(normalizedQuery)
  ));
}

const THINKING_LEVELS = ["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const THINKING_LEVEL_DESC_KEYS: Record<typeof THINKING_LEVELS[number], string> = {
  auto: "chat.thinkingUseDefault", off: "chat.thinkingOff", minimal: "chat.thinkingMinimal", low: "chat.thinkingLow",
  medium: "chat.thinkingMedium", high: "chat.thinkingHigh", xhigh: "chat.thinkingXhigh", max: "chat.thinkingMax",
};

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return tokens.toLocaleString();
}

type SlashCommandPaletteItem = SlashCommandInfo | {
  name: string;
  description: string;
  source: "builtin";
};

type SlashCommandSource = SlashCommandPaletteItem["source"];

const BUILTIN_SLASH_COMMANDS: SlashCommandPaletteItem[] = [
  { name: "compact", description: "chat.commandCompact", source: "builtin" },
  { name: "reload", description: "chat.commandReload", source: "builtin" },
  { name: "name", description: "chat.commandName", source: "builtin" },
  { name: "session", description: "chat.commandSession", source: "builtin" },
  { name: "copy", description: "chat.commandCopy", source: "builtin" },
];

const SLASH_SOURCES: SlashCommandSource[] = ["builtin", "extension", "prompt", "skill"];

const SLASH_SOURCE_GROUP_LABEL_KEYS: Record<SlashCommandSource, string> = {
  builtin: "chat.builtIn",
  extension: "chat.extensions",
  prompt: "chat.prompts",
  skill: "chat.skills",
};

const SLASH_SOURCE_ORDER: Record<SlashCommandSource, number> = {
  builtin: 0,
  extension: 1,
  prompt: 2,
  skill: 3,
};

function slashMatchRank(command: SlashCommandPaletteItem, query: string, t: (key: string) => string): number {
  const name = command.name.toLowerCase();
  const description = getSlashDescription(command, t).toLowerCase();
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  if (description.includes(query)) return 3;
  return 4;
}

function getSlashDescription(command: SlashCommandPaletteItem, t: (key: string) => string): string {
  return command.source === "builtin" ? t(command.description) : command.description ?? "";
}

// Skill slash commands are named "skill:<skillName>"; look the skill up in the
// dormancy map fetched from /api/skills. Unknown skills are treated as active.
function isDormantSkillCommand(command: SlashCommandPaletteItem, dormancy: Record<string, boolean>): boolean {
  if (command.source !== "skill" || !command.name.startsWith("skill:")) return false;
  return dormancy[command.name.slice("skill:".length)] === true;
}

export function buildSlashCommandLayout(
  commands: SlashCommandPaletteItem[],
  dormancy: Record<string, boolean>,
) {
  let index = 0;
  const groups = SLASH_SOURCES
    .map((source) => {
      const sourceCommands = commands.filter((command) => command.source === source);
      const orderedCommands = source === "skill"
        ? [
            ...sourceCommands.filter((command) => !isDormantSkillCommand(command, dormancy)),
            ...sourceCommands.filter((command) => isDormantSkillCommand(command, dormancy)),
          ]
        : sourceCommands;
      return {
        source,
        items: orderedCommands.map((command) => ({ command, index: index++ })),
      };
    })
    .filter((group) => group.items.length > 0);

  return {
    commands: groups.flatMap((group) => group.items.map(({ command }) => command)),
    groups,
  };
}

function imageToDraftImage(image: AttachedImage): ChatDraftImage {
  return { data: image.data, mimeType: image.mimeType };
}

function draftImageToAttachedImage(image: ChatDraftImage): AttachedImage {
  return {
    ...image,
    previewUrl: `data:${image.mimeType};base64,${image.data}`,
  };
}

function draftImagesToAttachedImages(images: ChatDraftImage[] | undefined): AttachedImage[] {
  return (images ?? [])
    .filter(isBase64ImageWithinLimits)
    .slice(0, MAX_ATTACHED_IMAGES)
    .map(draftImageToAttachedImage);
}

export function canRestoreUserMessage(
  value: string,
  attachedImageCount: number,
  pendingImageCount: number,
): boolean {
  return !value.trim() && attachedImageCount === 0 && pendingImageCount === 0;
}

export function getUserMessageText(message: UserMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export function getUserMessageDraftImages(message: UserMessage): ChatDraftImage[] {
  if (typeof message.content === "string") return [];
  return message.content.flatMap((block) => {
    if (block.type !== "image") return [];

    // Support both the current nested image format and older flat pi-ai entries.
    const flat = block as unknown as { data?: unknown; mimeType?: unknown };
    const data = block.source?.type === "base64" ? block.source.data : flat.data;
    const mimeType = block.source?.type === "base64" ? block.source.media_type : flat.mimeType;
    if (typeof data !== "string" || typeof mimeType !== "string") return [];

    const image = { data, mimeType };
    return isBase64ImageWithinLimits(image) ? [image] : [];
  });
}

function revokeImagePreview(image: AttachedImage): void {
  if (image.previewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(image.previewUrl);
  }
}

function QueuedMessageRow({ kind, text }: { kind: "steer" | "follow-up"; text: string }) {
  return (
    <div
      title={text}
      className="flex items-center gap-2 py-0.75 px-2.5 text-xs text-(--text-muted) min-w-0"
    >
      <span
        className={`shrink-0 rounded-full border px-[7px] py-px font-mono text-[10px] ${kind === "steer" ? "border-[color-mix(in_srgb,var(--accent)_45%,transparent)] text-(--accent)" : "border-(--border) text-(--text-dim)"}`}
      >
        {kind}
      </span>
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{text}</span>
    </div>
  );
}

function ModelNoticeBanner({ tone, title, body }: { tone: "error" | "warning"; title: string; body: string }) {
  const toneClasses = tone === "error"
    ? "border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.07)] text-[rgb(239,68,68)]"
    : "border-[rgba(234,179,8,0.3)] bg-[rgba(234,179,8,0.07)] text-[rgb(234,179,8)]";
  return (
    <div
      role="alert"
      className={`mb-2 flex max-h-[120px] items-start gap-2 overflow-y-auto rounded-md border px-2.5 py-[7px] text-[11px] leading-[1.45] ${toneClasses}`}
    >
      <TriangleAlert size={13} strokeWidth={2} className="shrink-0 mt-[1px]" aria-hidden="true" />
      <div className="min-w-0">
        <div className="font-semibold">{title}</div>
        <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{body}</div>
      </div>
    </div>
  );
}

export function ModelErrorBanner({ error }: { error?: string | null }) {
  if (!error) return null;
  return <ModelNoticeBanner tone="error" title="Model error" body={error} />;
}

/** Surfaces `enabledModels` patterns that matched nothing, so a typo is visible (#307). */
export function ModelScopeWarningBanner({ warnings }: { warnings?: string[] }) {
  if (!warnings || warnings.length === 0) return null;
  return (
    <ModelNoticeBanner
      tone="warning"
      title={warnings.length > 1 ? "Model scope warnings" : "Model scope warning"}
      body={warnings.join("\n")}
    />
  );
}

export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput({
  onSend, onAbort, aborting = false, onSteer, onFollowUp, isStreaming, isNewSession = false, model, isAutoModelSelection, modelNames, modelList, modelError, modelScopeWarnings, onModelChange, modelSwitching,
  onCompact, onAbortCompaction, isCompacting, compactError, compactResult, toolPreset, onToolPresetChange,
  thinkingLevel, onThinkingLevelChange, availableThinkingLevels, thinkingLevelMap,
  retryInfo, queuedMessages, inputHistory = [], onRecallQueue,
  slashCommands, slashCommandsLoading, onLoadSlashCommands,
  onBuiltinCommand,
  soundEnabled, onSoundToggle, onAudioUnlock,
  onPromptWithStreamingBehavior,
  draftKey,
  cwd,
}: Props, ref) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [value, setValue] = useState(() => (draftKey ? getDraft(draftKey)?.value ?? "" : ""));
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [modelDropdownRect, setModelDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const [modelFilter, setModelFilter] = useState("");
  const [toolDropdownOpen, setToolDropdownOpen] = useState(false);
  const [thinkingDropdownOpen, setThinkingDropdownOpen] = useState(false);
  const [controlsMenuOpen, setControlsMenuOpen] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>(() => (
    draftKey ? draftImagesToAttachedImages(getDraft(draftKey)?.images) : []
  ));
  const trimmedValue = value.trimStart();
  const bashMode = attachedImages.length === 0 && trimmedValue.startsWith("!");
  const bashExcluded = bashMode && trimmedValue.startsWith("!!");
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [slashMenuMaxHeight, setSlashMenuMaxHeight] = useState<number | null>(null);
  const [atQuery, setAtQuery] = useState<AtQueryMatch | null>(null);
  const [atMenuOpen, setAtMenuOpen] = useState(false);
  const [atActiveIndex, setAtActiveIndex] = useState(0);
  const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
  const [historyActiveIndex, setHistoryActiveIndex] = useState(0);
  const [fileIndex, setFileIndex] = useState<{ cwd: string; entries: FileIndexEntry[]; truncated: boolean } | null>(null);
  const [fileIndexLoading, setFileIndexLoading] = useState(false);
  const [atServerResult, setAtServerResult] = useState<{ cwd: string; query: string; matches: FileIndexEntry[] } | null>(null);
  const [skillDormancyState, setSkillDormancyState] = useState<{
    cwd: string;
    values: Record<string, boolean>;
  } | null>(null);
  const skillDormancy = cwd && skillDormancyState?.cwd === cwd
    ? skillDormancyState.values
    : {};

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const modelDropdownPanelRef = useRef<HTMLDivElement>(null);
  const toolDropdownRef = useRef<HTMLDivElement>(null);
  const thinkingDropdownRef = useRef<HTMLDivElement>(null);
  const controlsMenuRef = useRef<HTMLDivElement>(null);
  const historyMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);
  const slashCommandsRequestedRef = useRef(false);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const slashItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const atItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const historyItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const fileIndexMetaRef = useRef<{ cwd: string; fetchedAt: number } | null>(null);
  const fileIndexFetchingRef = useRef<string | null>(null);
  const draftKeyRef = useRef(draftKey);
  const valueRef = useRef(value);
  const attachedImagesRef = useRef(attachedImages);
  const pendingImageCountRef = useRef(0);
  useEffect(() => {
    valueRef.current = value;
    attachedImagesRef.current = attachedImages;
  });

  useImperativeHandle(ref, () => ({
    insertIfEmpty(text: string) {
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      if (current.trim()) return;
      valueRef.current = text;
      setValue(text);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, COMPOSER_TEXTAREA_MAX_HEIGHT)}px`;
      });
    },
    replaceMessage(message: UserMessage) {
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      if (!canRestoreUserMessage(current, attachedImagesRef.current.length, pendingImageCountRef.current)) return;

      const restoredText = getUserMessageText(message);
      const restoredImages = draftImagesToAttachedImages(getUserMessageDraftImages(message));
      valueRef.current = restoredText;
      attachedImagesRef.current = restoredImages;
      setValue(restoredText);
      setAtQuery(null);
      setHistoryMenuOpen(false);
      setAttachedImages((prev) => {
        prev.forEach(revokeImagePreview);
        return restoredImages;
      });
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, COMPOSER_TEXTAREA_MAX_HEIGHT)}px`;
      });
    },
    prependText(text: string) {
      if (!text.trim()) return;
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      // Mirrors the TUI's queue restore: queued text first, then whatever
      // the user already typed, separated by a blank line.
      const combined = [text, current].filter((t) => t.trim()).join("\n\n");
      valueRef.current = combined;
      setValue(combined);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(combined.length, combined.length);
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, COMPOSER_TEXTAREA_MAX_HEIGHT)}px`;
      });
    },
    rekeyDraft(previousKey: string, nextKey: string) {
      if (previousKey === nextKey) return;
      if (draftKeyRef.current !== previousKey) {
        rekeyStoredDraft(previousKey, nextKey);
        return;
      }

      const currentDraft = {
        value: valueRef.current,
        images: attachedImagesRef.current.map(imageToDraftImage),
      };
      const moved = rekeyStoredDraft(previousKey, nextKey, currentDraft) ?? { value: "", images: [] };
      const unchanged = moved.value === currentDraft.value
        && moved.images.length === currentDraft.images.length
        && moved.images.every((image, index) => (
          image.data === currentDraft.images[index]?.data
          && image.mimeType === currentDraft.images[index]?.mimeType
        ));
      draftKeyRef.current = nextKey;
      if (unchanged) return;

      const movedImages = draftImagesToAttachedImages(moved.images);
      valueRef.current = moved.value;
      attachedImagesRef.current = movedImages;
      setValue(moved.value);
      setAttachedImages((current) => {
        current.forEach(revokeImagePreview);
        return movedImages;
      });
      setAtQuery(null);
      setHistoryMenuOpen(false);
    },
    restoreSubmission(text: string, images?: ChatDraftImage[], targetDraftKey?: string) {
      if (!text.trim() && !images?.length) return;

      // clearInput is queued before the submission handler runs. Compose with
      // that queued state so a fast rejection cannot observe stale DOM text and
      // then get overwritten by the clear.
      const currentDraftKey = draftKeyRef.current;
      const destinationDraftKey = targetDraftKey ?? currentDraftKey;
      const targetsCurrentComposer = destinationDraftKey === currentDraftKey;
      const storedDraft = !targetsCurrentComposer && destinationDraftKey
        ? getDraft(destinationDraftKey)
        : null;
      const restoredDraft = mergeRestoredSubmissionDraft(
        text,
        images,
        targetsCurrentComposer ? valueRef.current : (storedDraft?.value ?? ""),
        targetsCurrentComposer
          ? attachedImagesRef.current.map(imageToDraftImage)
          : (storedDraft?.images ?? []),
      );
      // The first optimistic message switches ChatWindow out of its empty-state
      // layout and remounts this component. Persist synchronously so recovery is
      // not lost if this instance is the one being unmounted.
      if (destinationDraftKey) setDraft(destinationDraftKey, restoredDraft);
      if (!targetsCurrentComposer) return;
      const restoredImages = images?.length
        ? [
            ...draftImagesToAttachedImages(images).slice(
              0,
              Math.max(0, MAX_ATTACHED_IMAGES - attachedImagesRef.current.length),
            ),
            ...attachedImagesRef.current,
          ].slice(0, MAX_ATTACHED_IMAGES)
        : attachedImagesRef.current;
      // Session promotion can rekey this composer before React flushes the
      // functional updates below, so update the imperative snapshot first.
      valueRef.current = restoredDraft.value;
      attachedImagesRef.current = restoredImages;
      setValue((current) => {
        const restored = mergeRestoredSubmissionText(text, current);
        valueRef.current = restored;
        return restored;
      });
      setAtQuery(null);
      setHistoryMenuOpen(false);
      if (images?.length) {
        setAttachedImages((current) => {
          const available = Math.max(0, MAX_ATTACHED_IMAGES - current.length);
          const restored = draftImagesToAttachedImages(images)
            .slice(0, available);
          const next = restored.length > 0 ? [...restored, ...current] : current;
          attachedImagesRef.current = next;
          return next;
        });
      }
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, COMPOSER_TEXTAREA_MAX_HEIGHT)}px`;
      });
    },
    insertText(text: string) {
      const ta = textareaRef.current;
      if (!ta) {
        setValue((v) => v + (v ? " " : "") + text);
        return;
      }
      const start = ta.selectionStart ?? ta.value.length;
      const end = ta.selectionEnd ?? ta.value.length;
      const before = ta.value.slice(0, start);
      const after = ta.value.slice(end);
      const sep = before.length > 0 && !before.endsWith(" ") ? " " : "";
      const newVal = before + sep + text + after;
      valueRef.current = newVal;
      setValue(newVal);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        const pos = start + sep.length + text.length;
        ta.setSelectionRange(pos, pos);
        ta.focus();
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, COMPOSER_TEXTAREA_MAX_HEIGHT)}px`;
      });
    },
    addImages(files: File[]) {
      processImageFiles(files);
    },
  }));

  const processImageFiles = useCallback(async (files: File[]) => {
    const remaining = Math.max(
      0,
      MAX_ATTACHED_IMAGES - attachedImagesRef.current.length - pendingImageCountRef.current,
    );
    const imageFiles = files
      .filter((f) => f.type.startsWith("image/") && f.size <= MAX_ATTACHED_IMAGE_BYTES)
      .slice(0, remaining);
    if (!imageFiles.length) return;
    pendingImageCountRef.current += imageFiles.length;
    try {
      const newImages = await Promise.all(
        imageFiles.map(
          (file) =>
            new Promise<AttachedImage>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                const result = reader.result as string;
                // result is "data:<mime>;base64,<data>"
                const base64 = result.split(",")[1];
                resolve({ data: base64, mimeType: file.type, previewUrl: URL.createObjectURL(file) });
              };
              reader.onerror = reject;
              reader.readAsDataURL(file);
            })
        )
      );
      setAttachedImages((prev) => {
        const accepted = newImages.slice(0, Math.max(0, MAX_ATTACHED_IMAGES - prev.length));
        newImages.slice(accepted.length).forEach(revokeImagePreview);
        const next = [...prev, ...accepted];
        attachedImagesRef.current = next;
        return next;
      });
    } finally {
      pendingImageCountRef.current -= imageFiles.length;
    }
  }, []);

  const removeImage = useCallback((index: number) => {
    setAttachedImages((prev) => {
      const next = [...prev];
      const [removed] = next.splice(index, 1);
      if (removed) revokeImagePreview(removed);
      attachedImagesRef.current = next;
      return next;
    });
  }, []);

  const clearImages = useCallback(() => {
    attachedImagesRef.current = [];
    setAttachedImages((prev) => {
      prev.forEach(revokeImagePreview);
      return [];
    });
  }, []);

  const clearInput = useCallback(() => {
    valueRef.current = "";
    setValue("");
    setAtQuery(null);
    setHistoryMenuOpen(false);
    if (draftKey) clearDraft(draftKey);
    if (draftKeyRef.current && draftKeyRef.current !== draftKey) clearDraft(draftKeyRef.current);
    clearImages();
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [clearImages, draftKey]);

  useEffect(() => {
    if (!draftKey || draftKeyRef.current !== draftKey) return;
    setDraft(draftKey, {
      value,
      images: attachedImages.map(imageToDraftImage),
    });
  }, [attachedImages, draftKey, value]);

  useEffect(() => {
    const previousDraftKey = draftKeyRef.current;
    if (previousDraftKey === draftKey) return;

    if (previousDraftKey) {
      setDraft(previousDraftKey, {
        value: valueRef.current,
        images: attachedImagesRef.current.map(imageToDraftImage),
      });
    }

    const draft = draftKey ? getDraft(draftKey) : null;
    draftKeyRef.current = draftKey;
    const nextValue = draft?.value ?? "";
    const nextImages = draftImagesToAttachedImages(draft?.images);
    valueRef.current = nextValue;
    attachedImagesRef.current = nextImages;
    setValue(nextValue);
    setAtQuery(null);
    setHistoryMenuOpen(false);
    setAttachedImages((prev) => {
      prev.forEach(revokeImagePreview);
      return nextImages;
    });
  }, [draftKey]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    if (value) ta.style.height = `${Math.min(ta.scrollHeight, COMPOSER_TEXTAREA_MAX_HEIGHT)}px`;
  }, [value]);

  useEffect(() => {
    return () => {
      attachedImagesRef.current.forEach(revokeImagePreview);
    };
  }, []);

  const handleSend = useCallback(async () => {
    const msg = value.trim();
    if (!msg && !attachedImages.length) return;
    if (isStreaming) return;
    onAudioUnlock?.();
    if (!attachedImages.length && msg.startsWith("/") && onBuiltinCommand) {
      const result = await onBuiltinCommand(msg);
      if (result.handled) {
        if (!result.error) clearInput();
        return;
      }
    }
    clearInput();
    onSend(msg, attachedImages.length ? attachedImages : undefined);
  }, [value, attachedImages, isStreaming, onBuiltinCommand, onSend, clearInput, onAudioUnlock]);

  const slashQuery = value.startsWith("/") && !/\s/.test(value.slice(1))
    ? value.slice(1).toLowerCase()
    : null;

  const filteredSlashCommands = (() => {
    if (slashQuery === null) return [];
    const commands = [...(isStreaming ? [] : BUILTIN_SLASH_COMMANDS), ...(slashCommands ?? [])];
    return [...commands]
      .filter((command) => {
        const name = command.name.toLowerCase();
        const description = getSlashDescription(command, t).toLowerCase();
        return name.includes(slashQuery) || description.includes(slashQuery);
      })
      .sort((a, b) => {
        const rankDelta = slashMatchRank(a, slashQuery, t) - slashMatchRank(b, slashQuery, t);
        if (rankDelta !== 0) return rankDelta;
        return SLASH_SOURCE_ORDER[a.source] - SLASH_SOURCE_ORDER[b.source]
          || MODEL_OPTION_COLLATOR.compare(a.name, b.name);
      });
  })();

  const {
    commands: displayedSlashCommands,
    groups: groupedSlashCommands,
  } = buildSlashCommandLayout(filteredSlashCommands, skillDormancy);

  const slashCommandCountLabel = filteredSlashCommands.length === 1
    ? t(slashQuery ? "chat.match" : "chat.command")
    : t(slashQuery ? "chat.matches" : "chat.commands", { count: filteredSlashCommands.length });
  const hasInputText = Boolean(value.trim());
  const canQueueStreamingMessage = hasInputText || attachedImages.length > 0;

  // ── @ file autocomplete ──────────────────────────────────────────────────
  // Recomputed from the text before the caret on every change/caret move.
  // Disabled entirely when there is no cwd (new session without a directory).
  const updateAtQuery = useCallback((text: string, cursor: number | null) => {
    if (!cwd) {
      setAtQuery(null);
      return;
    }
    const pos = cursor ?? text.length;
    setAtQuery(extractAtQuery(text.slice(0, pos)));
  }, [cwd]);

  const atQueryText = atQuery?.query ?? null;
  const atLocalMatches: FileIndexEntry[] = React.useMemo(() => (
    atQueryText !== null && fileIndex && fileIndex.cwd === cwd
      ? filterFileEntries(fileIndex.entries, atQueryText)
      : []
  ), [atQueryText, fileIndex, cwd]);

  // When the client index is truncated (repo larger than the index cap),
  // local filtering cannot see deep files, so queries are also ranked
  // server-side against the full listing. Local matches render immediately
  // and are replaced when the (debounced) server result for the current
  // query arrives; stale responses are ignored via the query/cwd tag.
  const needsServerSearch = Boolean(atQueryText && fileIndex?.truncated && fileIndex.cwd === cwd);
  useEffect(() => {
    if (!needsServerSearch || !cwd || !atQueryText) return;
    const fetchCwd = cwd;
    const query = atQueryText;
    const timer = setTimeout(() => {
      fetch(`/api/file-index?cwd=${encodeURIComponent(fetchCwd)}&q=${encodeURIComponent(query)}`)
        .then((res) => {
          if (!res.ok) throw new Error(`file search failed: ${res.status}`);
          return res.json() as Promise<{ matches?: FileIndexEntry[] }>;
        })
        .then((data) => setAtServerResult({ cwd: fetchCwd, query, matches: data.matches ?? [] }))
        .catch(() => {
          // Keep showing local matches; the next keystroke retries.
        });
    }, 150);
    return () => clearTimeout(timer);
  }, [needsServerSearch, atQueryText, cwd]);

  const serverResultInUse = needsServerSearch
    && atServerResult !== null
    && atServerResult.cwd === cwd
    && atServerResult.query === atQueryText;
  const atMatches: FileIndexEntry[] = serverResultInUse ? atServerResult.matches : atLocalMatches;

  // Open/reset the menu whenever the @token appears or changes (mirrors the
  // slash menu: Escape closes it, the next keystroke re-opens it).
  const atTokenKey = atQuery === null ? null : `${atQuery.start}:${atQuery.quoted ? 1 : 0}:${atQuery.query}`;
  useEffect(() => {
    if (atTokenKey === null) {
      setAtMenuOpen(false);
      setAtActiveIndex(0);
      return;
    }
    setAtMenuOpen(true);
    setAtActiveIndex(0);
  }, [atTokenKey]);

  // Fetch the file index when the menu opens. The server caches per cwd for
  // ~10s, so re-opening refreshes cheaply; while typing nothing refetches.
  const atTokenActive = atQuery !== null;
  useEffect(() => {
    if (!atTokenActive || !cwd) return;
    const meta = fileIndexMetaRef.current;
    if (meta && meta.cwd === cwd && Date.now() - meta.fetchedAt < 10_000) return;
    if (fileIndexFetchingRef.current === cwd) return;
    fileIndexFetchingRef.current = cwd;
    const fetchCwd = cwd;
    setFileIndexLoading(true);
    fetch(`/api/file-index?cwd=${encodeURIComponent(fetchCwd)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`file index failed: ${res.status}`);
        return res.json() as Promise<{ files?: string[]; truncated?: boolean }>;
      })
      .then((data) => {
        setFileIndex({ cwd: fetchCwd, entries: buildEntriesFromFiles(data.files ?? []), truncated: !!data.truncated });
        fileIndexMetaRef.current = { cwd: fetchCwd, fetchedAt: Date.now() };
      })
      .catch(() => {
        // Leave any previous index in place; next open retries.
        fileIndexMetaRef.current = null;
      })
      .finally(() => {
        fileIndexFetchingRef.current = null;
        setFileIndexLoading(false);
      });
  }, [atTokenActive, cwd]);

  const applyAtCompletion = useCallback((entry: FileIndexEntry) => {
    if (!atQuery) return;
    const ta = textareaRef.current;
    const cursor = ta?.selectionStart ?? value.length;
    const before = value.slice(0, atQuery.start);
    let after = value.slice(cursor);
    // Completing inside a quoted token (@"my dir/… with the caret before the
    // closing quote): the replacement carries its own closing quote, so drop
    // the old one right after the caret (mirrors the TUI's applyCompletion).
    if (atQuery.quoted && after.startsWith('"')) {
      after = after.slice(1);
    }
    const insert = buildAtInsertText(entry.path, entry.isDir, atQuery.quoted);
    const newValue = before + insert.text + after;
    const newPos = before.length + insert.cursorOffset;
    setValue(newValue);
    // setValue alone does not fire onChange — re-derive the token here. Files
    // end with a space (token closes, menu hides); directories end with "/"
    // before the caret (token stays open for drill-down into the directory).
    setAtQuery(extractAtQuery(newValue.slice(0, newPos)));
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(newPos, newPos);
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, COMPOSER_TEXTAREA_MAX_HEIGHT)}px`;
    });
  }, [atQuery, value]);

  useEffect(() => {
    if (atActiveIndex >= atMatches.length) {
      setAtActiveIndex(Math.max(0, atMatches.length - 1));
    }
  }, [atMatches.length, atActiveIndex]);

  useEffect(() => {
    atItemRefs.current.length = atMatches.length;
  }, [atMatches.length]);

  useEffect(() => {
    if (!atMenuOpen) return;
    atItemRefs.current[atActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [atActiveIndex, atMenuOpen]);

  useEffect(() => {
    if (historyActiveIndex >= inputHistory.length) {
      setHistoryActiveIndex(Math.max(0, inputHistory.length - 1));
    }
  }, [inputHistory.length, historyActiveIndex]);

  useEffect(() => {
    historyItemRefs.current.length = inputHistory.length;
  }, [inputHistory.length]);

  useEffect(() => {
    if (!historyMenuOpen) return;
    historyItemRefs.current[historyActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [historyActiveIndex, historyMenuOpen]);

  const applyHistoryInput = useCallback((text: string) => {
    setValue(text);
    setHistoryMenuOpen(false);
    setHistoryActiveIndex(0);
    setAtQuery(null);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(text.length, text.length);
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, COMPOSER_TEXTAREA_MAX_HEIGHT)}px`;
    });
  }, []);

  const applySlashCommand = useCallback((command: SlashCommandPaletteItem) => {
    const nextValue = `/${command.name} `;
    setValue(nextValue);
    setSlashMenuOpen(false);
    setSlashActiveIndex(0);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(nextValue.length, nextValue.length);
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, COMPOSER_TEXTAREA_MAX_HEIGHT)}px`;
    });
  }, []);

  const sendQueued = useCallback((mode: "steer" | "followup") => {
    const msg = value.trim();
    if (!msg && !attachedImages.length) return;
    onAudioUnlock?.();
    const streamingBehavior = mode === "steer" ? "steer" : "followUp";
    if (msg.startsWith("/") && onPromptWithStreamingBehavior) {
      clearInput();
      onPromptWithStreamingBehavior(msg, streamingBehavior, attachedImages.length ? attachedImages : undefined);
      return;
    }
    clearInput();
    if (mode === "steer" && onSteer) {
      onSteer(msg, attachedImages.length ? attachedImages : undefined);
    } else if (mode === "followup" && onFollowUp) {
      onFollowUp(msg, attachedImages.length ? attachedImages : undefined);
    }
  }, [value, attachedImages, onPromptWithStreamingBehavior, onSteer, onFollowUp, clearInput, onAudioUnlock]);

  const getNextSlashIndex = useCallback((direction: "up" | "down" | "left" | "right") => {
    const lastIndex = displayedSlashCommands.length - 1;
    if (lastIndex < 0) return 0;

    if (direction === "left") return Math.max(0, slashActiveIndex - 1);
    if (direction === "right") return Math.min(lastIndex, slashActiveIndex + 1);

    const currentNode = slashItemRefs.current[slashActiveIndex];
    if (!currentNode) {
      return direction === "down"
        ? Math.min(lastIndex, slashActiveIndex + 1)
        : Math.max(0, slashActiveIndex - 1);
    }

    const currentRect = currentNode.getBoundingClientRect();
    const currentX = currentRect.left + currentRect.width / 2;
    const currentY = currentRect.top + currentRect.height / 2;
    let bestIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let index = 0; index <= lastIndex; index += 1) {
      if (index === slashActiveIndex) continue;
      const node = slashItemRefs.current[index];
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      const candidateY = rect.top + rect.height / 2;
      const verticalDelta = candidateY - currentY;
      if (direction === "down" ? verticalDelta <= 4 : verticalDelta >= -4) continue;

      const candidateX = rect.left + rect.width / 2;
      const score = Math.abs(verticalDelta) * 1000 + Math.abs(candidateX - currentX);
      if (score < bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    }

    if (bestIndex >= 0) return bestIndex;
    return direction === "down"
      ? Math.min(lastIndex, slashActiveIndex + 1)
      : Math.max(0, slashActiveIndex - 1);
  }, [displayedSlashCommands.length, slashActiveIndex]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      const nativeEvent = e.nativeEvent;
      const sendShortcut = e.key === "Enter" && !e.shiftKey && (!isMobile || e.ctrlKey || e.metaKey);
      const recentlyComposed = Date.now() - lastCompositionEndAtRef.current < COMPOSITION_END_ENTER_GRACE_MS;
      const isComposing =
        isComposingRef.current ||
        nativeEvent.isComposing ||
        nativeEvent.keyCode === 229;

      if (sendShortcut && (isComposing || recentlyComposed)) {
        if (recentlyComposed) e.preventDefault();
        return;
      }

      if (historyMenuOpen && !isComposing) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setHistoryActiveIndex((i) => Math.min(Math.max(0, inputHistory.length - 1), i + 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setHistoryActiveIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setHistoryMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || sendShortcut) && inputHistory[historyActiveIndex]) {
          e.preventDefault();
          applyHistoryInput(inputHistory[historyActiveIndex]);
          return;
        }
      }

      if (slashMenuOpen && slashQuery !== null) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("down"));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("up"));
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("right"));
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("left"));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setSlashMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || sendShortcut) && displayedSlashCommands[slashActiveIndex]) {
          e.preventDefault();
          applySlashCommand(displayedSlashCommands[slashActiveIndex]);
          return;
        }
      }

      // @ file menu — skip while composing so IME candidate navigation
      // (arrows/Enter/Tab) is never intercepted.
      if (atMenuOpen && atQuery !== null && !isComposing) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setAtActiveIndex((i) => Math.min(Math.max(0, atMatches.length - 1), i + 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setAtActiveIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setAtMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || sendShortcut) && atMatches[atActiveIndex]) {
          e.preventDefault();
          applyAtCompletion(atMatches[atActiveIndex]);
          return;
        }
      }

      if (e.key === "ArrowUp" && !isComposing && !isStreaming && inputHistory.length > 0 && value.trim().length === 0) {
        e.preventDefault();
        setSlashMenuOpen(false);
        setAtMenuOpen(false);
        setHistoryActiveIndex(inputHistory.length - 1);
        setHistoryMenuOpen(true);
        return;
      }

      // Esc stops the agent when no slash/@/history menu or IME composition is active.
      if (e.key === "Escape" && !isComposing && isStreaming && onAbort && !aborting) {
        e.preventDefault();
        onAbort();
        return;
      }

      if (sendShortcut) {
        e.preventDefault();
        if (isStreaming && (onSteer || onFollowUp)) {
          // Default Enter sends as steer if available, else followup
          sendQueued(onSteer ? "steer" : "followup");
        } else {
          handleSend();
        }
      }
    },
    [aborting, isMobile, isStreaming, onSteer, onFollowUp, onAbort, slashMenuOpen, slashQuery, displayedSlashCommands, slashActiveIndex, applySlashCommand, sendQueued, handleSend, getNextSlashIndex, atMenuOpen, atQuery, atMatches, atActiveIndex, applyAtCompletion, historyMenuOpen, inputHistory, historyActiveIndex, applyHistoryInput, value]
  );

  const handleInput = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, COMPOSER_TEXTAREA_MAX_HEIGHT)}px`;
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageItems = items.filter((item) => item.type.startsWith("image/"));
    if (!imageItems.length) return;
    e.preventDefault();
    const files = imageItems.map((item) => item.getAsFile()).filter((f): f is File => f !== null);
    processImageFiles(files);
  }, [processImageFiles]);

  useEffect(() => {
    if (slashQuery === null) {
      setSlashMenuOpen(false);
      setSlashActiveIndex(0);
      slashCommandsRequestedRef.current = false;
      return;
    }
    setSlashMenuOpen(true);
    setSlashActiveIndex(0);
    if (!slashCommandsRequestedRef.current && onLoadSlashCommands) {
      slashCommandsRequestedRef.current = true;
      Promise.resolve(onLoadSlashCommands()).catch(() => {
        slashCommandsRequestedRef.current = false;
      });
    }
  }, [slashQuery, onLoadSlashCommands]);

  // Lazy-load skill dormancy (disable-model-invocation) each time the slash
  // palette opens, so toggles made in the skills panel are reflected on the
  // next open. Failures degrade silently to the unannotated palette.
  useEffect(() => {
    if (!slashMenuOpen || !cwd) return;
    const requestCwd = cwd;
    let cancelled = false;
    setSkillDormancyState({ cwd: requestCwd, values: {} });
    fetch(`/api/skills?cwd=${encodeURIComponent(requestCwd)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`skills fetch failed: ${res.status}`);
        return res.json() as Promise<Partial<SkillsResponse>>;
      })
      .then((data) => {
        if (cancelled) return;
        const dormancy: Record<string, boolean> = {};
        for (const skill of data.skills ?? []) dormancy[skill.name] = skill.disableModelInvocation;
        setSkillDormancyState({ cwd: requestCwd, values: dormancy });
      })
      .catch(() => {
        if (!cancelled) setSkillDormancyState({ cwd: requestCwd, values: {} });
      });
    return () => {
      cancelled = true;
    };
  }, [slashMenuOpen, cwd]);

  useEffect(() => {
    if (slashActiveIndex >= displayedSlashCommands.length) {
      setSlashActiveIndex(Math.max(0, displayedSlashCommands.length - 1));
    }
  }, [displayedSlashCommands.length, slashActiveIndex]);

  useEffect(() => {
    slashItemRefs.current.length = displayedSlashCommands.length;
  }, [displayedSlashCommands.length]);

  useEffect(() => {
    if (!slashMenuOpen) return;
    slashItemRefs.current[slashActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [slashActiveIndex, slashMenuOpen]);

  useLayoutEffect(() => {
    if (!slashMenuOpen || slashQuery === null) {
      setSlashMenuMaxHeight(null);
      return;
    }

    const menu = slashMenuRef.current;
    if (!menu) return;

    let frameId: number | null = null;
    const update = () => {
      frameId = null;
      const nextHeight = getUpwardMenuMaxHeight(
        menu.getBoundingClientRect().bottom,
        getVisibleTopBoundary(menu),
      );
      setSlashMenuMaxHeight((current) => current === nextHeight ? current : nextHeight);
    };
    const scheduleUpdate = () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(update);
    };

    update();
    const anchorObserver = typeof ResizeObserver === "undefined" || !menu.parentElement
      ? null
      : new ResizeObserver(scheduleUpdate);
    if (menu.parentElement) anchorObserver?.observe(menu.parentElement);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", scheduleUpdate);
    viewport?.addEventListener("scroll", scheduleUpdate);
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);

    return () => {
      anchorObserver?.disconnect();
      viewport?.removeEventListener("resize", scheduleUpdate);
      viewport?.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [slashMenuOpen, slashQuery]);

  // Build model options: prefer modelList (has provider info), fallback to modelNames
  const modelOptions: ModelOption[] = (() => {
    if (modelList && modelList.length > 0) {
      return modelList.map((m) => ({ provider: m.provider, modelId: m.id, name: m.name })).sort(compareModelOptions);
    }
    return Object.entries(modelNames ?? {}).map(([modelId, name]) => ({
      provider: model?.provider ?? "unknown",
      modelId,
      name,
    })).sort(compareModelOptions);
  })();
  const filteredModelOptions = filterModelOptions(modelOptions, modelFilter);
  const showModelFilter = modelOptions.length > MODEL_FILTER_THRESHOLD;

  // Group options by provider, preserving insertion order
  const modelsByProvider: { provider: string; options: ModelOption[] }[] = [];
  for (const opt of filteredModelOptions) {
    const group = modelsByProvider.find((g) => g.provider === opt.provider);
    if (group) group.options.push(opt);
    else modelsByProvider.push({ provider: opt.provider, options: [opt] });
  }

  const displayModelName = model
    ? (modelOptions.find((o) => o.modelId === model.modelId && o.provider === model.provider)?.name ?? model.modelId)
    : null;
  const currentName = displayModelName;

  const compactSavedTokens = compactResult
    ? Math.max(0, compactResult.tokensBefore - compactResult.estimatedTokensAfter)
    : 0;
  const compactResultText = compactResult
    ? `${compactResult.reason && compactResult.reason !== "manual" ? `${compactResult.reason[0].toUpperCase()}${compactResult.reason.slice(1)} ` : t("chat.compacted")} ${formatTokenCount(compactResult.tokensBefore)} -> ${formatTokenCount(compactResult.estimatedTokensAfter)} tokens (${t("chat.tokensSaved", { saved: formatTokenCount(compactSavedTokens) })})`
    : null;
  const thinkingDisplayLabel = (() => {
    const lvl = thinkingLevel ?? "auto";
    if (lvl === "auto" || !thinkingLevelMap) return lvl;
    return thinkingLevelMap[lvl] ?? lvl;
  })();
  const toolPresetLabel = Object.entries(TOOL_PRESET_MAP).find(([, v]) => v === (toolPreset ?? "default"))?.[0] ?? "default";

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        modelDropdownPanelRef.current && !modelDropdownPanelRef.current.contains(e.target as Node)
      ) {
        setModelDropdownOpen(false);
        setModelFilter("");
      }
      if (toolDropdownRef.current && !toolDropdownRef.current.contains(e.target as Node)) {
        setToolDropdownOpen(false);
      }
      if (thinkingDropdownRef.current && !thinkingDropdownRef.current.contains(e.target as Node)) {
        setThinkingDropdownOpen(false);
      }
      if (controlsMenuRef.current && !controlsMenuRef.current.contains(e.target as Node)) {
        setControlsMenuOpen(false);
      }
      if (historyMenuRef.current && !historyMenuRef.current.contains(e.target as Node) && !textareaRef.current?.contains(e.target as Node)) {
        setHistoryMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (!isMobile) setControlsMenuOpen(false);
  }, [isMobile]);



  return (
    <div className="composer-shell w-full shrink-0 px-4 pb-2 pr-[52px] max-md:pr-4 max-md:pb-[env(safe-area-inset-bottom)]">
      {/* Hidden file input */}
      <input
        className="hidden"
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          processImageFiles(files);
          e.target.value = "";
        }}
      />
      <div className="composer-width mx-auto w-full max-w-(--shell-composer-max-width)">
        <ModelErrorBanner error={modelError} />
        <ModelScopeWarningBanner warnings={modelScopeWarnings} />
        {/* Queued steering / follow-up messages (delivered by pi on upcoming turns) */}
        {((queuedMessages?.steering.length ?? 0) + (queuedMessages?.followUp.length ?? 0)) > 0 && (
          <div className="composer-notice composer-queue mb-2 rounded-md border border-(--border) bg-(--bg-panel) py-[5px]">
            <div className="flex items-center justify-between gap-2 pt-0.5 pr-2 pb-1 pl-2.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.4px] text-(--text-dim)">
                {t("chat.queued", { count: (queuedMessages?.steering.length ?? 0) + (queuedMessages?.followUp.length ?? 0) })}
              </span>
              {onRecallQueue && (
                <button
                  onClick={onRecallQueue}
                   title={t("chat.recallTitle")}
                  className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[7px] border border-(--border) bg-transparent px-3 py-1 text-xs text-(--text) transition-colors hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--border))] hover:bg-(--bg-hover)"
                >
                  <RotateCcw size={13} strokeWidth={2} aria-hidden="true" />
                   {t("chat.recall")}
                </button>
              )}
            </div>
            {queuedMessages?.steering.map((text, i) => (
              <QueuedMessageRow key={`steer-${i}`} kind="steer" text={text} />
            ))}
            {queuedMessages?.followUp.map((text, i) => (
              <QueuedMessageRow key={`followup-${i}`} kind="follow-up" text={text} />
            ))}
          </div>
        )}
        {/* Retry banner */}
        {retryInfo && (
          <div className="composer-notice is-retry mb-2 flex items-center gap-1.5 rounded-md border border-[rgba(234,179,8,0.25)] bg-[rgba(234,179,8,0.08)] px-2.5 py-[5px] text-xs text-[rgba(180,130,0,0.9)]" role="status">
            <RotateCcw size={12} strokeWidth={2} className="shrink-0" aria-hidden="true" />
             {t("chat.retrying", { attempt: retryInfo.attempt, max: retryInfo.maxAttempts })}{retryInfo.errorMessage && <span className="ml-1 opacity-70">— {retryInfo.errorMessage}</span>}
          </div>
        )}
        {compactResultText && (
          <div className="composer-notice mb-2 flex items-center gap-1.5 rounded-md border border-[rgba(16,185,129,0.24)] bg-[rgba(16,185,129,0.08)] px-2.5 py-[5px] text-xs text-[rgba(5,150,105,0.95)]" role="status">
            <CircleCheck size={12} strokeWidth={2} className="shrink-0" aria-hidden="true" />
            {compactResultText}
          </div>
        )}
        {compactError && (
          <div
            className="composer-notice mb-2 whitespace-pre-wrap rounded-md border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.07)] px-2.5 py-[7px] font-mono text-xs leading-[1.5] text-(--state-error) [overflow-wrap:anywhere]"
            role="alert"
          >
            {compactError}
          </div>
        )}
        {/* Image previews */}
        {attachedImages.length > 0 && (
          <div className="composer-attachments mb-1.5 flex min-w-0 flex-wrap gap-1.5">
            {attachedImages.map((img, i) => (
              <div key={i} className="relative shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.previewUrl}
                  alt=""
                  className="block size-14 rounded-md border border-(--border) object-cover"
                />
                <button
                  onClick={() => removeImage(i)}
                  className="absolute -top-1 -right-1 grid size-4 cursor-pointer place-items-center rounded-full border border-(--border) bg-(--bg-panel) p-0 text-(--text-muted)"
                >
                  <X size={9} strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Main input */}
        <div className="composer-card relative flex min-w-0 flex-col gap-3 rounded-[22px] border-0 bg-(--surface-elevated) pt-2 pb-0 shadow-[0_0_0_0.5px_var(--border),0_4px_16px_0_rgba(0,0,0,0.03),0_0_24px_0_rgba(0,0,0,0.03)]">
          {historyMenuOpen && inputHistory.length > 0 && (
            <div
              ref={historyMenuRef}
              className="composer-overlay composer-overlay-history absolute inset-x-0 bottom-[calc(100%+8px)] z-120 max-h-[min(44vh,360px)] overflow-hidden rounded-lg border border-(--border) bg-(--bg) shadow-[0_-6px_20px_rgba(0,0,0,0.12)]"
            >
              <div
                title="Input history"
                className="h-7.5 py-0 px-2.5 border-b border-(--border) flex items-center text-(--text-dim)"
              >
                <Undo2 size={14} strokeWidth={1.8} aria-hidden="true" />
              </div>
              <div className="max-h-[calc(min(44vh,360px)-31px)] overflow-y-auto p-1">
                {inputHistory.map((item, index) => {
                  const active = index === historyActiveIndex;
                  return (
                    <button
                      key={`${index}:${item}`}
                      ref={(node) => {
                        historyItemRefs.current[index] = node;
                      }}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applyHistoryInput(item);
                      }}
                      onMouseEnter={() => setHistoryActiveIndex(index)}
                      className={`flex w-full cursor-pointer items-start gap-2 rounded-md border-none px-2 py-1.75 text-left text-[12.5px] leading-[1.45] text-(--text) ${active ? "bg-(--bg-selected)" : "bg-transparent"}`}
                    >
                      <span className="shrink-0 font-mono text-[11px] text-(--text-dim) pt-px">
                        {index + 1}
                      </span>
                      <span className="line-clamp-2 min-w-0 overflow-hidden wrap-anywhere">
                        {item}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {slashMenuOpen && slashQuery !== null && (
            <div
              ref={slashMenuRef}
              className="composer-overlay composer-overlay-slash absolute inset-x-0 bottom-[calc(100%+8px)] z-120 box-border flex flex-col overflow-hidden rounded-lg border border-(--border) bg-(--bg) max-h-[min(72.8vh,598px,var(--slash-menu-max-h,9999px))] shadow-[0_-6px_20px_rgba(0,0,0,0.12)]"
              style={
                { "--slash-menu-max-h": `${slashMenuMaxHeight ?? 9999}px` } as React.CSSProperties
              }
            >
              <div
                className="py-2 px-2.5 border-b border-(--border) flex items-center justify-between gap-2 text-[11px] text-(--text-dim) shrink-0"
              >
                 <span>{slashCommandsLoading ? t("chat.loadingCommands") : t("chat.slashCommands", { label: slashCommandCountLabel })}</span>
                 <span className="font-mono">{t("chat.tabEnter")}</span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
                {!slashCommandsLoading && filteredSlashCommands.length === 0 ? (
                  <div className="pt-0.5 px-0.5 pb-1 text-xs text-(--text-dim)">
                     {t("chat.noCommands")}
                  </div>
                ) : (
                  groupedSlashCommands.map((group) => (
                    <section key={group.source} className="mb-3">
                      <div
                        className="sticky -top-2.5 z-1 flex items-center justify-between gap-2 bg-(--bg) pt-1 pb-1.5 text-[10px] font-semibold uppercase text-(--text-dim)"
                      >
                           <span>{t(SLASH_SOURCE_GROUP_LABEL_KEYS[group.source])}</span>
                        <span className="font-mono">{group.items.length}</span>
                      </div>
                      <div
                        className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2"
                      >
                        {group.items.map(({ command, index }) => {
                          const active = index === slashActiveIndex;
                          const dormant = isDormantSkillCommand(command, skillDormancy);
                          return (
                            <button
                              key={`${command.source}:${command.name}`}
                              ref={(node) => {
                                slashItemRefs.current[index] = node;
                              }}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                applySlashCommand(command);
                              }}
                              onMouseEnter={() => setSlashActiveIndex(index)}
                              className={`flex min-h-14.5 w-full min-w-0 cursor-pointer flex-col justify-center gap-1 rounded-[7px] px-2.5 py-2.25 text-left text-(--text) ${active ? "border border-(--accent) bg-(--bg-selected) shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent)_28%,transparent)]" : "border border-(--border) bg-(--bg-panel)"}`}
                            >
                              <span className={`font-mono text-[13px] wrap-anywhere ${dormant ? "text-(--text-dim)" : ""}`}>
                                /{command.name}
                                {dormant && (
                                  <span className="ml-1.5 py-0 px-1 border border-(--border) rounded-[3px] text-[10px] text-(--text-dim) whitespace-nowrap">
                                    {t("chat.dormant")}
                                  </span>
                                )}
                              </span>
                               {command.description && (
                                <span className="line-clamp-2 text-[11px] leading-[1.35] text-(--text-dim)">
                                   {getSlashDescription(command, t)}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))
                )}
              </div>
            </div>
          )}
          {atMenuOpen && atQuery !== null && (() => {
            const indexLoading = fileIndexLoading && (!fileIndex || fileIndex.cwd !== cwd);
             const matchCountLabel = atMatches.length === 1 ? t("chat.match") : t("chat.matches", { count: atMatches.length });
            // With a truncated index, local results are provisional — the
            // debounced server search over the full listing replaces them.
            const truncatedHint = fileIndex?.truncated && !serverResultInUse
               ? (atQuery.query ? t("chat.searchingAll") : t("chat.indexTruncated"))
              : "";
            return (
              <div
                className="composer-overlay composer-overlay-at absolute inset-x-0 bottom-[calc(100%+8px)] z-120 max-h-[min(48vh,400px)] overflow-hidden rounded-lg border border-(--border) bg-(--bg) shadow-[0_-6px_20px_rgba(0,0,0,0.12)]"
              >
                <div
                  className="py-2 px-2.5 border-b border-(--border) flex items-center justify-between gap-2 text-[11px] text-(--text-dim)"
                >
                  <span>
                    {indexLoading
                       ? t("chat.loadingFiles")
                       : t("chat.files", { label: matchCountLabel, hint: truncatedHint })}
                  </span>
                   <span className="font-mono">{t("chat.tabEnter")}</span>
                </div>
                <div className="max-h-[calc(min(48vh,400px)-34px)] overflow-y-auto p-1">
                  {!indexLoading && atMatches.length === 0 ? (
                    <div className="py-1.5 px-2 text-xs text-(--text-dim)">
                       {needsServerSearch && !serverResultInUse ? t("chat.searching") : t("chat.noMatchingFiles")}
                    </div>
                  ) : (
                    atMatches.map((entry, index) => {
                      const active = index === atActiveIndex;
                      const name = entry.path.split("/").pop() ?? entry.path;
                      const dirPrefix = entry.path.slice(0, entry.path.length - name.length);
                      return (
                        <button
                          key={`${entry.isDir ? "d" : "f"}:${entry.path}`}
                          ref={(node) => {
                            atItemRefs.current[index] = node;
                          }}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            applyAtCompletion(entry);
                          }}
                          onMouseEnter={() => setAtActiveIndex(index)}
                          className={`flex w-full cursor-pointer items-center gap-2 rounded-md border-none px-2 py-1.5 text-left font-mono text-[12.5px] text-(--text) ${active ? "bg-(--bg-selected)" : "bg-transparent"}`}
                        >
                          <span className="shrink-0 flex items-center">
                            {entry.isDir ? <FolderIcon size={14} /> : getFileIcon(name, 14)}
                          </span>
                          <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                            {dirPrefix && <span className="text-(--text-dim)">{dirPrefix}</span>}
                            {name}
                            {entry.isDir && <span className="text-(--text-dim)">/</span>}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })()}
          <div className="composer-input-row flex min-w-0 flex-col">
          <textarea
            ref={textareaRef}
            className={`composer-textarea mr-1 min-w-0 w-full resize-none border-0 bg-transparent text-(--text) text-[14px] leading-6 max-h-84 overflow-y-auto p-0 pt-1 pr-2 pb-0 pl-3.5 caret-(--accent) outline-none focus:outline-none focus-visible:outline-none! max-md:max-h-60 ${isNewSession ? "min-h-13" : "min-h-9"}`}
            value={value}
            onChange={(e) => {
              valueRef.current = e.target.value;
              setValue(e.target.value);
              setHistoryMenuOpen(false);
              updateAtQuery(e.target.value, e.target.selectionStart);
            }}
            onSelect={(e) => {
              const el = e.currentTarget;
              updateAtQuery(el.value, el.selectionStart);
            }}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={(e) => {
              isComposingRef.current = false;
              lastCompositionEndAtRef.current = Date.now();
              const el = e.currentTarget;
              updateAtQuery(el.value, el.selectionStart);
            }}
            onInput={handleInput}
            onPaste={handlePaste}
            placeholder={
              isStreaming && (onSteer || onFollowUp)
                ? t("chat.steerPlaceholder")
                : isStreaming ? t("chat.agentPlaceholder")
                : isNewSession ? "Describe what you want to build"
                : t("chat.messagePlaceholder")
            }
            rows={1}

          />
          </div>

        {/* Bash mode status label */}
        {bashMode && (
          <div className={`composer-mode-status mt-1 px-2 py-1 text-xs ${bashExcluded ? "text-(--text-muted)" : "text-(--accent)"}`}>
             {t("chat.shell")} · {bashExcluded ? t("chat.outputLocal") : t("chat.outputModel")}
          </div>
        )}

        {/* Bottom bar: left | center (context) | right */}
        <div className="composer-toolbar flex flex-wrap items-center justify-between gap-3 px-2 pt-0.5 pb-1.5 max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto]">

          {/* LEFT: attach + model selector (idle) or steer/followup toggle (streaming) */}
          <div className={`composer-toolbar-left flex min-w-0 items-center gap-3 ${isMobile ? "flex-1" : "flex-none"}`}>
            <button
              type="button"
              className="composer-command-trigger grid size-7 shrink-0 place-items-center rounded-full border-0 bg-(--surface-overlay) text-(--text) transition-colors hover:bg-(--bg-selected)"
              onClick={() => {
                // ponytail: DeepSeek opens a caret-anchored menu without touching the
                // draft; we reuse the existing slash palette by seeding "/". Swap for a
                // real overlay if the draft mutation ever bites.
                const next = value.startsWith("/") ? value : `/${value}`;
                valueRef.current = next;
                setValue(next);
                setHistoryMenuOpen(false);
                setAtQuery(null);
                requestAnimationFrame(() => {
                  const ta = textareaRef.current;
                  if (!ta) return;
                  ta.focus();
                  ta.setSelectionRange(1, 1);
                  ta.style.height = "auto";
                  ta.style.height = `${Math.min(ta.scrollHeight, COMPOSER_TEXTAREA_MAX_HEIGHT)}px`;
                });
              }}
              title={t("chat.openCommands")}
              aria-label={t("chat.openCommands")}
            >
              <Plus size={15} strokeWidth={2} aria-hidden="true" />
            </button>
            <button
              className={`composer-attach-trigger grid size-7 shrink-0 place-items-center rounded-full border-0 bg-(--surface-overlay) transition-colors hover:bg-(--bg-selected) ${attachedImages.length ? "text-(--accent)" : "text-(--text) hover:text-(--text)"}`}
              onClick={() => fileInputRef.current?.click()}
             title={t("chat.attachImage")}
            >
              <Paperclip size={15} strokeWidth={1.8} aria-hidden="true" />
            </button>
            {/* Model selector — visible always, disabled while the session or switch is busy */}
            {(modelOptions.length > 0 || currentName || modelError) && onModelChange && (
                <div ref={dropdownRef} className={`relative min-w-0 ${isMobile ? "flex-1" : ""}`}>
                  <button
                    className={`composer-model-trigger flex h-7 min-w-0 items-center gap-1.5 overflow-hidden rounded-lg border-none text-[13px] leading-5 font-medium text-(--text-muted) transition-colors hover:bg-(--bg-hover) hover:text-(--text) disabled:cursor-not-allowed disabled:opacity-50 ${isMobile ? "w-full max-w-full justify-start px-2.5" : "max-w-[220px] px-3"} ${modelDropdownOpen ? "bg-(--bg-hover)" : "bg-transparent"}`}
                    onClick={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setModelDropdownRect({ top: rect.top, left: rect.left, width: rect.width });
                      setModelDropdownOpen((open) => {
                        if (open) setModelFilter("");
                        return !open;
                      });
                    }}
                    disabled={isStreaming || modelSwitching}
                    aria-busy={modelSwitching || undefined}
                    title={modelSwitching ? "Switching model" : modelOptions.length > 0 ? "Change model" : "No available models"}
                  >
                    {modelSwitching && <PiLoader size={13} />}
                    <span className="overflow-hidden text-ellipsis whitespace-nowrap min-w-0">
                      {currentName ?? (modelOptions.length > 0 ? "Select model" : "No models")}
                    </span>
                    {thinkingLevel && thinkingLevel !== "auto" && (
                      <span className="shrink-0 text-(--text-dim)">{thinkingDisplayLabel}</span>
                    )}
                    {!isMobile && <ChevronDown size={12} strokeWidth={2} className="shrink-0 opacity-60" aria-hidden="true" />}
                  </button>
                  {modelDropdownOpen && modelDropdownRect && (() => {
                    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
                    const bottom = viewportHeight - modelDropdownRect.top + 6;
                    const maxH = Math.max(120, Math.min(modelDropdownRect.top - 8, viewportHeight * 0.6));
                    // On mobile, pin to a small left margin and cap width to the
                    // viewport so long model names never push the panel off-screen.
                    const panelPos: React.CSSProperties = isMobile
                      ? { left: 8, right: 8, maxWidth: "calc(100vw - 16px)" }
                      : { left: modelDropdownRect.left, width: "max-content", minWidth: modelDropdownRect.width };
                    return (
                      <div ref={modelDropdownPanelRef} className="fixed z-500 flex flex-col overflow-hidden rounded-lg border border-(--border) bg-(--bg) shadow-[0_-4px_16px_rgba(0,0,0,0.10)]" style={{ bottom, ...panelPos, maxHeight: maxH }}>
                      {showModelFilter && (
                        <div className="py-1.5 px-2 border-b border-(--border) shrink-0">
                          <input
                            value={modelFilter}
                            onChange={(e) => setModelFilter(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") {
                                setModelFilter("");
                                setModelDropdownOpen(false);
                              }
                            }}
                            placeholder={t("chat.filterModels")}
                            aria-label={t("chat.filterModels")}
                            autoFocus
                            autoComplete="off"
                            spellCheck={false}
                            className={`box-border w-full rounded-[5px] border border-(--border) bg-(--bg) px-2 py-1.25 font-mono text-[11px] text-(--text) outline-none! ${isMobile ? "min-w-0" : "min-w-[220px]"}`}
                          />
                        </div>
                      )}
                      <div className="min-h-0 overflow-y-auto">
                        {modelsByProvider.length === 0 ? (
                          <div className="py-2 px-3 text-(--text-dim) text-xs whitespace-nowrap">
                            {modelFilter.trim() ? t("chat.noMatchingModels") : "No available models"}
                          </div>
                        ) : modelsByProvider.map((group, gi) => (
                          <div key={group.provider}>
                            {(modelsByProvider.length > 1) && (
                              <div className={`pt-1.5 px-3 pb-1 text-[10px] font-semibold text-(--text-dim) uppercase tracking-[0.07em] ${gi > 0 ? "border-t border-(--border)" : "border-t-0"}`}>
                                {group.provider}
                              </div>
                            )}
                            {group.options.map((opt) => {
                              const isActive = opt.modelId === model?.modelId && opt.provider === model?.provider;
                              return (
                                <button
                                  key={`${opt.provider}:${opt.modelId}`}
                                  onClick={() => {
                                    setModelDropdownOpen(false);
                                    setModelFilter("");
                                    if (!isActive || isAutoModelSelection) onModelChange(opt.provider, opt.modelId);
                                  }}
                                  className={`flex items-center gap-2 w-full py-1.75 px-3 border-none cursor-pointer text-xs text-left whitespace-nowrap hover:bg-(--bg-hover) ${isActive ? "bg-(--bg-selected)" : "bg-transparent"} ${isActive ? "text-(--text)" : "text-(--text-muted)"} ${isActive ? "font-semibold" : ""}`}
                                >
                                  {isActive
                                    ? <Check size={11} strokeWidth={2.5} className="text-(--accent) shrink-0" aria-hidden="true" />
                                    : <span className="w-2.75 shrink-0" />}
                                  {opt.name}
                                </button>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                    );
                  })()}
                </div>
            )}
          </div>

          {/* spacer */}
          {!isMobile && <div className="composer-toolbar-spacer flex-1" />}

          {/* RIGHT: thinking + tools preset + compact + sound (idle) | Stop + sound (streaming) */}
          <div ref={controlsMenuRef} className={`composer-toolbar-right relative flex min-w-0 flex-none items-center justify-end gap-3 ${isMobile ? "" : "ml-auto"}`}>
            {isMobile && (
              <button
                type="button"
                 title={controlsMenuOpen ? undefined : t("chat.moreControls")}
                 aria-label={t("chat.moreControls")}
                aria-expanded={controlsMenuOpen}
                aria-hidden={controlsMenuOpen || undefined}
                tabIndex={controlsMenuOpen ? -1 : undefined}
                onClick={() => {
                  setModelDropdownOpen(false);
                  setModelFilter("");
                  setControlsMenuOpen(true);
                }}
                className={`composer-more-trigger flex h-7 w-full items-center justify-center rounded-lg border-none bg-transparent px-2 text-[13px] leading-5 font-medium text-(--text-muted) transition-colors hover:bg-(--bg-hover) hover:text-(--text) ${controlsMenuOpen ? "pointer-events-none invisible cursor-default" : "cursor-pointer"}`}
              >
                {t("chat.moreControls")}
              </button>
            )}
            <div className={isMobile
              ? `absolute right-0 bottom-0 z-60 w-max max-w-[calc(100vw-32px)] flex-nowrap items-center justify-end gap-1 rounded-[10px] border border-[color-mix(in_srgb,var(--border)_72%,transparent)] bg-[color-mix(in_srgb,var(--bg-panel)_92%,var(--bg))] p-px shadow-[0_8px_24px_rgba(0,0,0,0.14)] backdrop-blur-[10px] ${controlsMenuOpen ? "flex" : "hidden"}`
              : "flex items-center gap-3"}>
            {!isStreaming && onThinkingLevelChange && (
              <div ref={thinkingDropdownRef} className="relative">
                <button
                  onClick={() => !isStreaming && setThinkingDropdownOpen((v) => !v)}
                  disabled={isStreaming}
                   title={t("chat.changeReasoning", { level: thinkingDisplayLabel })}
                   aria-label={t("chat.changeReasoningLabel")}
                  className={`composer-thinking-trigger flex h-7 items-center justify-center gap-1.5 rounded-lg border-none text-[13px] leading-5 font-medium text-(--text-muted) transition-colors hover:bg-(--bg-hover) hover:text-(--text) disabled:cursor-not-allowed disabled:opacity-50 ${isMobile ? "px-1.5" : "px-3"} ${thinkingDropdownOpen ? "bg-(--bg-hover)" : "bg-transparent"}`}
                >
                  <BrainCircuit size={12} strokeWidth={2} aria-hidden="true" />
                  {(!isMobile || controlsMenuOpen) && <span className="whitespace-nowrap">{thinkingDisplayLabel}</span>}
                </button>
                {thinkingDropdownOpen && (
                  <div className={`absolute bottom-[calc(100%+6px)] z-100 min-w-45 overflow-hidden rounded-lg border border-(--border) bg-(--bg) shadow-[0_-4px_16px_rgba(0,0,0,0.10)] ${isMobile ? "left-0" : "right-0"}`}>
                    {THINKING_LEVELS.filter((lvl) => {
                      if (!availableThinkingLevels) return true;
                      if (lvl === "auto") return true;
                      return availableThinkingLevels.includes(lvl);
                    }).map((lvl) => {
                      const isActive = (thinkingLevel ?? "auto") === lvl;
                       const desc = t(THINKING_LEVEL_DESC_KEYS[lvl]);
                      const mappedVal = (lvl !== "auto" && thinkingLevelMap) ? thinkingLevelMap[lvl] : undefined;
                      const displayLabel = (mappedVal != null && mappedVal !== lvl) ? mappedVal : lvl;
                      const showOriginal = mappedVal != null && mappedVal !== lvl;
                      return (
                        <button
                          key={lvl}
                          onClick={() => { setThinkingDropdownOpen(false); if (!isActive) onThinkingLevelChange(lvl); }}
                          className={`flex items-center gap-2 w-full py-1.75 px-3 border-none cursor-pointer text-xs text-left whitespace-nowrap hover:bg-(--bg-hover) ${isActive ? "bg-(--bg-selected)" : "bg-transparent"} ${isActive ? "text-(--text)" : "text-(--text-muted)"} ${isActive ? "font-semibold" : ""}`}
                        >
                          {isActive
                            ? <Check size={11} strokeWidth={2.5} className="text-(--accent) shrink-0" aria-hidden="true" />
                            : <span className="w-2.75 shrink-0" />}
                          <span className="flex-1">
                            {displayLabel}
                            {showOriginal && <span className="text-[10px] text-(--text-dim) font-mono ml-1.25">({lvl})</span>}
                          </span>
                          <span className="text-[11px] text-(--text-dim) ml-2">{desc}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {!isStreaming && onToolPresetChange && (
              <div ref={toolDropdownRef} className="relative">
                <button
                  onClick={() => !isStreaming && setToolDropdownOpen((v) => !v)}
                  disabled={isStreaming}
                   title={t("chat.changeToolPreset") + `: ${toolPresetLabel}`}
                   aria-label={t("chat.changeToolPreset")}
                  className={`composer-tool-trigger flex h-7 items-center justify-center gap-1.5 rounded-lg border-none text-[13px] leading-5 font-medium text-(--text-muted) transition-colors hover:bg-(--bg-hover) hover:text-(--text) disabled:cursor-not-allowed disabled:opacity-50 ${isMobile ? "px-1.5" : "px-3"} ${toolDropdownOpen ? "bg-(--bg-hover)" : "bg-transparent"}`}
                >
                  <Shield size={13} strokeWidth={1.8} aria-hidden="true" />
                  {(!isMobile || controlsMenuOpen) && <span className="whitespace-nowrap">{toolPresetLabel}</span>}
                  {(!isMobile || controlsMenuOpen) && <ChevronDown size={12} strokeWidth={2} className="shrink-0 opacity-60" aria-hidden="true" />}
                </button>
                {toolDropdownOpen && (
                  <div className={`absolute bottom-[calc(100%+6px)] z-100 min-w-30 overflow-hidden rounded-lg border border-(--border) bg-(--bg) shadow-[0_-4px_16px_rgba(0,0,0,0.10)] ${isMobile ? "left-0" : "right-0"}`}>
                    {TOOL_PRESETS.map((lvl) => {
                      const preset = TOOL_PRESET_MAP[lvl];
                      const isActive = (toolPreset ?? "default") === preset;
                      let desc: string;
                      if (lvl === "off") desc = t("chat.noTools");
                      else if (lvl === "read-only") desc = t("chat.readOnlyTools", { count: 4 });
                      else if (lvl === "default") desc = t("chat.builtInTools", { count: 4 });
                      else desc = t("chat.allBuiltInTools");
                      return (
                        <button
                          key={lvl}
                          onClick={() => { setToolDropdownOpen(false); if (!isActive) onToolPresetChange(preset); }}
                          className={`flex items-center gap-2 w-full py-1.75 px-3 border-none cursor-pointer text-xs text-left whitespace-nowrap hover:bg-(--bg-hover) ${isActive ? "bg-(--bg-selected)" : "bg-transparent"} ${isActive ? "text-(--text)" : "text-(--text-muted)"} ${isActive ? "font-semibold" : ""}`}
                        >
                          {isActive
                            ? <Check size={11} strokeWidth={2.5} className="text-(--accent) shrink-0" aria-hidden="true" />
                            : <span className="w-2.75 shrink-0" />}
                          <span className="flex-1">{lvl}</span>
                          <span className="text-[11px] text-(--text-dim) ml-2">{desc}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {!isStreaming && onCompact && (
              <div>
                <button
                  onClick={isCompacting ? onAbortCompaction : onCompact}
                  disabled={isStreaming && !isCompacting}
                  className={`composer-compact-trigger flex h-7 items-center justify-center gap-1.5 rounded-lg border-none text-[13px] leading-5 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${isMobile ? "px-1.5" : "px-3"} ${isCompacting ? "bg-[rgba(239,68,68,0.08)] text-(--state-error) hover:bg-[rgba(239,68,68,0.16)]" : "bg-transparent text-(--text-muted) hover:bg-(--bg-hover) hover:text-(--text)"}`}
                   title={isCompacting ? t("chat.stopCompaction") : t("chat.compactContext")}
                   aria-label={isCompacting ? t("chat.stopCompaction") : t("chat.compactContext")}
                >
                  {isCompacting ? (
                    <><Square size={10} fill="currentColor" strokeWidth={0} aria-hidden="true" />{(!isMobile || controlsMenuOpen) && <span className="whitespace-nowrap">{t("chat.compacting")}</span>}</>
                  ) : (
                    <><Shrink size={12} strokeWidth={2} aria-hidden="true" />{(!isMobile || controlsMenuOpen) && <span className="whitespace-nowrap">{t("chat.compact")}</span>}</>
                  )}
                </button>
              </div>
            )}

            {isStreaming && (
              <button
                className="composer-stop grid size-[34px] shrink-0 place-items-center rounded-full border-0 bg-(--accent) text-white transition-colors hover:bg-(--accent-hover) disabled:cursor-progress disabled:opacity-70"
                aria-label={t("chat.stopAgent")}
                onClick={aborting ? undefined : onAbort}
                 title={aborting ? t("chat.stopping") : t("chat.stopAgent")}
                disabled={aborting}
              >
                {aborting ? (
                  <PiLoader size={16} />
                ) : (
                  <Square size={11} fill="currentColor" strokeWidth={0} aria-hidden="true" />
                )}
                <span className="sr-only">{aborting ? t("chat.stopping") : t("chat.stop")}</span>
              </button>
            )}

            {onSoundToggle !== undefined && (
              <button
                onClick={onSoundToggle}
                 title={soundEnabled ? t("chat.disableSound") : t("chat.enableSound")}
                 aria-label={soundEnabled ? t("chat.disableSound") : t("chat.enableSound")}
                className={`composer-sound-trigger flex size-7 cursor-pointer items-center justify-center gap-1.5 rounded-lg border-none bg-transparent transition-[background,color,opacity] hover:bg-(--bg-hover) hover:text-(--text) hover:opacity-100 ${soundEnabled ? "text-(--text-muted)" : "text-(--text-dim) opacity-55"}`}
              >
                {soundEnabled ? (
                  <Volume2 size={13} strokeWidth={2} aria-hidden="true" />
                ) : (
                  <VolumeX size={13} strokeWidth={2} aria-hidden="true" />
                )}
              </button>
            )}
            {isMobile && controlsMenuOpen && (
              <button
                className="composer-collapse-trigger flex h-7 w-9 cursor-pointer items-center justify-center border-l border-l-[color-mix(in_srgb,var(--border)_72%,transparent)] bg-(--bg-hover) text-(--text) transition-colors hover:bg-(--bg-selected)"
                type="button"
                 title={t("chat.collapseControls")}
                 aria-label={t("chat.collapseControls")}
                aria-expanded={true}
                onClick={() => {
                  setToolDropdownOpen(false);
                  setThinkingDropdownOpen(false);
                  setControlsMenuOpen(false);
                }}
              >
                <X size={13} strokeWidth={2} aria-hidden="true" />
              </button>
            )}
            </div>

            {isStreaming ? (
              <div className="composer-stream-actions flex shrink-0 items-center justify-end gap-1">
                {onSteer && (
                  <button
                    className="composer-action composer-steer inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-transparent text-(--text-muted) transition-colors hover:bg-(--bg-hover) hover:text-(--text) disabled:cursor-not-allowed disabled:opacity-35"
                    onClick={() => sendQueued("steer")}
                    disabled={!canQueueStreamingMessage}
                    title="Interrupt the current run and inject this message now"
                  >
                    <ArrowRight size={14} strokeWidth={2.2} aria-hidden="true" />
                    <span className="sr-only">{t("chat.steer")}</span>
                  </button>
                )}
                {onFollowUp && (
                  <button
                    className="composer-action composer-follow-up inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-transparent text-(--text-muted) transition-colors hover:bg-(--bg-hover) hover:text-(--text) disabled:cursor-not-allowed disabled:opacity-35"
                    onClick={() => sendQueued("followup")}
                    disabled={!canQueueStreamingMessage}
                    title="Queue this message after the agent finishes"
                  >
                    <ArrowUp size={14} strokeWidth={2.2} aria-hidden="true" />
                    <span className="sr-only">{t("chat.followUp")}</span>
                  </button>
                )}
              </div>
            ) : (
              <button
                className={`composer-send grid size-[34px] shrink-0 place-items-center rounded-full border-0 bg-(--accent) text-white transition-colors ${(value.trim() || attachedImages.length) ? "cursor-pointer hover:bg-(--accent-hover)" : "cursor-not-allowed opacity-40"}`}
                aria-label={t("chat.send")}
                onClick={handleSend}
                disabled={!value.trim() && !attachedImages.length}
              >
                <ArrowUp size={15} strokeWidth={2.4} aria-hidden="true" />
                <span className="sr-only">{t("chat.send")}</span>
              </button>
            )}
          </div>

        </div>
        </div>
      </div>
    </div>
  );
});
