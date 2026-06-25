import { usePasteDetection } from "@/hooks/usePasteDetection";
import { trackEvent } from "@/lib/telemetry";
import type { ModelInfo } from "@/types";
import type { Command } from "@/types/commands";
import { ArrowUp, Mic, Paperclip, Square, X } from "lucide-react";
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import { CommandPalette, useFilteredCommands } from "./CommandPalette";
import { ModelSelector } from "./ModelSelector";

/** Split a raw composer value starting with `/` into command query + args. */
export function parseSlashInput(value: string): { query: string; args: string } | null {
	if (!value.startsWith("/")) return null;
	// Only the first line is treated as a command line.
	const firstLine = value.slice(1).split("\n", 1)[0];
	const spaceIdx = firstLine.indexOf(" ");
	if (spaceIdx === -1) return { query: firstLine, args: "" };
	return { query: firstLine.slice(0, spaceIdx), args: firstLine.slice(spaceIdx + 1) };
}

interface MessageInputProps {
	onSend: (message: string) => void;
	disabled?: boolean;
	modelLabel?: string;
	models?: ModelInfo[];
	currentModelId?: string;
	onModelSelect?: (provider: string, modelId: string) => void;
	/**
	 * External draft to load into the composer (e.g. a prompt template).
	 * Setting a new `nonce` fills the textarea with `text` and focuses it,
	 * letting the user edit before sending — it does NOT auto-send.
	 */
	draft?: { text: string; nonce: number };
	/**
	 * Slash-command registry (#179). When the composer input starts with `/`,
	 * an autocomplete palette of these commands opens. A1 ships against a stub
	 * list; A2–A4 populate it. `onRunCommand` receives the chosen command and
	 * any trailing argument text — implementations live outside this component.
	 */
	commands?: Command[];
	onRunCommand?: (cmd: Command, args: string) => void;
	/**
	 * True while the agent is actively responding. The composer stays
	 * **enabled** in this state and routes Enter to `onSteer` (mid-turn
	 * course correction) and Alt+Enter to `onFollowUp` (post-turn task) —
	 * matching pi-coding-agent's TUI shortcuts. See issue #201.
	 */
	streaming?: boolean;
	/**
	 * Abort the in-flight agent run. While `streaming`, the composer's primary
	 * CTA becomes a Stop button wired to this (the old standalone StatusBar's
	 * Stop moved here). Steering still happens via Enter (see placeholder).
	 */
	onAbort?: () => void;
	/** Queue a steering message on the running session (issue #201, PR 1). */
	onSteer?: (message: string) => void;
	/** Queue a follow-up message on the running session (issue #201, PR 1). */
	onFollowUp?: (message: string) => void;
	/**
	 * Pending steer + follow-up messages on the active session
	 * (issue #201, PR 3). When either array is non-empty the composer
	 * surfaces a small "N queued — Ctrl+↑ to edit" summary and Ctrl+↑
	 * fires {@link onEditQueue}.
	 */
	queue?: { steering: readonly string[]; followUp: readonly string[] };
	/**
	 * User pressed Ctrl+↑ to edit pending queued messages. The parent
	 * should atomically drain the SDK queue (via `clearQueue`) and load
	 * the drained messages into the composer through the existing
	 * {@link draft} prop. While editing, the SDK queue is empty so
	 * nothing accidentally fires.
	 */
	onEditQueue?: () => void;
}

export interface MessageInputHandle {
	focus: () => void;
}

export const MessageInput = forwardRef<MessageInputHandle, MessageInputProps>(
	(
		{
			onSend,
			disabled,
			modelLabel,
			models,
			currentModelId,
			onModelSelect,
			draft,
			commands,
			onRunCommand,
			streaming = false,
			onAbort,
			onSteer,
			onFollowUp,
			queue,
			onEditQueue,
		},
		ref,
	) => {
		const [text, setText] = useState("");
		const [commandIndex, setCommandIndex] = useState(0);
		const [attachedFiles, setAttachedFiles] = useState<{ path: string; name: string }[]>([]);
		const [isListening, setIsListening] = useState(false);
		const { pastedImages, pasteHandler, clearImages } = usePasteDetection();
		const textareaRef = useRef<HTMLTextAreaElement>(null);
		const shellRef = useRef<HTMLDivElement>(null);
		const recognitionRef = useRef<SpeechRecognition | null>(null);

		useImperativeHandle(ref, () => ({
			focus: () => textareaRef.current?.focus(),
		}));

		// Load an external draft (prompt template) into the composer for editing.
		// biome-ignore lint/correctness/useExhaustiveDependencies: only react to a new draft nonce
		useEffect(() => {
			if (!draft || !draft.text) return;
			setText(draft.text);
			// Focus and move the caret to the end after the value is applied.
			requestAnimationFrame(() => {
				const textarea = textareaRef.current;
				if (!textarea) return;
				textarea.focus();
				const end = textarea.value.length;
				textarea.setSelectionRange(end, end);
			});
		}, [draft?.nonce]);

		// Auto-resize textarea
		// biome-ignore lint/correctness/useExhaustiveDependencies: textareaRef is stable
		useEffect(() => {
			const textarea = textareaRef.current;
			if (!textarea) return;
			textarea.style.height = "auto";
			textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
		}, [text]);

		const startVoiceInput = useCallback(() => {
			const SpeechRecognition =
				(window as unknown as { SpeechRecognition?: new () => SpeechRecognition })
					.SpeechRecognition ||
				(window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognition })
					.webkitSpeechRecognition;
			if (!SpeechRecognition) return;

			if (isListening && recognitionRef.current) {
				recognitionRef.current.stop();
				setIsListening(false);
				return;
			}

			const recognition = new SpeechRecognition();
			recognition.lang = "en-US";
			recognition.interimResults = true;
			recognition.continuous = false;

			recognition.onresult = (event: SpeechRecognitionEvent) => {
				const transcript = Array.from(event.results)
					.map((r) => r[0].transcript)
					.join("");
				setText((prev) => prev + transcript);
			};

			recognition.onend = () => {
				setIsListening(false);
			};

			recognition.onerror = () => {
				setIsListening(false);
			};

			recognitionRef.current = recognition;
			recognition.start();
			setIsListening(true);
			trackEvent("voice_input_started");
		}, [isListening]);

		const openFileDialog = useCallback(async () => {
			try {
				const { open } = await import("@tauri-apps/plugin-dialog");
				const result = await open({
					multiple: true,
					title: "Select files",
				});
				if (!result) return;
				const paths = Array.isArray(result) ? result : [result];
				const files = paths.map((p) => ({
					path: p,
					name: p.split("/").pop() ?? p.split("\\").pop() ?? p,
				}));
				setAttachedFiles(files);
				trackEvent("file_picked", { count: files.length });
			} catch {
				// Dialog plugin not available (e.g., browser/test env)
			}
		}, []);

		const removeFile = useCallback((path: string) => {
			setAttachedFiles((prev) => prev.filter((f) => f.path !== path));
		}, []);

		const removeImage = useCallback(() => {
			clearImages();
		}, [clearImages]);

		// Track screenshot/detected-image paste events
		useEffect(() => {
			if (pastedImages.length > 0) {
				trackEvent("screenshot_pasted");
			}
		}, [pastedImages.length]);

		/**
		 * Submit the composer. `intent` decides which callback receives the
		 * payload:
		 *   - `"send"`     : start a fresh turn (idle mode — default)
		 *   - `"steer"`    : mid-turn course-correction (streaming + Enter)
		 *   - `"follow_up"`: post-turn task (streaming + Alt+Enter)
		 *
		 * If the requested callback isn't wired (e.g. `onSteer` missing during
		 * streaming) the submit is suppressed — falling back to `onSend` would
		 * start a fresh prompt, which the sidecar's prompt-scheduler would
		 * queue behind the running turn (exactly the bug #201 is fixing).
		 */
		async function handleSubmit(
			intent: "send" | "steer" | "follow_up" = "send",
			e?: React.FormEvent,
		) {
			e?.preventDefault();
			const trimmed = text.trim();
			if ((!trimmed && attachedFiles.length === 0 && pastedImages.length === 0) || disabled) return;

			// Build prompt with file and image references
			const sections: string[] = [];
			for (const file of attachedFiles) {
				sections.push(`[File: ${file.path}]`);
			}
			for (const img of pastedImages) {
				sections.push(`[Image: ${img.dataUrl}]`);
			}
			let finalPrompt = sections.join("\n");
			if (trimmed) {
				finalPrompt = finalPrompt ? `${finalPrompt}\n\n${trimmed}` : trimmed;
			}

			const handler = intent === "steer" ? onSteer : intent === "follow_up" ? onFollowUp : onSend;
			if (!handler) return; // silent no-op is safer than misroute — see jsdoc

			handler(finalPrompt);
			setText("");
			setAttachedFiles([]);
			clearImages();
			if (textareaRef.current) {
				textareaRef.current.style.height = "auto";
				// PR3 follow-up: keep focus on the textarea after submit so
				// the user can type the next prompt / steer / follow-up
				// without a mouse trip. Form submission and the React
				// re-render that clears `text` can briefly shift focus to
				// document.body on real DOM — explicit refocus is harmless
				// when focus is already on the textarea.
				textareaRef.current.focus();
			}
		}

		function runCommand(cmd: Command, args: string) {
			onRunCommand?.(cmd, args);
			// Clear the command line after running, like sending does.
			setText("");
			setCommandIndex(0);
			if (textareaRef.current) textareaRef.current.style.height = "auto";
		}

		/** Total pending queued messages across both kinds (#201 PR 3). */
		const queueCount = (queue?.steering.length ?? 0) + (queue?.followUp.length ?? 0);

		function handleKeyDown(e: React.KeyboardEvent) {
			// Palette is open: its keys take precedence over send/steer/newline.
			if (paletteOpen) {
				if (e.key === "ArrowDown") {
					e.preventDefault();
					setCommandIndex((i) => (filteredCommands.length ? (i + 1) % filteredCommands.length : 0));
					return;
				}
				if (e.key === "ArrowUp") {
					e.preventDefault();
					setCommandIndex((i) =>
						filteredCommands.length
							? (i - 1 + filteredCommands.length) % filteredCommands.length
							: 0,
					);
					return;
				}
				if (e.key === "Escape") {
					e.preventDefault();
					setText("");
					setCommandIndex(0);
					return;
				}
				if (e.key === "Tab") {
					e.preventDefault();
					const cmd = filteredCommands[commandIndex];
					if (cmd) setText(`/${cmd.name} `);
					return;
				}
				if (e.key === "Enter" && !e.shiftKey) {
					e.preventDefault();
					const cmd = filteredCommands[commandIndex];
					if (cmd) runCommand(cmd, slash?.args ?? "");
					return;
				}
			}
			// Ctrl+↑ — recall pending queued messages for editing (#201 PR 3).
			// Works in both streaming and idle state; no-op when the queue is empty.
			if (e.key === "ArrowUp" && e.ctrlKey && !e.shiftKey && !e.altKey) {
				if (queueCount > 0 && onEditQueue) {
					e.preventDefault();
					onEditQueue();
				}
				return;
			}
			if (e.key !== "Enter" || e.shiftKey) return;
			e.preventDefault();
			if (streaming) {
				handleSubmit(e.altKey ? "follow_up" : "steer");
			} else {
				handleSubmit("send");
			}
		}

		const placeholder = disabled
			? "Not ready..."
			: streaming
				? queueCount > 0
					? `Steer with Enter · Alt+Enter for follow-up · ${queueCount} queued (Ctrl+↑ to edit)`
					: "Steer with Enter · Alt+Enter to queue follow-up"
				: "Message (Enter to send, Shift+Enter for newline)";

		const hasContent = !!(text.trim() || attachedFiles.length > 0 || pastedImages.length > 0);

		// Slash-command palette state derived from the current input.
		const slash = useMemo(() => parseSlashInput(text), [text]);
		const registry = commands ?? [];
		const filteredCommands = useFilteredCommands(registry, slash?.query ?? "");
		const paletteOpen = !disabled && slash !== null && registry.length > 0;

		// Clamp selection whenever the filtered list shrinks.
		useEffect(() => {
			setCommandIndex((i) =>
				filteredCommands.length === 0 ? 0 : Math.min(i, filteredCommands.length - 1),
			);
		}, [filteredCommands.length]);

		return (
			<form
				onSubmit={(e) => handleSubmit(streaming ? "steer" : "send", e)}
				className="px-4 pb-2 mx-auto w-full"
				style={{ maxWidth: "var(--chat-composer-max-width, 852px)" }}
			>
				{/* Outer shell */}
				<div ref={shellRef} className="composer-glass relative rounded-2xl">
					{paletteOpen && (
						<CommandPalette
							anchorRef={shellRef}
							commands={registry}
							query={slash?.query ?? ""}
							args={slash?.args ?? ""}
							selectedIndex={commandIndex}
							onRun={runCommand}
							onSelectIndex={setCommandIndex}
						/>
					)}

					{/* Textarea */}
					<textarea
						ref={textareaRef}
						value={text}
						onChange={(e) => setText(e.target.value)}
						onKeyDown={handleKeyDown}
						onPaste={(e) => pasteHandler(e.nativeEvent)}
						placeholder={placeholder}
						rows={1}
						disabled={disabled}
						enterKeyHint="send"
						inputMode="text"
						className="w-full resize-none bg-transparent px-4 pt-3 pb-2 text-[13px] leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
					/>

					{/* PR3 follow-up: the standalone steer/follow-up hint row and
					    queue-summary row were removed — they looked like a second
					    input above the main input. Hints now live in the textarea
					    placeholder (mode-aware), and the queue surface lives in
					    the chat as a threaded section above the composer. Idle
					    state keeps a tiny queue chip (data-testid below) for
					    discoverability when a follow-up survives STREAM_COMPLETE
					    and the placeholder reverts to the idle wording. */}
					{queueCount > 0 && !streaming && !disabled && (
						<div
							className="px-4 pb-1 text-[11px] leading-tight"
							style={{ color: "hsl(var(--muted-foreground) / 0.85)" }}
							data-testid="composer-queue-summary"
						>
							<span>{queueCount} queued</span>
							<span className="opacity-50"> · </span>
							<span>Ctrl+↑ to edit</span>
						</div>
					)}

					{/* Pasted image chips */}
					{pastedImages.length > 0 && (
						<div className="flex flex-wrap gap-1.5 px-4 pb-1.5">
							{pastedImages.map((img) => (
								<span
									key={img.name}
									className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs max-w-60 bg-muted text-foreground"
									title={img.name}
								>
									<img src={img.dataUrl} alt={img.name} className="w-5 h-5 rounded object-cover" />
									<span className="truncate">
										{img.name.length > 30 ? `${img.name.slice(0, 27)}…` : img.name}
									</span>
									<button
										type="button"
										onClick={removeImage}
										className="shrink-0 rounded p-0.5 hover:opacity-70"
										aria-label={`Remove ${img.name}`}
									>
										<X size={12} />
									</button>
								</span>
							))}
						</div>
					)}

					{/* File chips */}
					{attachedFiles.length > 0 && (
						<div className="flex flex-wrap gap-1.5 px-4 pb-1.5">
							{attachedFiles.map((file) => (
								<span
									key={file.path}
									className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs max-w-40 bg-muted text-foreground"
									title={file.path}
								>
									<span className="truncate">
										{file.name.length > 30 ? `${file.name.slice(0, 27)}…` : file.name}
									</span>
									<button
										type="button"
										onClick={() => removeFile(file.path)}
										className="shrink-0 rounded p-0.5 hover:opacity-70"
										aria-label={`Remove ${file.name}`}
									>
										<X size={12} />
									</button>
								</span>
							))}
						</div>
					)}

					{/* Bottom toolbar: actions left, send right */}
					<div className="flex items-center justify-between px-2 pb-2 pt-0.5">
						{/* Left: attach, mic, model */}
						<div className="flex items-center gap-0.5">
							<button
								type="button"
								onClick={openFileDialog}
								disabled={disabled}
								aria-label="Attach files"
								className="flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--muted)/0.7)] transition-colors disabled:opacity-40"
							>
								<Paperclip size={16} />
							</button>
							<button
								type="button"
								onClick={startVoiceInput}
								disabled={disabled}
								aria-label={isListening ? "Stop recording" : "Voice input"}
								className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors disabled:opacity-40 ${
									isListening
										? "text-red-500 hover:bg-red-500/10"
										: "text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--muted)/0.7)]"
								}`}
							>
								<Mic size={16} />
							</button>
							{models && onModelSelect ? (
								<ModelSelector
									models={models}
									currentModelId={currentModelId}
									onSelect={onModelSelect}
								/>
							) : (
								<span
									className="px-1.5 text-xs"
									style={{ color: "hsl(var(--muted-foreground) / 0.55)" }}
								>
									{modelLabel || "Zosma"}
								</span>
							)}
						</div>

						{/* Right CTA. While streaming with an empty composer it's a Stop
						    button (replaces the old StatusBar's Stop); once the user types
						    a steering message it becomes Send (Enter also steers). Idle =
						    Send. */}
						{streaming && !hasContent && onAbort ? (
							<button
								type="button"
								onClick={onAbort}
								aria-label="Stop generating"
								className="flex items-center justify-center w-8 h-8 rounded-full transition-all duration-150 text-destructive hover:bg-destructive/15"
								style={{ background: "hsl(var(--destructive) / 0.12)" }}
							>
								<Square size={13} strokeWidth={2.5} className="fill-current" />
							</button>
						) : (
							<button
								type="submit"
								disabled={disabled || !hasContent}
								aria-label={streaming ? "Send steering message" : "Send message"}
								className="flex items-center justify-center w-8 h-8 rounded-full transition-all duration-150 disabled:cursor-not-allowed"
								style={{
									background: hasContent ? "#ffffff" : "hsl(var(--muted))",
									color: hasContent ? "#000000" : "hsl(var(--muted-foreground) / 0.4)",
									opacity: disabled ? 0.4 : 1,
								}}
							>
								<ArrowUp size={15} strokeWidth={2.5} />
							</button>
						)}
					</div>
				</div>
			</form>
		);
	},
);

MessageInput.displayName = "MessageInput";
