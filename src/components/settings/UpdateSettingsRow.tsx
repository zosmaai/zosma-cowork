import type { UseAppUpdate } from "@/hooks/useAppUpdate";
import { Download, Loader2, RefreshCw } from "lucide-react";

interface UpdateSettingsRowProps {
	update: UseAppUpdate;
}

/**
 * "Check for updates" control for Settings → About (issue #271).
 *
 * Renders the full state machine: idle → checking → up-to-date / available →
 * downloading(progress) → restarting, plus managed-channel and error states.
 */
export function UpdateSettingsRow({ update }: UpdateSettingsRowProps) {
	const { status, info, progress, policy, error } = update;

	return (
		<div className="flex items-center gap-3">
			<span className="text-[11px] text-muted-foreground w-16 shrink-0">Updates</span>
			<div className="text-[12px] flex items-center gap-2 flex-wrap">
				{status === "idle" && (
					<button
						type="button"
						onClick={() => void update.checkNow()}
						className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-border hover:bg-muted/50 transition-colors text-foreground/80"
					>
						<RefreshCw className="w-3 h-3" />
						Check for updates
					</button>
				)}

				{status === "checking" && (
					<span className="inline-flex items-center gap-1.5 text-muted-foreground">
						<Loader2 className="w-3 h-3 animate-spin" />
						Checking…
					</span>
				)}

				{status === "uptodate" && <span className="text-foreground/70">You’re up to date.</span>}

				{status === "available" && (
					<>
						<span className="text-foreground/80">
							Update available — <span className="font-semibold">v{info?.version}</span>
						</span>
						<button
							type="button"
							onClick={() => void update.installAndRestart()}
							className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-primary border border-primary/30 hover:bg-primary/10 transition-colors"
						>
							<Download className="w-3 h-3" />
							Install & Restart
						</button>
					</>
				)}

				{status === "downloading" && (
					<span className="inline-flex items-center gap-1.5 text-muted-foreground">
						<Loader2 className="w-3 h-3 animate-spin" />
						Downloading… {progress}%
					</span>
				)}

				{status === "restarting" && (
					<span className="inline-flex items-center gap-1.5 text-muted-foreground">
						<Loader2 className="w-3 h-3 animate-spin" />
						Restarting…
					</span>
				)}

				{status === "managed" && (
					<span className="text-foreground/70">
						{policy?.reason ?? "Update via your package manager."}
					</span>
				)}

				{status === "error" && (
					<span className="text-destructive">{error ?? "Update failed."}</span>
				)}
			</div>
		</div>
	);
}
