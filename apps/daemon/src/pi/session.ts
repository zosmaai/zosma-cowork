/**
 * Pi native session wrapper for the daemon (ZOS-93 + ZOS-95).
 *
 * Wraps a native Pi {@link AgentSession} behind the shapes the daemon needs:
 * prompt streaming (with steer/follow-up + base64 attachments), abort, queue
 * clear, close, and the advanced-control command surface (`get_state`,
 * `set_model`, thinking/tools, compaction, bash, reload, fork, extension UI).
 *
 * The SDK's AgentSession already implements every control; this wrapper only
 * ports the RPC semantics from `web/packages/pi-backend` (serialized prompt,
 * busy guards, result shapes) and drops web-only glue (extension custom-UI
 * widget *rendering*, project trust, model caches). Extension UI requests are
 * surfaced as `status` normalized events and answered via the
 * `extension_ui_response` command.
 */
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { NormalizedEvent, Turn } from "@zosma-cowork/protocol";
import { randomUUID } from "node:crypto";
import { mapPiEvent, SeqCounter } from "./mapping.ts";
import { generateSessionTitle } from "./title.ts";

export type PiTurnMode = "agent" | "thinking" | "steer" | "follow_up";

export interface PiTurnInput {
  text: string;
  mode?: PiTurnMode;
  cid?: string;
  /** Base64 image attachments — Pi-native shape, validated at the boundary. */
  images?: Turn["images"];
}

/** An advanced-control command, `type`-dispatched against the SDK session. */
export interface PiCommand {
  type: string;
  [key: string]: unknown;
}

/** The SDK's thinking-level union (pi-agent-core). */
type SdkThinkingLevel = Parameters<AgentSession["setThinkingLevel"]>[0];

const MAX_IMAGES = 10;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Boundary validator for prompt/steer/follow-up image attachments. */
export function validateImages(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) return "images must be an array";
  if (value.length > MAX_IMAGES) return `A message can include at most ${MAX_IMAGES} images`;
  for (const image of value) {
    if (!image || typeof image !== "object" || (image as { type?: unknown }).type !== "image") {
      return "Each attachment must be an image";
    }
    const data = (image as { data?: unknown }).data;
    const mimeType = (image as { mimeType?: unknown }).mimeType;
    if (typeof data !== "string" || typeof mimeType !== "string" || !mimeType.startsWith("image/")) {
      return "Each attachment must be valid image data";
    }
    if (data.length % 4 !== 0) return "Each image must be valid base64 image data";
    const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
    const bytes = (data.length / 4) * 3 - padding;
    if (bytes > MAX_IMAGE_BYTES) return `Each image must be ${MAX_IMAGE_BYTES / (1024 * 1024)}MB or smaller`;
  }
  return null;
}

interface PendingUi {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * One live Pi session. `run()` follows the SDK's preflight contract: it only
 * resolves after the turn is fully acknowledged, and streams normalized events
 * for every native event observed until an `end` (or `error`) frame.
 * `command()` dispatches the advanced-control surface directly to the SDK.
 */
export class PiSession {
  private seq = new SeqCounter();
  private alive = true;
  private promptRunning = false;
  private listeners: Array<(event: NormalizedEvent) => void> = [];
  private pendingUi = new Map<string, PendingUi>();
  readonly inner: AgentSession;
  readonly sessionId: string;
  private readonly onClose: () => void;

  constructor(
    inner: AgentSession,
    sessionId: string,
    onClose: () => void = () => {},
  ) {
    this.inner = inner;
    this.sessionId = sessionId;
    this.onClose = onClose;
    this.bindUiContext();
  }

  /** Native session id (never leaks into normalized payloads). */
  get nativeSessionId(): string {
    return this.inner.sessionId;
  }
  get sessionFile(): string | undefined {
    return this.inner.sessionFile;
  }
  get cwd(): string {
    return this.inner.sessionManager.getCwd();
  }
  isAlive(): boolean {
    return this.alive && !this.inner.isStreaming;
  }

  /** Subscribe to normalized events for this session. */
  onEvent(listener: (event: NormalizedEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }

  private emit(event: NormalizedEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* listener failures never break the session */
      }
    }
  }

  /** Resilient access to the SDK extension runner (absent on stripped sessions). */
  private extensionRunner(): { setUIContext?: (ctx: unknown, mode: string) => void } | undefined {
    return (this.inner as unknown as { extensionRunner?: { setUIContext?: (ctx: unknown, mode: string) => void } }).extensionRunner;
  }

  /** Bind a headless UI context so extension select/confirm/input/notify route through events. */
  private bindUiContext(): void {
    try {
      this.extensionRunner()?.setUIContext?.(this.createUiContext(), "rpc");
    } catch {
      /* extension UI binding must never break session creation */
    }
  }

  private emitUi(request: Record<string, unknown>): void {
    this.emit({
      cid: randomUUID(),
      seq: this.seq.nextSeq(),
      kind: "status",
      payload: { phase: "extension_ui_request", ...request },
    });
  }

  private requestUi(
    request: Record<string, unknown>,
    resolveValue: (response: Record<string, unknown>) => unknown,
  ): Promise<unknown> {
    const id = randomUUID();
    const timeoutMs = typeof request.timeout === "number" ? request.timeout : undefined;
    return new Promise((resolve, reject) => {
      this.pendingUi.set(id, {
        resolve: (value) => resolve(resolveValue(value as Record<string, unknown>)),
        reject,
      });
      this.emitUi({ ...request, id });
      if (timeoutMs) {
        setTimeout(() => {
          const pending = this.pendingUi.get(id);
          if (pending) {
            this.pendingUi.delete(id);
            pending.reject(new Error(`extension UI request timed out: ${String(request.method)}`));
          }
        }, timeoutMs);
      }
    });
  }

  /** Headless extension UI context — requests surface as events, answers resolve them. */
  private createUiContext(): Record<string, unknown> {
    const ctx: Record<string, unknown> = {
      select: (title: string, options: string[], opts?: { timeout?: number }) =>
        this.requestUi({ method: "select", title, options, ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
          (r) => ("value" in r ? r.value : undefined)),
      confirm: (title: string, message: string, opts?: { timeout?: number }) =>
        this.requestUi({ method: "confirm", title, message, ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
          (r) => ("confirmed" in r ? r.confirmed : false)),
      input: (title: string, placeholder?: string, opts?: { timeout?: number }) =>
        this.requestUi({ method: "input", title, ...(placeholder !== undefined ? { placeholder } : {}), ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
          (r) => ("value" in r ? r.value : undefined)),
      editor: (title: string, prefill?: string, opts?: { timeout?: number }) =>
        this.requestUi({ method: "editor", title, ...(prefill !== undefined ? { prefill } : {}), ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
          (r) => ("value" in r ? r.value : undefined)),
      notify: (message: string, type: string) => this.emitUi({ method: "notify", message, notifyType: type }),
      onTerminalInput: () => () => {},
      setStatus: (key: string, text: string | undefined) => this.emitUi({ method: "setStatus", statusKey: key, statusText: text }),
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
      setHiddenThinkingLabel: () => {},
      setWidget: () => {},
      clearWidget: () => {},
      getGlobalState: () => null,
    };
    return ctx;
  }

  /** Send a turn and wait until the agent settles; returns the event stream. */
  async run(input: PiTurnInput): Promise<NormalizedEvent[]> {
    if (!this.alive) throw new Error("session is not alive");
    const cid = input.cid ?? randomUUID();
    const events: NormalizedEvent[] = [];

    const imageError = validateImages(input.images);
    if (imageError) throw new Error(imageError);

    const push = (native: AgentSessionEvent): void => {
      const mapped = mapPiEvent(native as unknown as { type: string }, cid, this.seq.nextSeq());
      if (!mapped) return;
      events.push(mapped);
      this.emit(mapped);
    };

    const unsubscribe = this.inner.subscribe(push);
    this.promptRunning = true;
    try {
      const images = input.images;
      const terminal = input.mode === "steer"
        ? this.inner.steer(input.text, images)
        : input.mode === "follow_up"
          ? this.inner.followUp(input.text, images)
          : this.inner.prompt(input.text, { source: "rpc", ...(images?.length ? { images } : {}) });
      await terminal;
    } finally {
      this.promptRunning = false;
      unsubscribe();
    }

    if (events.length === 0 || events.at(-1)!.kind !== "end") {
      // SDK promise resolved a full turn that never surfaced an end event:
      // synthesize one so the client always gets a terminal frame.
      events.push({ cid, seq: this.seq.nextSeq(), kind: "end", payload: { stopReason: "end_turn" } });
      this.emit(events.at(-1)!);
    }
    return events;
  }

  async abort(): Promise<void> {
    await this.inner.abort();
  }

  cancelQueue(): { steering: string[]; followUp: string[] } {
    return this.inner.clearQueue();
  }

  /**
   * Dispatch an advanced-control command directly to the SDK session. Returns
   * the same result shapes `web/packages/pi-backend` produces, minus web-only
   * plugging (extension widgets, forced-empty-system-prompt, model caches).
   */
  async command(command: PiCommand): Promise<unknown> {
    switch (command.type) {
      case "get_state": {
        const model = this.inner.model;
        const contextUsage = this.inner.getContextUsage();
        return {
          sessionId: this.inner.sessionId,
          sessionFile: this.inner.sessionFile ?? "",
          isStreaming: this.inner.isStreaming,
          isPromptRunning: this.promptRunning,
          isBashRunning: this.inner.isBashRunning,
          isCompacting: this.inner.isCompacting,
          autoCompactionEnabled: this.inner.autoCompactionEnabled,
          autoRetryEnabled: this.inner.autoRetryEnabled,
          model: model ? { id: model.id, provider: model.provider } : undefined,
          messageCount: 0,
          pendingMessageCount: this.inner.pendingMessageCount,
          queuedMessages: {
            steering: [...this.inner.getSteeringMessages()],
            followUp: [...this.inner.getFollowUpMessages()],
          },
          contextUsage: contextUsage
            ? { percent: contextUsage.percent, contextWindow: contextUsage.contextWindow, tokens: contextUsage.tokens }
            : null,
          systemPrompt: this.inner.agent.state?.systemPrompt ?? "",
          thinkingLevel: this.inner.agent.state?.thinkingLevel ?? "off",
          extensionStatuses: {},
          extensionWidgets: [],
        };
      }
      case "set_model": {
        const { provider, modelId } = command as unknown as { provider: string; modelId: string };
        let model = this.inner.modelRuntime.getModel(provider, modelId);
        if (!model) {
          await this.inner.modelRuntime.refresh({ allowNetwork: false });
          model = this.inner.modelRuntime.getModel(provider, modelId);
        }
        if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
        await this.inner.setModel(model);
        return { id: model.id, provider: model.provider };
      }
      case "set_thinking_level": {
        this.inner.setThinkingLevel(command.level as unknown as SdkThinkingLevel);
        return null;
      }
      case "set_tools": {
        // ponytail: skips web's withExtensionTools merge (daemon registers no
        // extension tools headless); add if daemon sessions ever need them.
        this.inner.setActiveToolsByName(command.toolNames as string[]);
        return null;
      }
      case "get_tools": {
        const all = this.inner.getAllTools();
        const active = new Set(this.inner.getActiveToolNames());
        return all.map((t) => ({ name: t.name, description: t.description, active: active.has(t.name) }));
      }
      case "get_commands": {
        const commands: Array<Record<string, unknown>> = [];
        const runner = this.inner.extensionRunner;
        for (const registered of runner.getRegisteredCommands()) {
          commands.push({ name: registered.invocationName, description: registered.description, source: "extension", sourceInfo: registered.sourceInfo });
        }
        for (const template of this.inner.promptTemplates) {
          commands.push({ name: template.name, description: template.description, source: "prompt", sourceInfo: template.sourceInfo });
        }
        for (const skill of this.inner.resourceLoader.getSkills().skills) {
          commands.push({ name: `skill:${skill.name}`, description: skill.description, source: "skill", sourceInfo: skill.sourceInfo });
        }
        return { commands };
      }
      case "compact":
        return this.inner.compact(command.customInstructions as string | undefined);
      case "abort_compaction": {
        this.inner.abortCompaction();
        return null;
      }
      case "set_session_name": {
        const name = (command.name as string | undefined)?.trim();
        if (!name) throw new Error("Session name cannot be empty");
        this.inner.setSessionName(name);
        return null;
      }
      case "auto_name": {
        const result = await generateSessionTitle(this.inner);
        this.inner.setSessionName(result.title);
        return { title: result.title, usage: result.usage ?? null };
      }
      case "get_session_stats": {
        return { ...this.inner.getSessionStats(), sessionName: this.inner.sessionManager.getSessionName() };
      }
      case "get_last_assistant_text": {
        return { text: this.inner.getLastAssistantText() ?? "" };
      }
      case "set_auto_compaction": {
        this.inner.setAutoCompactionEnabled(Boolean(command.enabled));
        return null;
      }
      case "set_auto_retry": {
        this.inner.setAutoRetryEnabled(Boolean(command.enabled));
        return null;
      }
      case "clear_queue":
        return this.inner.clearQueue();
      case "navigate_tree": {
        if (this.inner.isBashRunning) throw new Error("Cannot navigate while a shell command is running");
        const result = await this.inner.navigateTree(command.targetId as string, {});
        return { cancelled: result.cancelled };
      }
      case "fork":
        return this.fork(command);
      case "bash":
        return this.bash(command);
      case "abort_bash": {
        this.inner.abortBash();
        return null;
      }
      case "reload": {
        await this.inner.reload();
        this.bindUiContext();
        return { success: true };
      }
      case "extension_ui_response":
        this.resolveExtensionUiResponse(command);
        return null;
      case "extension_ui_input":
        // Headless: no custom terminal input channel to forward to.
        return null;
      default:
        throw new Error(`Unsupported command: ${command.type}`);
    }
  }

  private async fork(command: PiCommand): Promise<unknown> {
    if (this.inner.isBashRunning) throw new Error("Cannot fork while a shell command is running");
    const entryId = command.entryId as string;
    const sessionManager = this.inner.sessionManager;
    const currentSessionFile = this.inner.sessionFile;
    if (!sessionManager.isPersisted()) return { cancelled: true };
    if (!currentSessionFile) throw new Error("Persisted session is missing a session file");
    const entry = sessionManager.getEntry(entryId);
    if (!entry) throw new Error("Invalid entry ID for forking");

    const sessionDir = sessionManager.getSessionDir();
    let newSessionFile: string;
    if (!entry.parentId) {
      // Fork before the first message: create an empty session linked to this one.
      const newManager = SessionManager.create(sessionManager.getCwd(), sessionDir);
      newManager.newSession({ parentSession: currentSessionFile });
      newSessionFile = newManager.getSessionFile() as string;
    } else {
      // Fork after some history: copy path up to (but not including) the fork point.
      const sourceManager = SessionManager.open(currentSessionFile, sessionDir);
      const forkedPath = sourceManager.createBranchedSession(entry.parentId);
      if (!forkedPath) throw new Error("Failed to create forked session");
      newSessionFile = forkedPath;
    }
    const newSessionId = SessionManager.open(newSessionFile, sessionDir).getSessionId();
    return { cancelled: false, newSessionId, sessionFile: newSessionFile };
  }

  private async bash(command: PiCommand): Promise<unknown> {
    if (this.promptRunning || this.inner.isStreaming || this.inner.isCompacting || this.inner.isBashRunning) {
      throw new Error("Cannot run a shell command while the session is busy");
    }
    // ponytail: SDK default local bash operations; remote/project-command env
    // operations need the web bash-extension machinery, add if required.
    return this.inner.executeBash(command.command as string, undefined, {
      excludeFromContext: command.excludeFromContext as boolean | undefined,
    });
  }

  private resolveExtensionUiResponse(command: PiCommand): void {
    const id = command.id as string;
    const pending = this.pendingUi.get(id);
    if (pending) {
      this.pendingUi.delete(id);
      pending.resolve((command.response ?? {}) as Record<string, unknown>);
    }
  }

  /** Terminate the native session and free it. */
  close(): Promise<void> {
    if (!this.alive) return Promise.resolve();
    this.alive = false;
    for (const pending of this.pendingUi.values()) pending.reject(new Error("session closed"));
    this.pendingUi.clear();
    if (this.inner.isBashRunning) this.inner.abortBash();
    this.inner.dispose();
    this.onClose();
    return Promise.resolve();
  }
}

export type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
