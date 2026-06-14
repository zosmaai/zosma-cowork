import { Background } from "./Background";
import { Theme } from "./Theme";

interface AppearanceProps {
	fontScale?: number;
	onFontScaleChange?: (scale: number) => void;
}

/**
 * Appearance — the single "how Zosma looks" surface.
 *
 * Folds the former standalone Theme (mode + font size) and Background
 * (backdrop) pages into one section so everything visual lives together.
 * The child components keep their own files (and tests); this just
 * composes them with a shared divider.
 */
export function Appearance({ fontScale, onFontScaleChange }: AppearanceProps) {
	return (
		<div className="space-y-7">
			<Theme fontScale={fontScale} onFontScaleChange={onFontScaleChange} />
			<div className="h-px bg-elev-border/60" />
			<Background />
		</div>
	);
}
