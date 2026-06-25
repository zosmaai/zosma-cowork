import { invoke } from "@tauri-apps/api/core";
import { FolderCog, FolderOpen, RotateCcw } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

/**
 * Workspace — choose the default ZosmaCowork home folder.
 *
 * "New" sessions are created inside this folder; it's the directory the agent
 * reads and writes files in. The default is `~/Documents/ZosmaCowork`
 * (resolved cross-platform in the sidecar via the OS home dir — never $USER).
 * The chosen path is persisted as the `coworkHomeDir` setting and read fresh
 * on every new session, so a change here takes effect on the next "New".
 */
export function Workspace() {
	const reduced = useReducedMotion();
	// `configured` = the user's saved override ("" means "use the default").
	// `fallback` = the sidecar's effective default when nothing is configured.
	const [configured, setConfigured] = useState<string>("");
	const [fallback, setFallback] = useState<string>("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let alive = true;
		(async () => {
			try {
				const [settings, ws] = await Promise.all([
					invoke<{ coworkHomeDir?: string }>("get_settings"),
					invoke<{ default?: string }>("get_workspace"),
				]);
				if (!alive) return;
				setConfigured(typeof settings?.coworkHomeDir === "string" ? settings.coworkHomeDir : "");
				setFallback(typeof ws?.default === "string" ? ws.default : "");
			} catch {
				// sidecar not ready yet — leave blanks; reopening Settings retries.
			}
		})();
		return () => {
			alive = false;
		};
	}, []);

	// The folder that will actually be used for new sessions right now.
	const effective = configured.trim() || fallback;

	async function persist(dir: string) {
		setBusy(true);
		setError(null);
		try {
			await invoke("save_settings", { settings: { coworkHomeDir: dir } });
			setConfigured(dir);
			// Refresh the effective default the sidecar reports.
			try {
				const ws = await invoke<{ default?: string }>("get_workspace");
				if (typeof ws?.default === "string") setFallback(ws.default);
			} catch {
				// non-fatal
			}
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not save the folder.");
		} finally {
			setBusy(false);
		}
	}

	async function chooseFolder() {
		try {
			const { open } = await import("@tauri-apps/plugin-dialog");
			const picked = await open({
				directory: true,
				multiple: false,
				title: "Choose your ZosmaCowork folder",
				...(effective ? { defaultPath: effective } : {}),
			});
			if (typeof picked === "string") await persist(picked);
		} catch {
			setError("Folder picker is unavailable here.");
		}
	}

	return (
		<section>
			<h2 className="text-sm font-semibold text-foreground mb-1">Workspace</h2>
			<p className="text-xs text-muted-foreground mb-5">
				The default folder for new sessions. The agent reads and writes files here.
			</p>

			<div className="glass w-full flex items-center justify-between gap-3 px-4 py-3">
				<div className="flex items-center gap-3 min-w-0">
					<div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 shrink-0">
						<FolderCog className="w-4 h-4 text-primary" />
					</div>
					<div className="text-left min-w-0">
						<p className="text-[13px] font-medium text-foreground">ZosmaCowork folder</p>
						<p className="text-[11px] text-muted-foreground truncate" title={effective}>
							{effective || "Loading…"}
							{!configured.trim() && fallback ? "  ·  default" : ""}
						</p>
					</div>
				</div>
				<motion.button
					type="button"
					onClick={chooseFolder}
					disabled={busy}
					className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium shrink-0 disabled:opacity-50 text-primary bg-primary/10 hover:bg-primary/15 transition-colors"
					whileHover={reduced || busy ? {} : { scale: 1.03 }}
					whileTap={reduced || busy ? {} : { scale: 0.97 }}
					transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
				>
					<FolderOpen className="w-3.5 h-3.5" />
					Change
				</motion.button>
			</div>

			{configured.trim() ? (
				<button
					type="button"
					onClick={() => persist("")}
					disabled={busy}
					className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
				>
					<RotateCcw className="w-3 h-3" />
					Reset to default
				</button>
			) : null}

			{error ? <p className="mt-2 text-[11px] text-destructive">{error}</p> : null}
		</section>
	);
}
