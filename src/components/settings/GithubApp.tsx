/**
 * GithubApp — full-page GitHub app setup view.
 *
 * Auth flow: launches `gh auth login --web` which opens the browser,
 * handles OAuth, saves the token, and configures git's credential
 * helper. The frontend polls gh_auth_status until connected.
 *
 * Follows the same pattern as GoogleApp and DiscordApp.
 */

import { invoke } from "@tauri-apps/api/core";
import {
	Check,
	ChevronLeft,
	ExternalLink,
	Loader2,
	RefreshCw,
	User,
	Users,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface Org {
	login: string;
	role: string;
	avatar_url: string;
}

interface GitHubOrgs {
	user: { login: string; name: string | null; avatar_url: string; email: string | null };
	orgs: Org[];
	totalRepos: number;
}

interface GitHubHost {
	user: string;
}

type Phase = "idle" | "launching" | "waiting_auth" | "connected" | "error";

export function GithubApp({ onBack }: { onBack: () => void }) {
	const [phase, setPhase] = useState<Phase>("idle");
	const [userInfo, setUserInfo] = useState<GitHubOrgs | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

	// Probe auth status on mount + cleanup on unmount
	const refresh = useCallback(async () => {
		try {
			const s = await invoke<{ connected: boolean; hosts?: Record<string, GitHubHost> }>(
				"gh_auth_status",
			);
			if (s.connected) {
				setPhase("connected");
				const orgs = await invoke<GitHubOrgs>("gh_organizations");
				setUserInfo(orgs);
				if (pollRef.current) {
					clearInterval(pollRef.current);
					pollRef.current = null;
				}
			}
		} catch {
			// not connected
		}
	}, []);

	useEffect(() => {
		refresh();
		return () => {
			if (pollRef.current) clearInterval(pollRef.current);
		};
	}, [refresh]);

	// Start polling for connection after launching browser
	const startPolling = useCallback(() => {
		if (pollRef.current) clearInterval(pollRef.current);
		pollRef.current = setInterval(refresh, 3000);

		// Safety timeout — 5 minutes
		setTimeout(() => {
			if (pollRef.current) {
				clearInterval(pollRef.current);
				pollRef.current = null;
				if (phase === "waiting_auth") {
					setError("Authentication timed out. Please try again.");
					setPhase("idle");
				}
			}
		}, 5 * 60 * 1000);
	}, [refresh, phase]);

	// Launch gh auth login --web in the sidecar
	const handleConnect = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			await invoke("gh_auth_login");
			setPhase("waiting_auth");
			startPolling();
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : String(err));
			setPhase("idle");
		} finally {
			setLoading(false);
		}
	}, [startPolling]);

	// ── Connected state ──
	if (phase === "connected" && userInfo) {
		return (
			<section className="max-w-3xl">
				<button
					type="button"
					onClick={onBack}
					className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4"
				>
					<ChevronLeft className="w-3.5 h-3.5" />
					Back to Apps
				</button>

				<div className="glass px-4 py-3 mb-4 flex items-center justify-between">
					<div className="flex items-center gap-2">
						<Check className="w-4 h-4 text-primary" />
						<span className="text-[13px] font-semibold text-foreground">GitHub Connected</span>
					</div>
				</div>

				<h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
					Personal Account
				</h3>
				<div className="glass px-3.5 py-3 flex items-center gap-3 mb-5">
					<div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
						{userInfo.user.avatar_url ? (
							<img
								src={userInfo.user.avatar_url}
								alt={userInfo.user.login}
								className="w-full h-full object-cover"
							/>
						) : (
							<User className="w-4 h-4 text-muted-foreground" />
						)}
					</div>
					<div className="flex-1 min-w-0">
						<div className="text-[13px] font-semibold text-foreground truncate">
							@{userInfo.user.login}
						</div>
						{userInfo.user.name && (
							<div className="text-[11px] text-muted-foreground truncate">
								{userInfo.user.name}
							</div>
						)}
					</div>
					<div className="text-right">
						<div className="text-[11px] text-muted-foreground">Repos</div>
						<div className="text-[13px] font-semibold">{userInfo.totalRepos}</div>
					</div>
				</div>

				{userInfo.orgs.length > 0 && (
					<>
						<h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
							Organizations ({userInfo.orgs.length})
						</h3>
						<div className="space-y-2">
							{userInfo.orgs.map((org) => (
								<div
									key={org.login}
									className="glass px-3.5 py-3 flex items-center gap-3"
								>
									<div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
										{org.avatar_url ? (
											<img
												src={org.avatar_url}
												alt={org.login}
												className="w-full h-full object-cover"
											/>
										) : (
											<Users className="w-4 h-4 text-muted-foreground" />
										)}
									</div>
									<div className="flex-1 min-w-0">
										<div className="text-[13px] font-semibold text-foreground truncate">
											@{org.login}
										</div>
									</div>
									<div className="text-[11px] text-muted-foreground capitalize">
										{org.role === "admin" ? "Owner" : org.role.toLowerCase()}
									</div>
								</div>
							))}
						</div>
					</>
				)}

				<div className="mt-6 glass px-4 py-3.5">
					<p className="text-[12px] text-foreground/80 leading-relaxed">
						Git and the GitHub CLI are bundled with Cowork. The agent can manage issues,
						PRs, repos, and Actions — describe what you need in the chat. Git operations
						over HTTPS use your stored token automatically — no SSH keys needed.
					</p>
				</div>
			</section>
		);
	}

	// ── Waiting for browser auth ──
	if (phase === "waiting_auth") {
		return (
			<section className="max-w-3xl">
				<button
					type="button"
					onClick={() => {
						if (pollRef.current) clearInterval(pollRef.current);
						setPhase("idle");
					}}
					className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4"
				>
					<ChevronLeft className="w-3.5 h-3.5" />
					Back to Apps
				</button>

				<div className="glass px-5 py-6 text-center">
					<ExternalLink className="w-8 h-8 text-primary mx-auto mb-3" />
					<p className="text-[13px] font-semibold text-foreground mb-2">
						GitHub Authorization in Progress
					</p>
					<p className="text-[11px] text-muted-foreground leading-relaxed mb-5">
						A browser window should have opened to GitHub.
						If it didn't, run <code className="text-foreground">gh auth login --web</code> in your terminal.
					</p>
					<div className="flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
						<Loader2 className="w-3.5 h-3.5 animate-spin" />
						Waiting for you to complete authorization in your browser...
					</div>
				</div>
			</section>
		);
	}

	// ── Idle / Not connected ──
	return (
		<section className="max-w-3xl">
			<button
				type="button"
				onClick={onBack}
				className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4"
			>
				<ChevronLeft className="w-3.5 h-3.5" />
				Back to Apps
			</button>

			{error && (
				<div className="mb-4 px-3.5 py-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-[12px] text-destructive">
					{error}
				</div>
			)}

			<div className="glass px-5 py-6">
				<div className="flex items-start gap-4">
					<span
						className="w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold shrink-0"
						style={{ background: "#24292F", color: "white" }}
					>
						G
					</span>
					<div className="flex-1 min-w-0">
						<h3 className="text-[15px] font-semibold text-foreground mb-1">GitHub</h3>
						<p className="text-[12px] text-muted-foreground leading-relaxed mb-4">
							Connect your GitHub account so the agent can manage issues, pull requests,
							projects, and Actions. <strong>No personal access token needed</strong> —
							GitHub CLI handles authentication.
						</p>

						<button
							type="button"
							onClick={handleConnect}
							disabled={loading}
							className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium text-primary bg-primary/10 hover:bg-primary/15 transition-colors disabled:opacity-50"
						>
							{loading ? (
								<Loader2 className="w-4 h-4 animate-spin" />
							) : (
								<RefreshCw className="w-4 h-4" />
							)}
							{loading ? "Starting..." : "Connect with GitHub"}
						</button>

						<p className="mt-2 text-[11px] text-muted-foreground">
							Don't have GitHub?{" "}
							<a
								href="https://github.com/signup"
								target="_blank"
								rel="noreferrer"
								className="text-primary hover:underline"
							>
								Sign up for free
							</a>
						</p>
					</div>
				</div>
			</div>

			<div className="mt-4 glass px-4 py-3.5">
				<p className="text-[12px] text-foreground/80 leading-relaxed">
					Git and the GitHub CLI are bundled with Cowork. Once authenticated, git operations
					over HTTPS use your stored token automatically — no SSH keys needed.
				</p>
			</div>
		</section>
	);
}
