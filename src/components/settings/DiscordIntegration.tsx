/**
 * Discord Integration card — the Apps-tab app for the pi-messenger-bridge.
 *
 * Lets people connect Discord without touching the Extensions panel: it
 * installs the `pi-messenger-bridge` extension on demand, then reuses the same
 * bespoke setup form (bot token + trusted user + auto-connect) inline. Status
 * reflects pi's source of truth — installed? configured with a bot token?
 *
 * The bridge auto-connects on the next pi session once a token is saved.
 */

import { MessengerBridgeSetup } from "@/components/extension-setup/MessengerBridgeSetup";
import { useExtensions } from "@/hooks/useExtensions";
import type { ZemExtension } from "@/types";
import { invoke } from "@tauri-apps/api/core";
import { Check, ChevronDown, Download, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const BRIDGE_PKG = "pi-messenger-bridge";
const CONFIG_KEY = "pi-messenger-bridge";

function isBridge(e: ZemExtension): boolean {
	return (
		e.id === `npm:${BRIDGE_PKG}` ||
		e.id === BRIDGE_PKG ||
		e.source?.value === BRIDGE_PKG ||
		e.id.includes("messenger-bridge")
	);
}

export function DiscordIntegration() {
	const { extensions, install, installing, refresh } = useExtensions();
	const [expanded, setExpanded] = useState(false);
	const [configured, setConfigured] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const bridge = extensions.find(isBridge);
	const installed = !!bridge;
	const isInstalling = installing === BRIDGE_PKG || installing === `npm:${BRIDGE_PKG}`;

	// ── Is a bot token saved? (pi-native config file is the source of truth) ──
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
			setExpanded(true);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	}, [install, refresh]);

	// ── Status pill ──────────────────────────────────────────────────
	const statusText = !installed
		? "Not installed"
		: configured
			? "Bot token saved"
			: "Needs a bot token";

	return (
		<div className="glass overflow-hidden">
			{/* Header row */}
			<div className="px-3.5 py-3">
				<div className="flex items-center gap-3">
					<span
						className="w-8 h-8 rounded-lg flex items-center justify-center text-[13px] font-bold shrink-0"
						style={{ background: "#5865F2", color: "white" }}
						aria-hidden
					>
						D
					</span>
					<span className="flex-1 min-w-0">
						<span className="flex items-center gap-2">
							<span className="text-[13px] font-semibold text-foreground">Discord</span>
							{configured && (
								<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 text-primary">
									<Check className="w-2.5 h-2.5" />
									Connected
								</span>
							)}
						</span>
						<span className="block text-[11px] text-muted-foreground mt-0.5">{statusText}</span>
					</span>

					{!installed ? (
						<button
							type="button"
							onClick={handleInstall}
							disabled={isInstalling}
							className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border border-border text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
						>
							{isInstalling ? (
								<Loader2 className="w-3 h-3 animate-spin" />
							) : (
								<Download className="w-3 h-3" />
							)}
							{isInstalling ? "Installing…" : "Install"}
						</button>
					) : (
						<button
							type="button"
							onClick={() => setExpanded((v) => !v)}
							className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border border-border text-foreground hover:bg-muted/50 transition-colors"
						>
							{configured ? "Manage" : "Set up"}
							<ChevronDown
								className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`}
							/>
						</button>
					)}
				</div>
			</div>

			{error && (
				<div className="px-3.5 pb-3 border-t border-[hsl(var(--elev-border)/0.6)]">
					<p className="pt-2.5 text-xs text-destructive">{error}</p>
				</div>
			)}

			{/* Setup form — reuses the bespoke bridge config (instructions + token) */}
			{installed && bridge && expanded && (
				<div className="px-3.5 pb-3.5 pt-0.5 border-t border-[hsl(var(--elev-border)/0.6)]">
					<div className="pt-3">
						<MessengerBridgeSetup ext={bridge} configKey={CONFIG_KEY} onSaved={refreshConfig} />
					</div>
				</div>
			)}
		</div>
	);
}
