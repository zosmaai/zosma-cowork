import {
	BLUR_MAX,
	DEFAULT_SOLID_COLOR,
	DIM_MAX,
	type WallpaperConfig,
	type WallpaperMode,
	getWallpaper,
	importWallpaperImage,
	readWallpaperImageUrl,
	setWallpaper,
} from "@/lib/wallpaper";
import { ImagePlus, Loader2 } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { HexColorPicker } from "react-colorful";

const ease = [0.16, 1, 0.3, 1] as const;

// A static swatch preview of the animated aurora (close enough for a thumbnail).
const AURORA_PREVIEW =
	"radial-gradient(60% 80% at 25% 15%, hsl(var(--aurora-1) / 0.65) 0%, transparent 60%)," +
	"radial-gradient(70% 80% at 85% 80%, hsl(var(--aurora-2) / 0.6) 0%, transparent 62%)," +
	"hsl(var(--background))";

export function Background() {
	const reduced = useReducedMotion();
	const [cfg, setCfg] = useState<WallpaperConfig>(() => getWallpaper());
	const [importing, setImporting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [thumbUrl, setThumbUrl] = useState<string | null>(null);

	// Load a preview thumbnail for the custom image tile.
	useEffect(() => {
		if (!cfg.imageFile) {
			setThumbUrl(null);
			return;
		}
		let url: string | null = null;
		let cancelled = false;
		readWallpaperImageUrl(cfg.imageFile).then((u) => {
			if (cancelled) {
				if (u) URL.revokeObjectURL(u);
				return;
			}
			url = u;
			setThumbUrl(u);
		});
		return () => {
			cancelled = true;
			if (url) URL.revokeObjectURL(url);
		};
	}, [cfg.imageFile]);

	function update(patch: Partial<WallpaperConfig>) {
		const next = { ...cfg, ...patch };
		setCfg(next);
		setWallpaper(next);
	}

	function selectMode(mode: WallpaperMode) {
		setError(null);
		if (mode === "solid") {
			update({ mode, solidColor: cfg.solidColor || DEFAULT_SOLID_COLOR });
		} else if (mode === "image") {
			if (cfg.imageFile) update({ mode });
			else void pickImage();
		} else {
			update({ mode });
		}
	}

	async function pickImage() {
		setError(null);
		try {
			const { open } = await import("@tauri-apps/plugin-dialog");
			const picked = await open({
				multiple: false,
				title: "Choose a background image",
				filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
			});
			if (typeof picked !== "string") return;
			setImporting(true);
			const filename = await importWallpaperImage(picked);
			update({ mode: "image", imageFile: filename });
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not load that image.");
		} finally {
			setImporting(false);
		}
	}

	const color = cfg.solidColor || DEFAULT_SOLID_COLOR;

	return (
		<section>
			<h2 className="text-sm font-semibold text-foreground mb-1">Background</h2>
			<p className="text-xs text-muted-foreground mb-5">
				Choose the backdrop behind the app's glass panels.
			</p>

			{/* ── Choice tiles ── */}
			<div className="grid grid-cols-3 gap-2.5 max-w-md">
				<Tile
					label="Aurora"
					preview={AURORA_PREVIEW}
					active={cfg.mode === "aurora"}
					reduced={!!reduced}
					onClick={() => selectMode("aurora")}
				/>
				<Tile
					label="Color"
					preview={`linear-gradient(${color}, ${color})`}
					active={cfg.mode === "solid"}
					reduced={!!reduced}
					onClick={() => selectMode("solid")}
				/>
				<Tile
					label="Image"
					preview={cfg.mode === "image" && thumbUrl ? `url("${thumbUrl}")` : undefined}
					active={cfg.mode === "image"}
					reduced={!!reduced}
					onClick={() => selectMode("image")}
					overlay={
						importing ? (
							<Loader2 className="w-4 h-4 animate-spin text-primary" />
						) : cfg.mode === "image" && thumbUrl ? null : (
							<ImagePlus className="w-4 h-4 text-muted-foreground" />
						)
					}
				/>
			</div>

			{error && <p className="mt-3 text-[12px] text-red-500">{error}</p>}

			{/* ── Custom color picker ── */}
			{cfg.mode === "solid" && (
				<div className="mt-6 flex flex-col sm:flex-row gap-5 items-start">
					<div className="wallpaper-color-picker">
						<HexColorPicker color={color} onChange={(c) => update({ solidColor: c })} />
					</div>
					<div className="flex items-center gap-2">
						<span
							className="w-9 h-9 rounded-lg border border-border shrink-0"
							style={{ background: color }}
						/>
						<input
							type="text"
							value={color}
							onChange={(e) => update({ solidColor: e.target.value })}
							spellCheck={false}
							className="w-24 px-2 py-1.5 rounded-md border border-border bg-transparent text-[13px] font-mono text-foreground uppercase"
						/>
					</div>
				</div>
			)}

			{/* ── Image controls (readability) ── */}
			{cfg.mode === "image" && cfg.imageFile && (
				<>
					<button
						type="button"
						onClick={() => void pickImage()}
						className="mt-3 text-[12px] text-primary hover:underline"
					>
						Replace image…
					</button>
					<div className="mt-6 space-y-5 max-w-md">
						<Slider
							id="wallpaper-blur"
							label="Blur"
							value={cfg.blur}
							min={0}
							max={BLUR_MAX}
							step={1}
							display={`${cfg.blur}px`}
							onChange={(v) => update({ blur: v })}
						/>
						<Slider
							id="wallpaper-dim"
							label="Dim"
							value={cfg.dim}
							min={0}
							max={DIM_MAX}
							step={0.05}
							display={`${Math.round(cfg.dim * 100)}%`}
							onChange={(v) => update({ dim: v })}
						/>
					</div>
				</>
			)}

			<p className="mt-6 text-[11px] text-muted-foreground">
				Aurora is the default animated brand backdrop and respects your system's reduced-motion
				setting.
			</p>
		</section>
	);
}

function Tile({
	label,
	preview,
	active,
	reduced,
	onClick,
	overlay,
}: {
	label: string;
	preview?: string;
	active: boolean;
	reduced: boolean;
	onClick: () => void;
	overlay?: React.ReactNode;
}) {
	return (
		<button type="button" onClick={onClick} className="flex flex-col items-center gap-1.5">
			<motion.div
				className="relative w-full h-14 rounded-lg overflow-hidden border"
				style={{
					backgroundColor: "hsl(var(--muted) / 0.4)",
					backgroundImage: preview,
					backgroundSize: "cover",
					backgroundPosition: "center",
					borderColor: active ? "hsl(var(--primary))" : "hsl(var(--border))",
					boxShadow: active ? "0 0 0 2px hsl(var(--primary) / 0.35)" : "none",
				}}
				whileHover={reduced ? {} : { scale: 1.03 }}
				whileTap={reduced ? {} : { scale: 0.97 }}
				transition={{ duration: 0.14, ease }}
			>
				{overlay && (
					<span className="absolute inset-0 flex items-center justify-center">{overlay}</span>
				)}
			</motion.div>
			<span
				className="text-[11px] font-medium"
				style={{ color: active ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))" }}
			>
				{label}
			</span>
		</button>
	);
}

function Slider({
	id,
	label,
	value,
	min,
	max,
	step,
	display,
	onChange,
}: {
	id: string;
	label: string;
	value: number;
	min: number;
	max: number;
	step: number;
	display: string;
	onChange: (v: number) => void;
}) {
	return (
		<div>
			<div className="flex items-center justify-between mb-1.5">
				<label htmlFor={id} className="text-[13px] text-foreground">
					{label}
				</label>
				<span className="text-[12px] text-muted-foreground">{display}</span>
			</div>
			<input
				id={id}
				type="range"
				min={min}
				max={max}
				step={step}
				value={value}
				onChange={(e) => onChange(Number(e.target.value))}
				className="w-full cursor-pointer accent-primary"
			/>
		</div>
	);
}
