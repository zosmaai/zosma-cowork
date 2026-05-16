import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

export function CustomInstructions() {
	const [instructions, setInstructions] = useState("");
	const [saved, setSaved] = useState(false);
	const [loading, setLoading] = useState(true);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Load saved instructions on mount
	useEffect(() => {
		let cancelled = false;
		invoke<{ persona?: string }>("get_settings")
			.then((settings) => {
				if (cancelled) return;
				if (settings?.persona) {
					setInstructions(settings.persona);
				}
			})
			.catch(() => {
				// Silently fail
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const handleSave = async () => {
		try {
			await invoke("save_settings", { persona: instructions });
			setSaved(true);
			if (timerRef.current) clearTimeout(timerRef.current);
			timerRef.current = setTimeout(() => setSaved(false), 2000);
		} catch {
			// Silently fail
		}
	};

	const handleChange = (value: string) => {
		setInstructions(value);
		if (saved) setSaved(false);
	};

	return (
		<div>
			<textarea
				placeholder="e.g. You are a senior developer who prefers TypeScript..."
				value={instructions}
				onChange={(e) => handleChange(e.target.value)}
				rows={4}
				disabled={loading}
				className="w-full px-2.5 py-2 text-xs bg-sidebar-background border border-sidebar-border rounded resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-sidebar-foreground/30 disabled:opacity-50"
			/>
			<div className="flex items-center gap-2 mt-1.5">
				<button
					type="button"
					onClick={handleSave}
					disabled={loading}
					className="px-2.5 py-1 text-[10px] font-medium bg-primary text-primary-foreground rounded hover:bg-primary/80 disabled:opacity-50 transition-colors"
				>
					Save
				</button>
				{saved && (
					<span className="text-[10px] text-primary font-medium transition-opacity">Saved!</span>
				)}
			</div>
		</div>
	);
}
