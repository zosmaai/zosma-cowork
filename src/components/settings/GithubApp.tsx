/**
 * GithubApp — full-page GitHub app setup view.
 *
 * Uses PAT (Personal Access Token) auth: user creates a token on GitHub,
 * pastes it here, and the sidecar runs `gh auth login --with-token`.
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
	Eye,
	EyeOff,
	Loader2,
	User,
	Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

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

type Phase = "idle" | "saving" | "connected" | "error";

export function GithubApp({ onBack }: { onBack: () => void }) {
	const [phase, setPhase] = useState<Phase>("idle");
	const [userInfo, setUserInfo] = useState<GitHubOrgs | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [token, setToken] = useState("");
	const [showToken, setShowToken] = useState(false);

	// Probe auth status on mount
	const refresh = useCallback(async () => {
		try {
			const s = await invoke<{ connected: boolean; hosts?: Record<string, GitHubHost> }>(
				"gh_auth_status",
			);
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
		refresh();
	}, [refresh]);

	// Save PAT
	const handleSaveToken = useCallback(async () => {
		if (!token.trim()) return;
		setLoading(true);
		setError(null);
		try {
			await invoke("gh_save_token", { token: token.trim() });
			// Re-probe to show connected state
			await refresh();
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [token, refresh]);

	// Open GitHub token page
	const openTokenPage = useCallback(() => {
		openExternalUrl("https://github.com/settings/tokens?type=beta");
	}, []);

	// Copy token help text
	const copyHelp = useCallback(() => {
		navigator.clipboard?.writeText(
			"GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token\n\n" +
			"Required scopes: repo, workflow, read:org, read:user, user:email",
		);
	}, []);

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

				{/* Hint */}
				<div className="mt-6 glass px-4 py-3.5">
					<p className="text-[12px] text-foreground/80 leading-relaxed">
						Git and the GitHub CLI are bundled with Cowork. The agent can manage issues,
						PRs, repos, and Actions — you can describe what you need in the chat.
					</p>
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
							projects, and Actions.
						</p>

						{/* Step 1: Create token */}
						<div className="mb-4">
							<div className="text-[11px] font-semibold text-foreground mb-2">
								1. Create a GitHub personal access token
							</div>
							<button
								type="button"
								onClick={openTokenPage}
								className="inline-flex items-center gap-1.5 text-[12px] text-primary hover:underline"
							>
								github.com/settings/tokens
								<ExternalLink className="w-3 h-3" />
							</button>
							<p className="text-[11px] text-muted-foreground mt-1">
								Create a <strong>Fine-grained token</strong> with repo, workflow,
								read:org, read:user, and user:email permissions.
							</p>
						</div>

						{/* Step 2: Paste token */}
						<div className="mb-4">
							<div className="text-[11px] font-semibold text-foreground mb-2">
								2. Paste your token here
							</div>
							<div className="flex items-center gap-2">
								<div className="relative flex-1">
									<input
										type={showToken ? "text" : "password"}
										value={token}
										onChange={(e) => setToken(e.target.value)}
										placeholder="ghp_..."
										className="w-full text-[13px] bg-background border border-border rounded-lg px-3 py-2 pr-8 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
									/>
									<button
										type="button"
										onClick={() => setShowToken(!showToken)}
										className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
									>
										{showToken ? (
											<EyeOff className="w-3.5 h-3.5" />
										) : (
											<Eye className="w-3.5 h-3.5" />
										)}
									</button>
								</div>
								<button
									type="button"
									onClick={handleSaveToken}
									disabled={!token.trim() || loading}
									className="px-4 py-2 rounded-lg text-[13px] font-medium text-primary bg-primary/10 hover:bg-primary/15 transition-colors disabled:opacity-50 whitespace-nowrap"
								>
									{loading ? (
										<Loader2 className="w-4 h-4 animate-spin" />
									) : (
										"Connect"
									)}
								</button>
							</div>
						</div>

						{/* Copy help */}
						<button
							type="button"
							onClick={copyHelp}
							className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
						>
							<Copy className="w-3 h-3" />
							Copy instructions to clipboard
						</button>
					</div>
				</div>
			</div>

			{/* Prerequisites info */}
			<div className="mt-4 glass px-4 py-3.5">
				<p className="text-[12px] text-foreground/80 leading-relaxed">
					Git and the GitHub CLI are bundled with Cowork. They're available to the agent
					on all platforms with no manual installation.
				</p>
			</div>
		</section>
	);
}
