import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

/** Static line shown immediately and whenever AI generation is unavailable. */
export const GREETING_FALLBACK = "What are you working on?";

const TTL_MS = 30 * 60 * 1000; // 30-min cache
const TIMEOUT_MS = 4000; // a slow sidecar must never wedge the line on "loading"
const CACHE_KEY = "cowork:greeting";
const MAX_SESSIONS = 5; // token budget for the prompt

interface Cached {
	text: string;
	ts: number;
}

// ponytail: sessionStorage IS the cache — a parallel in-memory var adds
// test/reset friction for ~0 gain. Add an in-mem layer if getItem ever profiles hot.
function readCache(): string | null {
	try {
		const raw = sessionStorage.getItem(CACHE_KEY);
		if (!raw) return null;
		const c = JSON.parse(raw) as Cached;
		if (c.text && Date.now() - c.ts < TTL_MS) return c.text;
	} catch {
		// corrupt/unavailable storage → treat as cache miss
	}
	return null;
}

function writeCache(text: string): void {
	try {
		sessionStorage.setItem(CACHE_KEY, JSON.stringify({ text, ts: Date.now() } satisfies Cached));
	} catch {
		// non-fatal: greeting still renders this session
	}
}

/**
 * AI-generated empty-state greeting. Renders the static fallback immediately,
 * swaps in the AI line in place once it resolves. Never blocks the input.
 */
export function useGreeting(): string {
	const [text, setText] = useState<string>(() => readCache() ?? GREETING_FALLBACK);

	useEffect(() => {
		const cached = readCache();
		if (cached) {
			setText(cached);
			return;
		}

		let cancelled = false;
		const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS));

		(async () => {
			try {
				const list = await invoke<{ sessions?: Array<{ title?: string }> }>("list_sessions");
				const recent = (list.sessions ?? [])
					.slice(0, MAX_SESSIONS)
					.map((s) => s.title)
					.filter((t): t is string => Boolean(t?.trim()));
				if (recent.length === 0) return; // no history → keep fallback

				const result = await Promise.race([
					invoke<{ text: string }>("generate_greeting", { recent }),
					timeout,
				]);
				const line = result?.text?.trim();
				if (!cancelled && line) {
					writeCache(line);
					setText(line);
				}
			} catch {
				// generation failed → keep the fallback, nothing user-facing
			}
		})();

		return () => {
			cancelled = true;
		};
	}, []);

	return text;
}
