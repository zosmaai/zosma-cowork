import { usePasteDetection } from "@/hooks/usePasteDetection";
import { trackEvent } from "@/lib/telemetry";
import type { ModelInfo } from "@/types";
import { Paperclip, X } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ModelSelector } from "./ModelSelector";

interface MessageInputProps {
	onSend: (message: string) => void;
	disabled?: boolean;
	modelLabel?: string;
	models?: ModelInfo[];
	currentModelId?: string;
	onModelSelect?: (provider: string, modelId: string) => void;
}

export interface MessageInputHandle {
	focus: () => void;
}

export const MessageInput = forwardRef<MessageInputHandle, MessageInputProps>(
	({ onSend, disabled, modelLabel, models, currentModelId, onModelSelect }, ref) => {
		const [text, setText] = useState("");
		const [attachedFiles, setAttachedFiles] = useState<{ path: string; name: string }[]>([]);
		const { pastedImages, pasteHandler, clearImages } = usePasteDetection();
		const textareaRef = useRef<HTMLTextAreaElement>(null);

		useImperativeHandle(ref, () => ({
			focus: () => textareaRef.current?.focus(),
		}));

		// Auto-resize textarea
		// biome-ignore lint/correctness/useExhaustiveDependencies: textareaRef is stable
		useEffect(() => {
			const textarea = textareaRef.current;
			if (!textarea) return;
			textarea.style.height = "auto";
			textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
		}, [text]);

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

		async function handleSubmit(e?: React.FormEvent) {
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

			onSend(finalPrompt);
			setText("");
			setAttachedFiles([]);
			clearImages();
			if (textareaRef.current) {
				textareaRef.current.style.height = "auto";
			}
		}

		function handleKeyDown(e: React.KeyboardEvent) {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				handleSubmit();
			}
		}

		const placeholder = disabled
			? "Zosma Cowork is thinking..."
			: "Message Zosma Cowork... (Enter to send, Shift+Enter for newline)";

		return (
			<form onSubmit={handleSubmit} className="p-4">
				<div
					className="rounded-2xl border shadow-sm transition-all focus-within:ring-1"
					style={{
						background: "hsl(var(--card))",
						borderColor: "hsl(var(--border))",
						// @ts-expect-error CSS custom property
						"--ring-color": "hsl(var(--primary) / 0.3)",
					}}
				>
					<textarea
						ref={textareaRef}
						value={text}
						onChange={(e) => setText(e.target.value)}
						onKeyDown={handleKeyDown}
						onPaste={(e) => pasteHandler(e.nativeEvent)}
						placeholder={placeholder}
						rows={1}
						disabled={disabled}
						className="w-full resize-none rounded-t-2xl bg-transparent px-4 pt-3 pb-2 text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
					/>

					{/* Image preview chips */}
					{pastedImages.length > 0 && (
						<div className="flex flex-wrap gap-1.5 px-4 pb-1.5">
							{pastedImages.map((img) => (
								<span
									key={img.name}
									className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs max-w-60"
									style={{
										background: "hsl(var(--muted))",
										color: "hsl(var(--foreground))",
									}}
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
									className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs max-w-40"
									style={{
										background: "hsl(var(--muted))",
										color: "hsl(var(--foreground))",
									}}
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

					<div className="flex items-center justify-between px-3 pb-3">
						<div className="flex items-center gap-1.5">
							<button
								type="button"
								onClick={openFileDialog}
								disabled={disabled}
								aria-label="Attach files"
								className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
							>
								<Paperclip size={16} />
							</button>
							{models && onModelSelect ? (
								<ModelSelector
									models={models}
									currentModelId={currentModelId}
									onSelect={onModelSelect}
								/>
							) : (
								<span className="text-xs" style={{ color: "hsl(var(--muted-foreground) / 0.6)" }}>
									{modelLabel || "Zosma"}
								</span>
							)}
						</div>
						<button
							type="submit"
							disabled={
								disabled ||
								(!text.trim() && attachedFiles.length === 0 && pastedImages.length === 0)
							}
							className="px-4 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
							style={{
								background: "hsl(var(--primary))",
								color: "hsl(var(--primary-foreground))",
							}}
						>
							Send →
						</button>
					</div>
				</div>
			</form>
		);
	},
);

MessageInput.displayName = "MessageInput";
