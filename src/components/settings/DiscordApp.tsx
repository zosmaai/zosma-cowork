/**
 * DiscordApp — full-page setup experience for connecting Discord through the
 * pi-messenger-bridge extension.
 *
 * Two tabs:
 *   1. Setup guide — rich, step-by-step instructions (create a server, create
 *      the bot, enable Message Content Intent, invite it, grab your user ID).
 *   2. Configuration — bot token + user ID + bridge options (reuses the
 *      bespoke MessengerBridgeSetup form).
 *
 * A Disconnect action clears the saved bot token from ~/.pi/msg-bridge.json
 * (mirrors the Google Workspace card's Disconnect), without uninstalling the
 * extension. pi remains the source of truth for whether the bridge is installed.
 */

import { MessengerBridgeSetup } from "@/components/extension-setup/MessengerBridgeSetup";
import { useExtensions } from "@/hooks/useExtensions";
import { openExternalUrl } from "@/lib/utils";
import type { ZemExtension } from "@/types";
import { invoke } from "@tauri-apps/api/core";
import { Check, ChevronLeft, ExternalLink, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

export const BRIDGE_PKG = "pi-messenger-bridge";
export const CONFIG_KEY = "pi-messenger-bridge";

export function isBridge(e: ZemExtension): boolean {
	return (
		e.id === `npm:${BRIDGE_PKG}` ||
		e.id === BRIDGE_PKG ||
		e.source?.value === BRIDGE_PKG ||
		e.id.includes("messenger-bridge")
	);
}

type Tab = "guide" | "config";

export function DiscordApp({ onBack }: { onBack: () => void }) {
	const { extensions, install, installing, refresh } = useExtensions();
	const [tab, setTab] = useState<Tab>("guide");
	const [configured, setConfigured] = useState(false);
	const [reloadKey, setReloadKey] = useState(0);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const bridge = extensions.find(isBridge);
	const installed = !!bridge;
	const isInstalling = installing === BRIDGE_PKG || installing === `npm:${BRIDGE_PKG}`;

	const refreshConfig = useCallback(async () => {
		try {
			const res = await invoke<{ config?: { discord?: { token?: string } } }>(
				"get_extension_config_file",
				{ extensionId: CONFIG_KEY },
			);
			setConfigured(!!res?.config?.discord?.token);
		} catch {
			setConfigured(false);
		}
	}, []);

	useEffect(() => {
		if (installed) refreshConfig();
		else setConfigured(false);
	}, [installed, refreshConfig]);

	const handleInstall = useCallback(async () => {
		setError(null);
		try {
			await install(BRIDGE_PKG);
			await refresh();
			setTab("config");
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	}, [install, refresh]);

	// Auto-install the bridge the moment configuration is needed (#281): an app
	// is its extension + config, so opening Configuration installs what's missing
	// automatically instead of asking the user to click Install first.
	useEffect(() => {
		if (tab === "config" && !installed && !isInstalling) {
			handleInstall();
		}
	}, [tab, installed, isInstalling, handleInstall]);

	const handleDisconnect = useCallback(async () => {
		if (!confirm("Disconnect Discord? This clears the saved bot token.")) return;
		setBusy(true);
		setError(null);
		try {
			// Clear the token (deep-merged) — keeps other settings, marks not configured.
			await invoke("save_extension_config_file", {
				extensionId: CONFIG_KEY,
				patch: { discord: { token: "" } },
			});
			await refreshConfig();
			setReloadKey((k) => k + 1); // remount the form so its fields reset
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}, [refreshConfig]);

	const statusText = !installed
		? "Not installed"
		: configured
			? "Bot token saved"
			: "Needs a bot token";

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

			{/* Header */}
			<div className="flex items-start gap-3">
				<span
					className="w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-bold shrink-0"
					style={{ background: "#5865F2", color: "white" }}
					aria-hidden
				>
					D
				</span>
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2">
						<h2 className="text-base font-semibold text-foreground">Discord</h2>
						{configured && (
							<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 text-primary">
								<Check className="w-2.5 h-2.5" />
								Connected
							</span>
						)}
					</div>
					<p className="text-xs text-muted-foreground mt-0.5">
						Chat with your pi agent from Discord via the{" "}
						<span className="font-medium text-foreground/80">pi-messenger-bridge</span>.{" "}
						{statusText}.
					</p>
				</div>
				{installed && configured && (
					<button
						type="button"
						onClick={handleDisconnect}
						disabled={busy}
						className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border border-border text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50 shrink-0"
						title="Clear the saved bot token"
					>
						{busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
						Disconnect
					</button>
				)}
			</div>

			{/* Tabs */}
			<div className="flex items-center gap-1 border-b border-border mt-4">
				<TabButton active={tab === "guide"} onClick={() => setTab("guide")}>
					Setup guide
				</TabButton>
				<TabButton active={tab === "config"} onClick={() => setTab("config")}>
					Configuration
				</TabButton>
			</div>

			{error && <p className="mt-3 text-xs text-destructive">{error}</p>}

			<div className="mt-4">
				{tab === "guide" ? (
					<DiscordGuide onGoToConfig={() => setTab("config")} />
				) : !installed ? (
					<div className="glass p-5 text-center space-y-3">
						<p className="inline-flex items-center gap-2 text-xs text-muted-foreground">
							<Loader2 className="w-3.5 h-3.5 animate-spin" />
							Installing <span className="font-medium text-foreground/80">pi-messenger-bridge</span>
							…
						</p>
						<p className="text-[11px] text-muted-foreground">
							Setting up the Discord bridge so you can configure it.
						</p>
					</div>
				) : (
					bridge && (
						<MessengerBridgeSetup
							key={reloadKey}
							ext={bridge}
							configKey={CONFIG_KEY}
							onSaved={refreshConfig}
						/>
					)
				)}
			</div>
		</section>
	);
}

// ─── Tabs ────────────────────────────────────────────────────────────

function TabButton({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
				active
					? "border-primary text-foreground"
					: "border-transparent text-muted-foreground hover:text-foreground"
			}`}
		>
			{children}
		</button>
	);
}

// ─── Setup guide (rich text) ─────────────────────────────────────────

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
	return (
		<button
			type="button"
			onClick={() => openExternalUrl(href).catch(() => {})}
			className="inline-flex items-center gap-1 text-primary hover:underline bg-transparent border-none p-0 align-baseline"
		>
			{children}
			<ExternalLink className="w-2.5 h-2.5" />
		</button>
	);
}

/** Inline menu-path / keyword chip. */
function Kbd({ children }: { children: React.ReactNode }) {
	return (
		<span className="px-1.5 py-0.5 rounded-md bg-muted text-foreground/80 text-[11px] font-medium">
			{children}
		</span>
	);
}

function Step({
	n,
	title,
	children,
}: {
	n: number;
	title: string;
	children: React.ReactNode;
}) {
	return (
		<li className="flex gap-3">
			<span className="mt-0.5 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 bg-primary/10 text-primary">
				{n}
			</span>
			<div className="min-w-0 flex-1 pb-1">
				<p className="text-[13px] font-semibold text-foreground">{title}</p>
				<div className="text-xs text-muted-foreground leading-relaxed mt-1 space-y-1.5">
					{children}
				</div>
			</div>
		</li>
	);
}

function DiscordGuide({ onGoToConfig }: { onGoToConfig: () => void }) {
	return (
		<div className="space-y-5">
			<p className="text-xs text-muted-foreground leading-relaxed">
				Follow these steps once to create a Discord bot and connect it to pi. It takes about five
				minutes. When you're done, head to the{" "}
				<button
					type="button"
					onClick={onGoToConfig}
					className="text-primary hover:underline bg-transparent border-none p-0"
				>
					Configuration
				</button>{" "}
				tab to paste your token.
			</p>

			<ol className="space-y-4">
				<Step n={1} title="Create a Discord server (skip if you already have one)">
					<p>
						In the Discord app, click the <Kbd>+</Kbd> on the left rail → <Kbd>Create My Own</Kbd> →{" "}
						<Kbd>For me and my friends</Kbd>. This is where you'll talk to your bot.
					</p>
				</Step>

				<Step n={2} title="Create a bot application">
					<p>
						Open the{" "}
						<ExtLink href="https://discord.com/developers/applications">
							Discord Developer Portal
						</ExtLink>{" "}
						→ <Kbd>New Application</Kbd>, give it a name (e.g. “pi agent”), accept the terms, and
						click <Kbd>Create</Kbd>.
					</p>
				</Step>

				<Step n={3} title="Add the bot & copy its token">
					<p>
						In your application, open the <Kbd>Bot</Kbd> tab. Click <Kbd>Reset Token</Kbd> →{" "}
						<Kbd>Yes, do it!</Kbd> → <Kbd>Copy</Kbd>. This is your{" "}
						<span className="text-foreground/80 font-medium">bot token</span> — keep it secret, it's
						like a password. You'll paste it in the Configuration tab.
					</p>
				</Step>

				<Step n={4} title="Enable Message Content Intent">
					<p>
						Still on the <Kbd>Bot</Kbd> tab, scroll to{" "}
						<span className="text-foreground/80 font-medium">Privileged Gateway Intents</span> and
						turn on <Kbd>Message Content Intent</Kbd>, then save. Without this the bot can't read
						your messages.
					</p>
				</Step>

				<Step n={5} title="Invite the bot to your server">
					<p>
						Open <Kbd>OAuth2</Kbd> → <Kbd>URL Generator</Kbd>. Under{" "}
						<span className="text-foreground/80 font-medium">Scopes</span> tick:
					</p>
					<div className="flex flex-wrap gap-1.5">
						<PermChip>bot</PermChip>
					</div>
					<p>
						Then under <span className="text-foreground/80 font-medium">Bot Permissions</span> tick:
					</p>
					<div className="flex flex-wrap gap-1.5">
						<PermChip>Send Messages</PermChip>
						<PermChip>Read Message History</PermChip>
					</div>
					<p>
						Copy the generated URL at the bottom, open it in your browser, pick your server, and
						click <Kbd>Authorize</Kbd>.
					</p>
				</Step>

				<Step n={6} title="Get your Discord user ID (optional but recommended)">
					<p>
						In Discord: <Kbd>User Settings</Kbd> → <Kbd>Advanced</Kbd> → turn on{" "}
						<Kbd>Developer Mode</Kbd>. Then right-click your own name and choose{" "}
						<Kbd>Copy User ID</Kbd>. Pasting it in the next tab pre-trusts you as admin so you skip
						the 6-digit challenge.
					</p>
				</Step>

				<Step n={7} title="Connect & say hi">
					<p>
						Go to the{" "}
						<button
							type="button"
							onClick={onGoToConfig}
							className="text-primary hover:underline bg-transparent border-none p-0"
						>
							Configuration
						</button>{" "}
						tab, paste the bot token and your user ID, and click <Kbd>Save</Kbd>. The bridge
						connects on your next pi session — then DM the bot or message it in your server to start
						chatting with your agent.
					</p>
				</Step>
			</ol>

			<div className="glass px-4 py-3 text-[11px] text-muted-foreground leading-relaxed">
				<span className="text-foreground/80 font-medium">How it works:</span> messages from trusted
				Discord users are fed into your running pi session, and the agent's replies are sent back to
				Discord. New users get a one-time 6-digit code (shown in pi) to become trusted.
			</div>
		</div>
	);
}

function PermChip({ children }: { children: React.ReactNode }) {
	return (
		<span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-primary/10 text-primary border border-primary/15">
			{children}
		</span>
	);
}
