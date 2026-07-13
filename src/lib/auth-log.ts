/**
 * Durable diagnostic log for the auth flow.
 *
 * Appends timestamped lines to `~/.zosmaai/cowork/auth.log`.  Uses an
 * in-memory promise queue to serialize concurrent writes.
 *
 * Enabled only when `import.meta.env.DEV` is true (Vite dev server) or when
 * `VITE_AUTH_LOG=true` is set in `.env`.  In production release builds the
 * whole write path is dead-code eliminated by Vite — no fs plugin call, no
 * console noise — unless you explicitly opt in via env var.
 */
import {
	BaseDirectory,
	exists,
	mkdir,
	writeTextFile,
} from "@tauri-apps/plugin-fs";

const ENABLED =
	import.meta.env.DEV || import.meta.env.VITE_AUTH_LOG === "true";

const LOG_PATH = ".zosmaai/cowork/auth.log";

const stamp = () => new Date().toISOString();

let ensured = false;
const ensureDir = async () => {
	if (ensured) return;
	try {
		const dirExists = await exists(".zosmaai/cowork", { baseDir: BaseDirectory.Home });
		if (!dirExists) {
			await mkdir(".zosmaai/cowork", { baseDir: BaseDirectory.Home, recursive: true });
		}
		ensured = true;
	} catch {
		// ignore
	}
};

let queue: Promise<void> = Promise.resolve();

const safeJson = (v: unknown): string => {
	try {
		return JSON.stringify(v);
	} catch {
		return String(v);
	}
};

const doWrite = async (line: string): Promise<void> => {
	await ensureDir();
	await writeTextFile(LOG_PATH, line, {
		baseDir: BaseDirectory.Home,
		append: true,
		create: true,
	});
};

export const authLog = (msg: string, extra?: unknown): void => {
	if (!ENABLED) return;
	const suffix = extra !== undefined ? ` :: ${safeJson(extra)}` : "";
	const line = `[${stamp()}] ${msg}${suffix}\n`;
	console.log(`[ZosmaAuth] ${msg}`, extra ?? "");
	queue = queue.then(() => doWrite(line)).catch(() => {
		// logging must never break the traced flow
	});
};
