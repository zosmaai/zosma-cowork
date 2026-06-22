/**
 * GithubIntegration — the Apps-tab launcher card for GitHub.
 *
 * Reads from the shared useGithub store so it never re-fetches on its own
 * and shares state with the detail page. Shows a skeleton on first load
 * instead of flashing the disconnected state.
 */

import { useGithub } from "@/hooks/useGithub";
import { Check, ChevronRight } from "lucide-react";

export function GithubIntegration({ onOpen }: { onOpen: () => void }) {
	const { status, user, info, loading } = useGithub();

	const connected = status === "connected";
	const orgCount = info?.orgs.length ?? 0;

	// First-load skeleton — only when we have nothing cached yet.
	if (loading && status === "unknown") {
		return (
			<div className="glass w-full px-3.5 py-3 flex items-center gap-3">
				<div className="w-8 h-8 rounded-lg bg-muted animate-pulse shrink-0" />
				<div className="flex-1 min-w-0 space-y-1.5">
					<div className="h-3 w-24 rounded bg-muted animate-pulse" />
					<div className="h-2.5 w-40 rounded bg-muted/70 animate-pulse" />
				</div>
			</div>
		);
	}

	const statusText = connected
		? orgCount > 0
			? `Connected · ${orgCount} ${orgCount === 1 ? "organization" : "organizations"}`
			: "Connected"
		: "Connect your GitHub account";

	return (
		<button
			type="button"
			onClick={onOpen}
			className="glass w-full text-left px-3.5 py-3 flex items-center gap-3 hover:bg-card/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
		>
			<span
				className="w-8 h-8 rounded-lg flex items-center justify-center text-[13px] font-bold shrink-0"
				style={{ background: "#24292F", color: "white" }}
				aria-hidden
			>
				G
			</span>
			<span className="flex-1 min-w-0">
				<span className="flex items-center gap-2">
					<span className="text-[13px] font-semibold text-foreground">GitHub</span>
					{connected && user && (
						<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 text-primary">
							<Check className="w-2.5 h-2.5" />
							{user}
						</span>
					)}
				</span>
				<span className="block text-[11px] text-muted-foreground mt-0.5 truncate">
					{statusText}
				</span>
			</span>
			<ChevronRight className="w-4 h-4 text-muted-foreground/60 shrink-0" />
		</button>
	);
}
