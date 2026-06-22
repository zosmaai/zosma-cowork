/**
 * GithubApp — full-page GitHub app setup view.
 *
 * Two states:
 *   1. Not connected — shows Connect with GitHub (device code) or PAT option
 *   2. Connected — shows personal account + organizations with avatars
 *
 * Follows the same pattern as GoogleApp and DiscordApp.
 */

import { invoke } from "@tauri-apps/api/core";
import { openExternalUrl } from "@/lib/utils";
import {
	Check,
	ChevronLeft,
	Copy,
	ExternalLink,
	Loader2,
	Trash2,
	User,
	Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type Phase =
	| "idle" // not connected
	| "waiting_auth" // waiting for user to complete device flow
	| "connected" // authenticated, showing accounts
	| "error";

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

export function GithubApp({ onBack }: { onBack: () => void }) {
	const [phase, setPhase] = useState<Phase>("idle");
	const [userInfo, setUserInfo] = useState<GitHubOrgs | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [deviceCode, setDeviceCode] = useState<string | null>(null);
	const [deviceUrl, setDeviceUrl] = useState<string>("https://github.com/login/device");

	// Probe auth status on mount
	const refreshStatus = useCallback(async () => {
		try {
			const s = await invoke<{ connected: boolean }>("gh_auth_status");
			if (s.connected) {
				setPhase("connected");
				const orgs = await invoke<GitHubOrgs>("gh_organizations");
				setUserInfo(orgs);
			} else {
				setPhase("idle");
				setUserInfo(null);
			}
		} catch {
			setPhase("idle");
		}
	}, []);

	useEffect(() => {
		refreshStatus();
	}, [refreshStatus]);

	// Start GitHub device-code auth
	const handleConnect = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const result = await invoke<{ code: string | null; url: string }>("gh_start_auth");
			setDeviceCode(result.code);
			setDeviceUrl(result.url);
			setPhase("waiting_auth");

			// Poll for auth completion
			const poll = setInterval(async () => {
				try {
					const s = await invoke<{ connected: boolean }>("gh_auth_status");
					if (s.connected) {
						clearInterval(poll);
						setPhase("connected");
						const orgs = await invoke<GitHubOrgs>("gh_organizations");
						setUserInfo(orgs);
					}
				} catch {
					// keep polling
				}
			}, 3000);

			// Safety timeout — stop polling after 5 minutes
			setTimeout(() => clearInterval(poll), 5 * 60 * 1000);
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : String(err));
			setPhase("idle");
		} finally {
			setLoading(false);
		}
	}, []);

	// Disconnect — re-probe status (gh auth logout must be done manually)
	const handleDisconnect = useCallback(async () => {
		setLoading(true);
		try {
			// gh auth handles its own credential management.
			// Re-probe to refresh the UI state.
			await refreshStatus();
		} catch {
			setError("Failed to refresh status");
		} finally {
			setLoading(false);
		}
	}, [refreshStatus]);

	const openDeviceUrl = useCallback(() => {
		openExternalUrl(deviceUrl);
	}, [deviceUrl]);

	const copyCode = useCallback(() => {
		if (deviceCode) navigator.clipboard?.writeText(deviceCode);
	}, [deviceCode]);

	// ── Connected state: show accounts & orgs ──
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
					<button
						type="button"
						onClick={handleDisconnect}
						disabled={loading}
						className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
					>
						<Trash2 className="w-3.5 h-3.5" />
						Disconnect
					</button>
				</div>

				{/* Personal account */}
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

				{/* Organizations */}
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

				{/* Refresh / usage hint */}
				<div className="mt-6 glass px-4 py-3.5">
					<p className="text-[12px] text-foreground/80 leading-relaxed">
						Git and GitHub CLI are bundled with Cowork. The agent can manage issues, PRs,
						repos, and Actions — just describe what you need in the chat.
					</p>
				</div>
			</section>
		);
	}

	// ── Device code auth in progress ──
	if (phase === "waiting_auth") {
		return (
			<section className="max-w-3xl">
				<button
					type="button"
					onClick={() => setPhase("idle")}
					className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4"
				>
					<ChevronLeft className="w-3.5 h-3.5" />
					Back to Apps
				</button>

				<div className="glass px-5 py-6 text-center">
					<div className="text-[13px] font-semibold text-foreground mb-4">
						Authenticate with GitHub
					</div>

					<div className="space-y-5">
						{/* Step 1: Show device code */}
						<div>
							<div className="text-[11px] text-muted-foreground mb-2">
								1. Copy your one-time code:
							</div>
							<div className="flex items-center justify-center gap-2">
								<code className="text-lg font-mono font-bold tracking-widest bg-background px-4 py-2 rounded-lg border border-border select-all">
									{deviceCode ?? "XXXX-XXXX"}
								</code>
								<button
									type="button"
									onClick={copyCode}
									className="p-2 rounded-lg hover:bg-card/60 transition-colors"
									title="Copy code"
								>
									<Copy className="w-4 h-4 text-muted-foreground" />
								</button>
							</div>
						</div>

						{/* Step 2: Open URL */}
						<div>
							<div className="text-[11px] text-muted-foreground mb-2">
								2. Open this URL in your browser:
							</div>
							<button
								type="button"
								onClick={openDeviceUrl}
								className="inline-flex items-center gap-1.5 text-[13px] text-primary hover:underline"
							>
								{deviceUrl}
								<ExternalLink className="w-3.5 h-3.5" />
							</button>
						</div>

						{/* Step 3: Waiting */}
						<div className="flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
							<Loader2 className="w-3.5 h-3.5 animate-spin" />
							3. Waiting for you to complete authentication in your browser...
						</div>
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
							Connect your GitHub account to unlock issue tracking, pull requests,
							project management, and Actions — all accessible through your agent.
						</p>

						{/* Connect button */}
						<button
							type="button"
							onClick={handleConnect}
							disabled={loading}
							className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium text-primary bg-primary/10 hover:bg-primary/15 transition-colors disabled:opacity-50"
						>
							{loading ? (
								<Loader2 className="w-4 h-4 animate-spin" />
							) : (
								<ExternalLink className="w-4 h-4" />
							)}
							{loading ? "Starting..." : "Connect with GitHub"}
						</button>

						<p className="mt-3 text-[11px] text-muted-foreground">
							Opens GitHub's device-code flow. You'll enter a code in your browser to authorize.
							No personal access token needed.
						</p>
					</div>
				</div>
			</div>

			{/* Prerequisites info */}
			<div className="mt-4 glass px-4 py-3.5">
				<p className="text-[12px] text-foreground/80 leading-relaxed">
					<strong>Prerequisites:</strong> Git and the GitHub CLI (<code>gh</code>)
					are bundled with Cowork. They're available to the agent on all platforms.
					No manual installation needed.
				</p>
			</div>
		</section>
	);
}
