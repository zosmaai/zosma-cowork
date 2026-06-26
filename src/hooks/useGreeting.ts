import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

/** Generic tail when there's no session history to reference. */
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

/** Capitalise the first letter of a lower-case name. */
function cap(s: string): string {
	return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

interface SessionLite {
	title?: string;
	lastActivity?: number;
	pinned?: boolean;
}

/**
 * Deterministic empty-state greeting. Priority:
 *  1. User name + pinned session  → "Good evening, Arjun. Ready for "Sales Report"?"
 *  2. User name + last session    → "Good evening, Arjun. Pick up where you left off on "X"?"
 *  3. User name only              → "Good evening, Arjun. What are you working on?"
 *  4. No name + pinned session    → "Good evening. Ready for "X"?"
 *  5. No name + last session      → "Good evening. Pick up where you left off on "X"?"
 *  6. Nothing                     → "Good evening. What are you working on?"
 */
export function buildGreeting(
	now: Date,
	userName?: string,
	pinnedTitle?: string,
	lastTitle?: string,
): string {
	const hello = timeOfDay(now.getHours());
	const name = userName?.trim();
	const greeting = name ? `${hello}, ${cap(name)}` : hello;

	const pin = pinnedTitle?.trim();
	if (pin) return `${greeting}. Ready for "${truncate(pin)}"?`;

	const recent = lastTitle?.trim();
	if (recent) return `${greeting}. Pick up where you left off on "${truncate(recent)}"?`;

	return `${greeting}. ${GREETING_FALLBACK}`;
}

/**
 * Empty-state greeting. Renders time-of-day instantly, then upgrades with
 * the user's name and pinned/recent sessions once both resolve (parallel,
 * microseconds — never blocks load).
 */
export function useGreeting(): string {
	const [text, setText] = useState(() => buildGreeting(new Date()));

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const [list, name] = await Promise.all([
					invoke<{ sessions?: SessionLite[] }>("list_sessions"),
					invoke<string>("get_username"),
				]);
				if (cancelled) return;

				const sessions = (list.sessions ?? []).filter((s) => s.title?.trim());
				// Pinned sessions, most-recently-active first (list is pinned-first).
				const pinned = sessions
					.filter((s) => s.pinned)
					.sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0));
				// Most recent overall among unpinned.
				const latest = sessions
					.filter((s) => !s.pinned)
					.sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0))[0];

				setText(
					buildGreeting(
						new Date(),
						name || undefined,
						pinned[0]?.title,
						latest?.title,
					),
				);
			} catch {
				// keep the time-only greeting
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	return text;
}
