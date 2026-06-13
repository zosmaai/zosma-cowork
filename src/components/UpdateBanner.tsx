import type { UseAppUpdate } from "@/hooks/useAppUpdate";
import { Download, X } from "lucide-react";

interface UpdateBannerProps {
	update: UseAppUpdate;
}

/**
 * Dismissible "Update available" banner shown on launch (issue #271).
 *
 * Only renders for self-updatable builds with a pending update or an in-flight
 * download. Managed (package-manager) builds are handled in Settings → About
 * with a "update via your package manager" notice instead.
 */
export function UpdateBanner({ update }: UpdateBannerProps) {
	const { status, info, progress } = update;

	const downloading = status === "downloading" || status === "restarting";
	if (status !== "available" && !downloading) return null;

	return (
		<div className="flex items-center justify-center gap-3 px-3 py-1.5 text-xs shrink-0 text-foreground/80 bg-primary/10 border-b border-primary/20">
			<Download className="w-3.5 h-3.5 text-primary shrink-0" />
			{downloading ? (
				<span>{status === "restarting" ? "Restarting…" : `Downloading update… ${progress}%`}</span>
			) : (
				<>
					<span>
						Update available — <span className="font-semibold">v{info?.version}</span>
					</span>
					<button
						type="button"
						onClick={() => void update.installAndRestart()}
						className="underline hover:no-underline text-primary font-medium"
					>
						Install & Restart
					</button>
					<button
						type="button"
						aria-label="Dismiss"
						onClick={update.dismiss}
						className="ml-1 text-muted-foreground/70 hover:text-foreground transition-colors"
					>
						<X className="w-3.5 h-3.5" />
					</button>
				</>
			)}
		</div>
	);
}
