/**
 * GoogleLauncher — the Apps-tab launcher card for Google Workspace.
 *
 * Mirrors the Discord launcher's shape (branded badge + name + status +
 * chevron) so every app in the Apps list looks and behaves consistently:
 * click to open the full-page app. Status reflects pi's source of truth via
 * `google_status` (is an account connected?).
 */

import { invoke } from "@tauri-apps/api/core";
import { Check, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

export function GoogleLauncher({ onOpen }: { onOpen: () => void }) {
	const [connected, setConnected] = useState(false);
	const [email, setEmail] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		try {
			const res = await invoke<{ connected?: boolean; email?: string | null }>("google_status");
			setConnected(!!res?.connected);
			setEmail(res?.email ?? null);
		} catch {
			setConnected(false);
			setEmail(null);
		}
	}, []);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const statusText = connected ? (email ?? "Connected") : "Not set up";

	return (
		<button
			type="button"
			onClick={onOpen}
			className="glass w-full text-left px-3.5 py-3 flex items-center gap-3 hover:bg-card/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
		>
			<span
				className="w-8 h-8 rounded-lg flex items-center justify-center text-[13px] font-bold shrink-0 bg-white border border-border"
				aria-hidden
			>
				<GoogleG className="w-4 h-4" />
			</span>
			<span className="flex-1 min-w-0">
				<span className="flex items-center gap-2">
					<span className="text-[13px] font-semibold text-foreground">Google Workspace</span>
					{connected && (
						<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 text-primary">
							<Check className="w-2.5 h-2.5" />
							Connected
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

/** Google "G" mark. */
function GoogleG({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			viewBox="0 0 48 48"
			role="img"
			aria-label="Google"
			xmlns="http://www.w3.org/2000/svg"
		>
			<title>Google</title>
			<path
				fill="#4285F4"
				d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
			/>
			<path
				fill="#34A853"
				d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
			/>
			<path
				fill="#FBBC05"
				d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
			/>
			<path
				fill="#EA4335"
				d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
			/>
		</svg>
	);
}
