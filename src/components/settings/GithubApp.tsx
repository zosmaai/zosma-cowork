/**
 * GithubApp — full-page GitHub integration view.
 *
 * Auth: drives `gh auth login --web` device flow via the sidecar. gh
 * prints a one-time code + device URL and polls for authorization on
 * its own, then saves the token and configures git's credential helper.
 * The UI shows the code, opens the browser (Tauri), and polls
 * gh_auth_status until connected.
 */

import { useGithub } from "@/hooks/useGithub";
import { openExternalUrl } from "@/lib/utils";
import {
	Check,
	ChevronDown,
	ChevronLeft,
	Copy,
	ExternalLink,
	GitBranch,
	GitPullRequest,
	Loader2,
	LogOut,
	Play,
	RefreshCw,
	Shield,
	User,
	Users,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type Phase = "idle" | "connecting" | "waiting_auth";

// Default scopes requested — enough for issues, PRs, projects, Actions.
const DEFAULT_SCOPES = "repo,read:org,gist,workflow,read:user,project";

const CAPABILITIES = [
	{
		icon: GitBranch,
		title: "Repos & Code",
		desc: "Clone, branch, commit, and push over HTTPS — no SSH keys needed.",
	},
	{
		icon: GitPullRequest,
		title: "Issues & PRs",
		desc: "Create, review, comment on, and merge pull requests and issues.",
	},
	{
		icon: Play,
		title: "Actions",
		desc: "Trigger workflows, watch runs, and read logs from CI/CD.",
	},
	{
		icon: Users,
		title: "Projects & Orgs",
		desc: "Manage project boards and work across your organizations.",
	},
];

const SCOPE_LABELS: Record<string, string> = {
	repo: "Repositories",
	"read:org": "Organizations",
	gist: "Gists",
	workflow: "Actions / Workflows",
	"read:user": "Profile",
	project: "Projects",
	"admin:org": "Org admin",
	"admin:public_key": "SSH keys",
	"admin:gpg_key": "GPG keys",
};

export function GithubApp({ onBack }: { onBack: () => void }) {
	const store = useGithub();
	const { status, info, loading } = store;

	const [phase, setPhase] = useState<Phase>("idle");
	const [code, setCode] = useState<string | null>(null);
	const [deviceUrl, setDeviceUrl] = useState("https://github.com/login/device");
	const [error, setError] = useState<string | null>(null);
	const [copied, setCopied] = useState(false);
	const [showManual, setShowManual] = useState(false);
	const [busy, setBusy] = useState(false);
	const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const clearTimers = useCallback(() => {
		if (pollRef.current) {
			clearInterval(pollRef.current);
			pollRef.current = null;
		}
		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current);
			timeoutRef.current = null;
		}
	}, []);

	// When the store reports connected (e.g. polling detected auth), leave
	// the auth sub-flow and stop timers.
	useEffect(() => {
		if (status === "connected") {
			setPhase("idle");
			clearTimers();
		}
	}, [status, clearTimers]);

	useEffect(() => () => clearTimers(), [clearTimers]);

	// Start the device-code flow.
	const handleConnect = useCallback(async () => {
		setBusy(true);
		setError(null);
		setPhase("connecting");
		try {
			const res = await store.connect(DEFAULT_SCOPES);
			setCode(res.code);
			setDeviceUrl(res.url);
			setPhase("waiting_auth");

			// Auto-copy the code and open the browser for the user.
			try {
				await navigator.clipboard?.writeText(res.code);
				setCopied(true);
			} catch {
				/* clipboard may be blocked */
			}
			openExternalUrl(res.url);

			// Poll for completion via the shared store.
			pollRef.current = setInterval(() => {
				void store.refresh();
			}, 3000);
			timeoutRef.current = setTimeout(
				() => {
					clearTimers();
					setError("Authorization timed out. Please try again.");
					setPhase("idle");
				},
				5 * 60 * 1000,
			);
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : String(err));
			setPhase("idle");
		} finally {
			setBusy(false);
		}
	}, [store, clearTimers]);

	const cancel = useCallback(async () => {
		clearTimers();
		await store.cancel();
		setPhase("idle");
	}, [store, clearTimers]);

	const disconnect = useCallback(async () => {
		setBusy(true);
		await store.disconnect();
		setPhase("idle");
		setBusy(false);
	}, [store]);

	const copyCode = useCallback(() => {
		if (code) {
			navigator.clipboard?.writeText(code);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		}
	}, [code]);

	const Header = (
		<button
			type="button"
			onClick={phase === "waiting_auth" || phase === "connecting" ? cancel : onBack}
			className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4"
		>
			<ChevronLeft className="w-3.5 h-3.5" />
			Back to Apps
		</button>
	);

	// ─────────────────────── Loading skeleton ───────────────────────
	// Show while we don't yet know the state, or we're connected but the
	// account details are still loading — never flash the Connect screen.
	const showSkeleton =
		phase === "idle" && ((loading && status === "unknown") || (status === "connected" && !info));
	if (showSkeleton) {
		return (
			<section className="max-w-3xl">
				{Header}
				<GithubSkeleton />
			</section>
		);
	}

	// ─────────────────────────── Connected ───────────────────────────
	if (status === "connected" && info && phase === "idle") {
		return (
			<section className="max-w-3xl">
				{Header}

				<div className="glass px-4 py-3 mb-4 flex items-center justify-between">
					<div className="flex items-center gap-2">
						<Check className="w-4 h-4 text-primary" />
						<span className="text-[13px] font-semibold text-foreground">GitHub Connected</span>
					</div>
					<button
						type="button"
						onClick={disconnect}
						disabled={busy}
						className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
					>
						<LogOut className="w-3.5 h-3.5" />
						Disconnect
					</button>
				</div>

				{/* Account */}
				<h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
					Account
				</h3>
				<div className="glass px-3.5 py-3 flex items-center gap-3 mb-5">
					<Avatar
						src={info.user.avatar_url}
						fallback={<User className="w-4 h-4 text-muted-foreground" />}
					/>
					<div className="flex-1 min-w-0">
						<div className="text-[13px] font-semibold text-foreground truncate">
							@{info.user.login}
						</div>
						{info.user.name && (
							<div className="text-[11px] text-muted-foreground truncate">{info.user.name}</div>
						)}
					</div>
					<div className="text-right">
						<div className="text-[11px] text-muted-foreground">Repositories</div>
						<div className="text-[13px] font-semibold">{info.totalRepos}</div>
					</div>
				</div>

				{/* Organizations */}
				{info.orgs.length > 0 && (
					<>
						<h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
							Organizations ({info.orgs.length})
						</h3>
						<div className="space-y-2 mb-5">
							{info.orgs.map((org) => (
								<div key={org.login} className="glass px-3.5 py-3 flex items-center gap-3">
									<Avatar
										src={org.avatar_url}
										fallback={<Users className="w-4 h-4 text-muted-foreground" />}
									/>
									<div className="flex-1 min-w-0">
										<div className="text-[13px] font-semibold text-foreground truncate">
											@{org.login}
										</div>
									</div>
									<span className="text-[11px] text-muted-foreground capitalize">
										{org.role === "admin" ? "Owner" : org.role}
									</span>
								</div>
							))}
						</div>
					</>
				)}

				{/* Granted scopes */}
				{info.scopes.length > 0 && (
					<>
						<h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
							<Shield className="w-3 h-3" />
							Granted Access
						</h3>
						<div className="flex flex-wrap gap-1.5 mb-5">
							{info.scopes.map((sc) => (
								<span
									key={sc}
									className="px-2 py-1 rounded-md text-[11px] bg-card/60 border border-border text-foreground/80"
									title={sc}
								>
									{SCOPE_LABELS[sc] ?? sc}
								</span>
							))}
						</div>
					</>
				)}

				<div className="glass px-4 py-3.5">
					<p className="text-[12px] text-foreground/80 leading-relaxed">
						<strong>You're all set.</strong> Just ask the agent in chat — e.g. "open a PR for this
						branch", "list my open issues in zosmaai/cowork", or "what failed in the last CI run".
						Git operations over HTTPS use your token automatically.
					</p>
				</div>
			</section>
		);
	}

	// ──────────────────────── Waiting for auth ────────────────────────
	if (phase === "waiting_auth") {
		return (
			<section className="max-w-3xl">
				{Header}
				<div className="glass px-5 py-6">
					<div className="text-center mb-5">
						<p className="text-[14px] font-semibold text-foreground mb-1">
							Enter this code on GitHub
						</p>
						<p className="text-[11px] text-muted-foreground">
							We opened your browser to <span className="text-foreground">{deviceUrl}</span>
						</p>
					</div>

					{/* The code */}
					<div className="flex items-center justify-center gap-2 mb-5">
						<button
							type="button"
							onClick={copyCode}
							className="group flex items-center gap-3 px-6 py-3 rounded-xl bg-background border border-border hover:border-primary/40 transition-colors"
						>
							<code className="text-2xl font-mono font-bold tracking-[0.3em] text-foreground select-all">
								{code ?? "----−----"}
							</code>
							{copied ? (
								<Check className="w-4 h-4 text-primary" />
							) : (
								<Copy className="w-4 h-4 text-muted-foreground group-hover:text-foreground" />
							)}
						</button>
					</div>
					<p className="text-center text-[11px] text-muted-foreground mb-5">
						{copied ? "Copied to clipboard — paste it on GitHub." : "Click the code to copy it."}
					</p>

					<button
						type="button"
						onClick={() => openExternalUrl(deviceUrl)}
						className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[13px] font-medium text-primary-foreground bg-primary hover:bg-primary/90 transition-colors mb-4"
					>
						<ExternalLink className="w-4 h-4" />
						Open GitHub
					</button>

					<div className="flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
						<Loader2 className="w-3.5 h-3.5 animate-spin" />
						Waiting for you to authorize…
					</div>
				</div>
			</section>
		);
	}

	// ──────────────────────── Idle / connecting ────────────────────────
	return (
		<section className="max-w-3xl">
			{Header}

			{error && (
				<div className="mb-4 px-3.5 py-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-[12px] text-destructive">
					{error}
				</div>
			)}

			{/* Hero */}
			<div className="glass px-5 py-6 mb-4">
				<div className="flex items-start gap-4">
					<span
						className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
						style={{ background: "#24292F" }}
						aria-hidden
					>
						<GithubGlyph />
					</span>
					<div className="flex-1 min-w-0">
						<h3 className="text-[15px] font-semibold text-foreground mb-1">GitHub</h3>
						<p className="text-[12px] text-muted-foreground leading-relaxed mb-4">
							Connect your account so the agent can work with your repos, issues, pull requests,
							projects, and Actions. Authentication uses GitHub's own device flow —{" "}
							<strong>no personal access token to create or paste.</strong>
						</p>
						<button
							type="button"
							onClick={handleConnect}
							disabled={busy}
							className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium text-primary-foreground bg-primary hover:bg-primary/90 transition-colors disabled:opacity-50"
						>
							{busy ? (
								<Loader2 className="w-4 h-4 animate-spin" />
							) : (
								<RefreshCw className="w-4 h-4" />
							)}
							{busy ? "Starting…" : "Connect with GitHub"}
						</button>
						<p className="mt-2.5 text-[11px] text-muted-foreground">
							Don't have an account?{" "}
							<button
								type="button"
								onClick={() => openExternalUrl("https://github.com/signup")}
								className="text-primary hover:underline"
							>
								Sign up free
							</button>{" "}
							— then come back and connect.
						</p>
					</div>
				</div>
			</div>

			{/* What the agent can do */}
			<h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
				What you can do
			</h3>
			<div className="grid grid-cols-2 gap-2 mb-4">
				{CAPABILITIES.map((c) => (
					<div key={c.title} className="glass px-3.5 py-3">
						<c.icon className="w-4 h-4 text-primary mb-1.5" />
						<div className="text-[12px] font-semibold text-foreground">{c.title}</div>
						<div className="text-[11px] text-muted-foreground leading-snug mt-0.5">{c.desc}</div>
					</div>
				))}
			</div>

			{/* Permissions note */}
			<div className="glass px-4 py-3 mb-4 flex items-start gap-2.5">
				<Shield className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
				<p className="text-[11px] text-muted-foreground leading-relaxed">
					You'll grant access to{" "}
					<strong>repositories, organizations, gists, workflows, profile,</strong> and{" "}
					<strong>projects</strong>. You can review and revoke this anytime in your{" "}
					<button
						type="button"
						onClick={() => openExternalUrl("https://github.com/settings/applications")}
						className="text-primary hover:underline"
					>
						GitHub settings
					</button>
					.
				</p>
			</div>

			{/* Manual setup (collapsible) */}
			<button
				type="button"
				onClick={() => setShowManual((v) => !v)}
				className="w-full glass px-4 py-3 flex items-center justify-between hover:bg-card/60 transition-colors"
			>
				<span className="text-[12px] font-medium text-foreground">
					Prefer to set it up yourself?
				</span>
				<ChevronDown
					className={`w-4 h-4 text-muted-foreground transition-transform ${showManual ? "rotate-180" : ""}`}
				/>
			</button>
			{showManual && (
				<div className="glass px-4 py-3.5 mt-2 space-y-2.5">
					<p className="text-[11px] text-muted-foreground leading-relaxed">
						Cowork bundles the GitHub CLI (<code className="text-foreground">gh</code>) and git. If
						you'd rather authenticate from a terminal, run:
					</p>
					<code className="block px-3 py-2 bg-background border border-border rounded-lg text-[11px] font-mono select-all">
						gh auth login --web --scopes "{DEFAULT_SCOPES}"
					</code>
					<p className="text-[11px] text-muted-foreground leading-relaxed">
						This opens the same device flow, saves your token, and configures git's credential
						helper. Come back here and it'll show as connected. Learn more in the{" "}
						<button
							type="button"
							onClick={() => openExternalUrl("https://cli.github.com/manual/gh_auth_login")}
							className="text-primary hover:underline"
						>
							gh auth docs
						</button>
						.
					</p>
				</div>
			)}
		</section>
	);
}

function GithubSkeleton() {
	return (
		<div className="animate-pulse">
			{/* status bar */}
			<div className="glass px-4 py-3 mb-4 flex items-center justify-between">
				<div className="h-3.5 w-32 rounded bg-muted" />
				<div className="h-3 w-16 rounded bg-muted/70" />
			</div>
			{/* account label */}
			<div className="h-2.5 w-20 rounded bg-muted/70 mb-2" />
			<div className="glass px-3.5 py-3 flex items-center gap-3 mb-5">
				<div className="w-9 h-9 rounded-full bg-muted shrink-0" />
				<div className="flex-1 space-y-1.5">
					<div className="h-3 w-28 rounded bg-muted" />
					<div className="h-2.5 w-20 rounded bg-muted/70" />
				</div>
				<div className="h-6 w-10 rounded bg-muted/70" />
			</div>
			{/* orgs label */}
			<div className="h-2.5 w-24 rounded bg-muted/70 mb-2" />
			<div className="space-y-2">
				{[0, 1, 2].map((i) => (
					<div key={i} className="glass px-3.5 py-3 flex items-center gap-3">
						<div className="w-9 h-9 rounded-full bg-muted shrink-0" />
						<div className="h-3 w-24 rounded bg-muted" />
					</div>
				))}
			</div>
		</div>
	);
}

function Avatar({ src, fallback }: { src?: string; fallback: React.ReactNode }) {
	return (
		<div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
			{src ? <img src={src} alt="" className="w-full h-full object-cover" /> : fallback}
		</div>
	);
}

function GithubGlyph() {
	return (
		<svg width="22" height="22" viewBox="0 0 16 16" fill="white" role="img" aria-label="GitHub">
			<title>GitHub</title>
			<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
		</svg>
	);
}
