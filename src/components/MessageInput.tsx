import type { ModelInfo } from "@/types";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
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

		function handleSubmit(e?: React.FormEvent) {
			e?.preventDefault();
			const trimmed = text.trim();
			if (!trimmed || disabled) return;
			onSend(trimmed);
			setText("");
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
						placeholder={placeholder}
						rows={1}
						disabled={disabled}
						className="w-full resize-none rounded-t-2xl bg-transparent px-4 pt-3 pb-2 text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
					/>
					<div className="flex items-center justify-between px-3 pb-3">
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
						<button
							type="submit"
							disabled={disabled || !text.trim()}
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
