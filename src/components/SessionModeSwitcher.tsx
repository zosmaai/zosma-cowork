import type { SessionMode } from "@/types/session-runtime";
import type { KeyboardEvent } from "react";

interface Props {
	mode: SessionMode;
	onChange: (mode: SessionMode) => void;
	disabled?: boolean;
}

const MODES: SessionMode[] = ["chat", "work"];

export function SessionModeSwitcher({ mode, onChange, disabled }: Props) {
	function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
		if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
		event.preventDefault();
		const next = event.key === "ArrowRight"
			? MODES[(MODES.indexOf(mode) + 1) % MODES.length]
			: MODES[(MODES.indexOf(mode) - 1 + MODES.length) % MODES.length];
		onChange(next);
		event.currentTarget.parentElement
			?.querySelector<HTMLButtonElement>(`[data-session-mode="${next}"]`)
			?.focus();
	}

	return (
		<div
			role="tablist"
			aria-label="Session mode"
			className="inline-flex rounded-full border border-border bg-muted/60 p-1"
		>
			{MODES.map((item) => (
				<button
					key={item}
					type="button"
					role="tab"
					aria-selected={mode === item}
					data-session-mode={item}
					tabIndex={mode === item ? 0 : -1}
					disabled={disabled}
					onKeyDown={onKeyDown}
					onClick={() => onChange(item)}
					className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
						mode === item
							? "bg-background text-foreground shadow-sm"
							: "text-muted-foreground hover:text-foreground"
					}`}
				>
					{item === "chat" ? "Chat" : "Work"}
				</button>
			))}
		</div>
	);
}