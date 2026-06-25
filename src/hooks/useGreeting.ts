import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

/** Generic tail used when there is no recent session to reference. */
export const GREETING_FALLBACK = "What are you working on?";

/** Time-of-day salutation. <5am and >=10pm read as "working late". */
function timeOfDay(hour: number): string {
	if (hour < 5) return "Working late";
	if (hour < 12) return "Good morning";
	if (hour < 18) return "Good afternoon";
	if (hour < 22) return "Good evening";
	return "Working late";
}

function truncate(s: string, max = 48): string {
	const t = s.trim();
	return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Deterministic empty-state greeting: clock + most-recent session title.
 * No model/network needed, so it always renders something useful. The AI
 * layer (per-session model completion) is a later enhancement — it can't run
 * here because no session/model exists yet on the empty state.
 */
export function buildGreeting(now: Date, lastTitle?: string): string {
	const hello = timeOfDay(now.getHours());
	const title = lastTitle?.trim();
	return title
		? `${hello}. Pick up where you left off on "${truncate(title)}"?`
		: `${hello}. ${GREETING_FALLBACK}`;
}

interface SessionLite {
	title?: string;
	lastActivity?: number;
}

/**
 * Empty-state greeting. Renders a time-of-day line instantly, then upgrades to
 * reference the most recently active session once list_sessions resolves.
 */
export function useGreeting(): string {
	const [text, setText] = useState(() => buildGreeting(new Date()));

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const list = await invoke<{ sessions?: SessionLite[] }>("list_sessions");
				const sessions = (list.sessions ?? []).filter((s) => s.title?.trim());
				if (cancelled || sessions.length === 0) return;
				// Most recent by activity — list may be pinned-first, so don't trust [0].
				const latest = sessions.reduce((a, b) =>
					(b.lastActivity ?? 0) > (a.lastActivity ?? 0) ? b : a,
				);
				setText(buildGreeting(new Date(), latest.title));
			} catch {
				// no history / sidecar down → keep the time-only greeting
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	return text;
}
