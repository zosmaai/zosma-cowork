/**
 * DiscordIntegration — the Apps-tab launcher card for Discord.
 *
 * Mirrors the Google Workspace card's shape, but clicking it opens the
 * full-page DiscordApp (setup guide + configuration). Status reflects pi's
 * source of truth: is pi-messenger-bridge installed, and is a bot token saved?
 */

import { useExtensions } from "@/hooks/useExtensions";
import { invoke } from "@tauri-apps/api/core";
import { Check, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { CONFIG_KEY, isBridge } from "./DiscordApp";

export function DiscordIntegration({ onOpen }: { onOpen: () => void }) {
	const { extensions } = useExtensions();
	const [configured, setConfigured] = useState(false);

	const installed = extensions.some(isBridge);

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

	const statusText = !installed
		? "Not set up"
		: configured
			? "Bot token saved"
			: "Needs a bot token";

	return (
		<button
			type="button"
			onClick={onOpen}
			className="glass w-full text-left px-3.5 py-3 flex items-center gap-3 hover:bg-card/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
		>
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
			<ChevronRight className="w-4 h-4 text-muted-foreground/60 shrink-0" />
		</button>
	);
}
