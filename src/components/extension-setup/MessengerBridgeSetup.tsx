/**
 * MessengerBridgeSetup — bespoke Discord configuration for pi-messenger-bridge.
 *
 * Writes to the extension's own config file (~/.pi/msg-bridge.json) via the
 * whitelisted get/save_extension_config_file commands, so the user never has to
 * hand-edit JSON. Focused on Discord (the common case); the bridge auto-connects
 * on session start once a token is saved.
 */

import type { ExtensionSetupProps } from "@/lib/extension-setup-registry";
import { openExternalUrl } from "@/lib/utils";
import { invoke } from "@tauri-apps/api/core";
import { Check, ExternalLink, Eye, EyeOff, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface MsgBridgeConfig {
	discord?: { token?: string };
	autoConnect?: boolean;
	auth?: { trustedUsers?: string[]; adminUserId?: string };
}

const DISCORD_PREFIX = "discord:";

export function MessengerBridgeSetup({
	configKey,
	onSaved,
}: ExtensionSetupProps & { onSaved?: () => void }) {
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [showToken, setShowToken] = useState(false);

	const [token, setToken] = useState("");
	const [userId, setUserId] = useState("");
	const [autoConnect, setAutoConnect] = useState(true);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const res = await invoke<{ config: MsgBridgeConfig }>("get_extension_config_file", {
					extensionId: configKey,
				});
				if (cancelled) return;
				const cfg = res?.config ?? {};
				setToken(cfg.discord?.token ?? "");
				const trusted = cfg.auth?.trustedUsers?.find((u) => u.startsWith(DISCORD_PREFIX));
				setUserId(trusted ? trusted.slice(DISCORD_PREFIX.length) : "");
				setAutoConnect(cfg.autoConnect !== false);
			} catch (e) {
				if (!cancelled) setError(e instanceof Error ? e.message : String(e));
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [configKey]);

	const save = useCallback(async () => {
		setSaving(true);
		setError(null);
		setSaved(false);
		try {
			const did = userId.trim() ? `${DISCORD_PREFIX}${userId.trim()}` : undefined;
			const patch: MsgBridgeConfig = {
				discord: { token: token.trim() },
				autoConnect,
			};
			if (did) patch.auth = { trustedUsers: [did], adminUserId: did };
			await invoke("save_extension_config_file", { extensionId: configKey, patch });
			setSaved(true);
			onSaved?.();
			setTimeout(() => setSaved(false), 2500);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setSaving(false);
		}
	}, [configKey, token, userId, autoConnect, onSaved]);

	if (loading) {
		return (
			<div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
				<Loader2 className="w-3.5 h-3.5 animate-spin" />
				Loading configuration…
			</div>
		);
	}

	return (
		<div className="space-y-3">
			{/* Bot token */}
			<div>
				<label
					htmlFor="msgbridge-token"
					className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1"
				>
					Discord bot token
				</label>
				<div className="relative">
					<input
						id="msgbridge-token"
						type={showToken ? "text" : "password"}
						value={token}
						onChange={(e) => setToken(e.target.value)}
						placeholder="Paste your bot token…"
						autoComplete="off"
						spellCheck={false}
						className="w-full pr-8 px-2.5 py-1.5 text-xs font-mono bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring transition-all placeholder:text-muted-foreground/50 placeholder:font-sans"
					/>
					<button
						type="button"
						onClick={() => setShowToken((v) => !v)}
						aria-label={showToken ? "Hide token" : "Show token"}
						className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-muted-foreground/60 hover:text-foreground transition-colors"
					>
						{showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
					</button>
				</div>
				<button
					type="button"
					onClick={() =>
						openExternalUrl("https://discord.com/developers/applications").catch(() => {})
					}
					className="mt-1 inline-flex items-center gap-1 text-[10px] text-primary hover:underline bg-transparent border-none p-0"
				>
					<ExternalLink className="w-2.5 h-2.5" />
					Create a bot & copy its token (enable Message Content Intent)
				</button>
			</div>

			{/* Pre-trusted user id */}
			<div>
				<label
					htmlFor="msgbridge-userid"
					className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1"
				>
					Your Discord user ID{" "}
					<span className="text-muted-foreground/50 normal-case">(optional)</span>
				</label>
				<input
					id="msgbridge-userid"
					type="text"
					value={userId}
					onChange={(e) => setUserId(e.target.value)}
					placeholder="e.g. 123456789012345678"
					autoComplete="off"
					spellCheck={false}
					className="w-full px-2.5 py-1.5 text-xs font-mono bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring transition-all placeholder:text-muted-foreground/50 placeholder:font-sans"
				/>
				<p className="mt-1 text-[10px] text-muted-foreground/70">
					Pre-trusts you as admin so you skip the 6-digit challenge. Enable Developer Mode in
					Discord, right-click your name → Copy User ID.
				</p>
			</div>

			{/* Auto-connect */}
			<div className="flex items-center justify-between gap-2">
				<span className="text-xs text-foreground">Auto-connect on startup</span>
				<button
					type="button"
					role="switch"
					aria-checked={autoConnect}
					onClick={() => setAutoConnect((v) => !v)}
					className={`relative w-8 h-4.5 rounded-full transition-colors ${autoConnect ? "bg-primary" : "bg-muted"}`}
				>
					<span
						className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-transform ${autoConnect ? "translate-x-[15px]" : "translate-x-0.5"}`}
					/>
				</button>
			</div>

			{error && <p className="text-[10px] text-destructive">{error}</p>}

			{/* Save */}
			<div className="flex items-center gap-2 pt-0.5">
				<button
					type="button"
					onClick={save}
					disabled={saving}
					className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:brightness-110 disabled:opacity-50 transition-all active:scale-[0.97]"
				>
					{saving ? (
						<Loader2 className="w-3 h-3 animate-spin" />
					) : saved ? (
						<Check className="w-3 h-3" />
					) : null}
					{saved ? "Saved" : "Save"}
				</button>
				<span className="text-[10px] text-muted-foreground/60">
					Reconnects on your next session.
				</span>
			</div>
		</div>
	);
}
