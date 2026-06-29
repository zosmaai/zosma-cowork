import {
	CHAT_WIDTH_LABELS,
	CHAT_WIDTH_PRESETS,
	type ChatWidth,
	applyChatWidth,
	getChatWidth,
	setChatWidth,
} from "@/lib/chat-width";
import { AlignCenter, Equal, MoveHorizontal } from "lucide-react";
import { useState } from "react";

/**
 * Compact segmented control to switch the readable width of the chat
 * content column (Small / Medium / Large). Centered content; preference
 * persisted in localStorage.
 */
export function ChatWidthToggle() {
	const [width, setWidth] = useState<ChatWidth>(() => getChatWidth());

	function handleSelect(next: ChatWidth) {
		setWidth(next);
		setChatWidth(next);
		applyChatWidth(next);
	}

	const ICONS: Record<ChatWidth, React.ComponentType<{ className?: string }>> = {
		small: AlignCenter,
		medium: Equal,
		full: MoveHorizontal,
	};

	return (
		<div
			className="flex items-center gap-0.5 p-0.5 rounded-lg border border-border/70 backdrop-blur-sm"
			style={{ background: "hsl(var(--card) / 0.8)" }}
			role="group"
			aria-label="Chat width"
		>
			{CHAT_WIDTH_PRESETS.map((preset) => {
				const isActive = width === preset;
				const Icon = ICONS[preset];
				return (
					<button
						key={preset}
						type="button"
						onClick={() => handleSelect(preset)}
						aria-label={`${CHAT_WIDTH_LABELS[preset]} width`}
						aria-pressed={isActive}
						title={`${CHAT_WIDTH_LABELS[preset]} width`}
						className="flex items-center justify-center w-6 h-6 rounded-md transition-colors"
						style={{
							background: isActive ? "hsl(var(--primary) / 0.15)" : "transparent",
							color: isActive ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
						}}
					>
						<Icon className="w-3.5 h-3.5" />
					</button>
				);
			})}
		</div>
	);
}
