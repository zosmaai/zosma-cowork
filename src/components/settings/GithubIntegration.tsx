/**
 * GithubIntegration — the Apps-tab launcher card for GitHub.
 *
 * Mirrors the Google/GoogleLauncher pattern. Probes gh auth status via
 * the `gh_auth_status` IPC command (registered in agent-sidecar).
 * Click opens the full-page GithubApp for setup and account display.
 */

import { invoke } from "@tauri-apps/api/core";
import { Check, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

export function GithubIntegration({ onOpen }: { onOpen: () => void }) {
	const [connected, setConnected] = useState(false);
	const [user, setUser] = useState<string | null>(null);
	const [orgCount, setOrgCount] = useState(0);

	const refresh = useCallback(async () => {
		try {
			const res = await invoke<{ connected: boolean; hosts?: Record<string, { user: string }> }>(
				"gh_auth_status",
			);
			setConnected(res.connected);
			if (res.connected && res.hosts?.["github.com"]) {
				setUser(res.hosts["github.com"].user);
			} else {
				setUser(null);
			}
		} catch {
			setConnected(false);
			setUser(null);
		}

		// Also fetch org count for richer status display
		if (connected) {
			try {
				const orgRes = await invoke<{ orgs: unknown[] }>("gh_organizations");
				setOrgCount(orgRes.orgs?.length ?? 0);
			} catch {
				setOrgCount(0);
			}
		}
	}, [connected]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const statusText = connected
		? `${user ?? "Connected"} · ${orgCount} organization(s)`
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
					{connected && (
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
