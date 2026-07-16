import {
	CHAT_WIDTH_LABELS,
	CHAT_WIDTH_PRESETS,
	type ChatWidth,
	applyChatWidth,
	getChatWidth,
	setChatWidth,
} from "@/lib/chat-width";
import { getThemeMode, toggleTheme } from "@/lib/themes";
import { AlignCenter, Equal, Moon, MoveHorizontal, Sun } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";

export function Theme() {
	const [themeMode, setThemeMode] = useState<"dark" | "light">(getThemeMode());
	const [chatWidth, setChatWidthState] = useState<ChatWidth>(() => getChatWidth());
	const reduced = useReducedMotion();
	const isDark = themeMode === "dark";

	function handleToggle() {
		const next = toggleTheme();
		setThemeMode(next);
	}

	function handleChatWidth(width: ChatWidth) {
		setChatWidth(width);
		applyChatWidth(width);
		setChatWidthState(width);
	}

	return (
		<section>
			<h2 className="text-sm font-semibold text-foreground mb-1">Appearance</h2>
			<p className="text-xs text-muted-foreground mb-5">Choose how Zosma looks on this device.</p>

			<motion.button
				type="button"
				onClick={handleToggle}
				className="glass w-full flex items-center justify-between px-4 py-3"
				whileTap={reduced ? {} : { scale: 0.99 }}
				transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
			>
				<div className="flex items-center gap-3">
					<div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10">
						{isDark ? (
							<Moon className="w-4 h-4 text-primary" />
						) : (
							<Sun className="w-4 h-4 text-primary" />
						)}
					</div>
					<div className="text-left">
						<p className="text-[13px] font-medium text-foreground">
							{isDark ? "Dark mode" : "Light mode"}
						</p>
						<p className="text-[11px] text-muted-foreground">
							{isDark ? "Easy on the eyes at night" : "Best in bright environments"}
						</p>
					</div>
				</div>

				{/* Animated toggle */}
				<div
					className="relative w-10 h-[22px] rounded-full shrink-0"
					style={{
						background: isDark ? "hsl(var(--primary))" : "hsl(var(--muted))",
						transition: "background 200ms",
					}}
				>
					<motion.div
						className="absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white shadow-sm"
						animate={{ x: isDark ? 20 : 2 }}
						transition={
							reduced ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 35, mass: 0.8 }
						}
					/>
				</div>
			</motion.button>

			{/* ── Chat width ── */}
			<div className="mt-6">
				<h3 className="text-sm font-semibold text-foreground mb-1">Chat Width</h3>
				<p className="text-xs text-muted-foreground mb-4">
					Control how wide the message column is.
				</p>
				<div className="flex items-center gap-2">
					{CHAT_WIDTH_PRESETS.map((preset) => {
						const isActive = chatWidth === preset;
						const Icon =
							preset === "small" ? AlignCenter : preset === "medium" ? Equal : MoveHorizontal;
						return (
							<motion.button
								key={preset}
								type="button"
								onClick={() => handleChatWidth(preset)}
								className={`glass flex-1 flex flex-col items-center gap-1.5 px-3 py-2.5 transition-colors ${
									isActive ? "border-primary/50 bg-primary/10" : ""
								}`}
								whileTap={reduced ? {} : { scale: 0.97 }}
								transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
							>
								<Icon
									className="w-4 h-4"
									style={{
										color: isActive ? "hsl(var(--primary))" : "hsl(var(--foreground))",
									}}
								/>
								<span
									className="text-[11px] font-medium"
									style={{
										color: isActive ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
									}}
								>
									{CHAT_WIDTH_LABELS[preset]}
								</span>
							</motion.button>
						);
					})}
				</div>
			</div>
		</section>
	);
}
