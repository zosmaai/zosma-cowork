/**
 * Zosma Cowork — Chat content width control
 *
 * Lets users pick how wide the readable message column is. The content
 * column is centered; the message background bands still span full width.
 * Stored in localStorage so it persists across sessions.
 *
 * Presets:
 *   small  — 820px  comfortable, focused reading column
 *   medium — 1080px roomier column with more horizontal space
 *   full   — edge-to-edge, original full-width layout
 */

const STORAGE_KEY = "zosma-chat-width";

export type ChatWidth = "small" | "medium" | "full";

/**
 * Max-width (px) for each preset's centered content column.
 * `null` means no constraint (full width / edge-to-edge).
 */
export const CHAT_WIDTH_PX: Record<ChatWidth, number | null> = {
	small: 820,
	medium: 1080,
	full: null,
};

/** Human-readable labels for each preset. */
export const CHAT_WIDTH_LABELS: Record<ChatWidth, string> = {
	small: "Small",
	medium: "Medium",
	full: "Full",
};

export const CHAT_WIDTH_PRESETS: ChatWidth[] = ["small", "medium", "full"];

const DEFAULT_WIDTH: ChatWidth = "small";

/** Get the persisted chat width, falling back to the default. */
export function getChatWidth(): ChatWidth {
	try {
		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved === "small" || saved === "medium" || saved === "full") return saved;
	} catch {
		// localStorage unavailable — use default
	}
	return DEFAULT_WIDTH;
}

/** Persist a chat width choice. */
export function setChatWidth(width: ChatWidth): void {
	try {
		localStorage.setItem(STORAGE_KEY, width);
	} catch {
		// Ignore
	}
}

/**
 * Apply the width to the document via CSS variables:
 *   --chat-max-width          — message content column
 *   --chat-composer-max-width — composer (slightly wider so the input's
 *                               inner text edge aligns with the messages)
 */
export function applyChatWidth(width: ChatWidth): void {
	if (typeof document === "undefined") return;
	const px = CHAT_WIDTH_PX[width];
	const root = document.documentElement.style;
	if (px === null) {
		root.setProperty("--chat-max-width", "none");
		root.setProperty("--chat-composer-max-width", "none");
	} else {
		root.setProperty("--chat-max-width", `${px}px`);
		// +32px (px-4 on each side) keeps the input text edge aligned with messages
		root.setProperty("--chat-composer-max-width", `${px + 32}px`);
	}
}

/** Initialize chat width from saved preference (call once on app load). */
export function initChatWidth(): void {
	applyChatWidth(getChatWidth());
}
