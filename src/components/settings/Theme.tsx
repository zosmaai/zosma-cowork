import { getThemeMode, toggleTheme } from "@/lib/themes";
import { Moon, Sun } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import {
	FONT_SCALE_LABELS,
	FONT_SCALE_PRESETS,
	getFontScale,
	setFontScale,
	type FontScale,
} from "@/lib/font-scale";

interface ThemeProps {
	fontScale?: number;
	onFontScaleChange?: (scale: number) => void;
}

export function Theme({ fontScale: controlledScale, onFontScaleChange }: ThemeProps) {
	const [themeMode, setThemeMode] = useState<"dark" | "light">(getThemeMode());
	const [localFontScale, setLocalFontScale] = useState<FontScale>(
		() => (controlledScale ?? getFontScale()) as FontScale,
	);
	const reduced = useReducedMotion();
	const isDark = themeMode === "dark";

	// Keep local state in sync if controlled from outside
	const effectiveScale = (controlledScale ?? localFontScale) as FontScale;

	function handleToggle() {
		const next = toggleTheme();
		setThemeMode(next);
	}

	function handleFontScale(scale: FontScale) {
		setFontScale(scale);
		setLocalFontScale(scale);
		onFontScaleChange?.(scale);
	}

	return (
		<section>
			<h2 className="text-sm font-semibold text-foreground mb-1">Appearance</h2>
			<p className="text-xs text-muted-foreground mb-5">Choose how Zosma looks on this device.</p>

			{/* ── Dark/Light toggle ── */}
			<motion.button
				type="button"
				onClick={handleToggle}
				className="w-full flex items-center justify-between px-4 py-3 rounded-lg border border-border"
				whileHover={reduced ? {} : { background: "hsl(var(--muted) / 0.3)" }}
				whileTap={reduced ? {} : { scale: 0.99 }}
				transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
				style={{ background: "transparent" }}
			>
				<div className="flex items-center gap-3">
					<div
						className="flex items-center justify-center w-8 h-8 rounded-lg"
						style={{ background: "hsl(var(--muted) / 0.6)" }}
					>
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

			{/* ── Font size / Zoom ── */}
			<div className="mt-6">
				<h3 className="text-sm font-semibold text-foreground mb-1">Font Size</h3>
				<p className="text-xs text-muted-foreground mb-4">
					Adjust the overall UI scale for your screen.
				</p>

				<div className="flex items-center gap-2">
					{FONT_SCALE_PRESETS.map((scale) => {
						const isActive = effectiveScale === scale;
						return (
							<motion.button
								key={scale}
								type="button"
								onClick={() => handleFontScale(scale)}
								className="flex-1 flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-lg border transition-colors"
								style={{
									borderColor: isActive ? "hsl(var(--primary) / 0.5)" : "hsl(var(--border))",
									background: isActive ? "hsl(var(--primary) / 0.08)" : "transparent",
								}}
								whileHover={reduced ? {} : { background: "hsl(var(--muted) / 0.3)" }}
								whileTap={reduced ? {} : { scale: 0.97 }}
								transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
							>
								<span
									className="font-semibold leading-none"
									style={{
										fontSize: scale === 0.85 ? 13 : scale === 1 ? 16 : scale === 1.15 ? 19 : 22,
										color: isActive ? "hsl(var(--primary))" : "hsl(var(--foreground))",
									}}
								>
									A
								</span>
								<span
									className="text-[11px] font-medium"
									style={{
										color: isActive ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
									}}
								>
									{FONT_SCALE_LABELS[scale]}
								</span>
							</motion.button>
						);
					})}
				</div>

				{/* Quick preview of the selected size */}
				<div
					className="mt-3 px-3 py-2 rounded-lg border border-border"
					style={{ background: "hsl(var(--muted) / 0.3)" }}
				>
					<p className="text-xs text-muted-foreground">
						{effectiveScale === 1
							? "Default size — 1×"
							: `${Math.round(effectiveScale * 100)}% — ${effectiveScale > 1 ? "Larger" : "Smaller"} than default`}
					</p>
				</div>
			</div>
		</section>
	);
}
