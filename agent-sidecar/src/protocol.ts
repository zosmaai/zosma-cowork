/**
 * Zosma Cowork — Sidecar Protocol Helpers
 *
 * send/log for the JSON-line stdin/stdout protocol. Broadcasts to EventBus
 * subscribers before writing to stdout so remote clients (WebSocket) receive
 * events even when stdout is piped to the Tauri backend.
 */

import { eventBus } from "./event-bus.js";

// ── Logging ────────────────────────────────────────────────────────────────
// All sidecar logs go to stderr (stdout is the JSON protocol channel). Lines
// are prefixed `[sidecar:LEVEL]` so the Rust relay can map them to the matching
// log severity. Level is env-driven (SIDECAR_LOG_LEVEL); default `info`. To
// quiet production, the Rust relay spawns release builds with
// SIDECAR_LOG_LEVEL=warn (errors + warnings only).

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const;
export type LogLevel = keyof typeof LEVELS;

/** Resolve the active numeric threshold from env (default: info). */
export function activeLevel(raw = process.env.SIDECAR_LOG_LEVEL): number {
	const l = LEVELS[raw as LogLevel];
	return l ?? LEVELS.info;
}

/** Log at a level; suppressed when the level is above the active threshold. */
export function logAt(level: LogLevel, ...args: unknown[]) {
	if (LEVELS[level] > activeLevel()) return;
	process.stderr.write(`[sidecar:${level}] ${args.join(" ")}\n`);
}

/** Info-level log (back-compat: existing `log()` callers stay info). */
export function log(...args: unknown[]) {
	logAt("info", ...args);
}
/** Warning-level log. */
export function logWarn(...args: unknown[]) {
	logAt("warn", ...args);
}
/** Error-level log — always emitted unless SIDECAR_LOG_LEVEL is unset+invalid. */
export function logError(...args: unknown[]) {
	logAt("error", ...args);
}
/** Debug-level log — suppressed unless SIDECAR_LOG_LEVEL=debug. */
export function logDebug(...args: unknown[]) {
	logAt("debug", ...args);
}

/**
 * Send a JSON event/result/done/error to stdout (and broadcast to EventBus).
 * Handles EPIPE gracefully — when the Rust side kills the pipe, the process
 * exits cleanly instead of throwing.
 */
export function send(obj: unknown) {
	const busEvent = obj as {
		type: string;
		id?: string;
		data?: unknown;
		message?: string;
		event?: unknown;
	};
	if (busEvent.type === "event") {
		eventBus.publish({ type: "event", data: busEvent });
	} else if (busEvent.type === "result") {
		eventBus.publish({
			type: "result",
			id: busEvent.id || "",
			data: busEvent.data,
		});
	} else if (busEvent.type === "done") {
		eventBus.publish({ type: "done", id: busEvent.id || "" });
	} else if (busEvent.type === "error") {
		eventBus.publish({
			type: "error",
			id: busEvent.id || "",
			message: busEvent.message || "",
		});
	} else if (busEvent.type === "ready") {
		eventBus.publish({ type: "ready" });
	}

	try {
		process.stdout.write(`${JSON.stringify(obj)}\n`);
	} catch (err) {
		if ((err as NodeJS.ErrnoException)?.code === "EPIPE") {
			process.exit(0);
		}
		throw err;
	}
}

// Handle EPIPE on stdout globally (when pipe breaks before our next write)
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
	if (err.code === "EPIPE") {
		process.exit(0);
	}
});
