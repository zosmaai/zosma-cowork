/**
 * Zosma Cowork — Extension UI Bridge
 *
 * Bridges pi extension ctx.ui.* dialog calls to the desktop React UI.
 * Extensions call abstract ctx.ui methods; this module emits JSON events
 * (ui_request) that the Rust layer forwards to the frontend, and resolves
 * when the frontend posts back a `ui_response` command on stdin.
 *
 * Mirrors pi's RPC Extension-UI protocol but routes to React dialogs.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, chmodSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	Theme,
} from "@earendil-works/pi-coding-agent";
import { send } from "./protocol.js";

// ── Pending UI response tracking ──────────────────────────────────────────

export interface PendingUiResponse {
	value?: string;
	confirmed?: boolean;
	cancelled?: boolean;
}

const pendingUiRequests = new Map<string, (response: PendingUiResponse) => void>();

/** Resolve a pending ctx.ui dialog from a `ui_response` stdin command. */
export function resolveUiResponse(response: PendingUiResponse & { id: string }): void {
	const resolve = pendingUiRequests.get(response.id);
	if (resolve) {
		pendingUiRequests.delete(response.id);
		resolve(response);
	}
}

/** Emit a UI request wrapped in the standard event envelope. */
function emitUiRequest(payload: Record<string, unknown>): void {
	send({ type: "event", event: { kind: "ui_request", ...payload } });
}

/** Tell the frontend to dismiss a dialog the sidecar resolved on its own. */
function emitUiCancel(id: string): void {
	send({ type: "event", event: { kind: "ui_cancel", id } });
}

// ── Minimal Theme stub ────────────────────────────────────────────────────

const MINIMAL_THEME = {
	fg: (_color: unknown, text: string) => text,
	bg: (_color: unknown, text: string) => text,
	bold: (text: string) => text,
	italic: (text: string) => text,
	underline: (text: string) => text,
	inverse: (text: string) => text,
	strikethrough: (text: string) => text,
	getFgAnsi: () => "",
	getBgAnsi: () => "",
	getColorMode: () => "none",
	getThinkingBorderColor: () => (s: string) => s,
	getBashModeBorderColor: () => (s: string) => s,
} as unknown as Theme;

// ── Dialog helper ─────────────────────────────────────────────────────────

function createUiDialog<T>(
	opts: ExtensionUIDialogOptions | undefined,
	defaultValue: T,
	request: Record<string, unknown>,
	parse: (response: PendingUiResponse) => T,
): Promise<T> {
	if (opts?.signal?.aborted) return Promise.resolve(defaultValue);
	const id = randomUUID();
	return new Promise<T>((resolve) => {
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		const cleanup = () => {
			if (timeoutId) clearTimeout(timeoutId);
			opts?.signal?.removeEventListener("abort", onAbort);
			pendingUiRequests.delete(id);
		};
		const onAbort = () => {
			cleanup();
			emitUiCancel(id);
			resolve(defaultValue);
		};
		opts?.signal?.addEventListener("abort", onAbort, { once: true });
		if (opts?.timeout) {
			timeoutId = setTimeout(() => {
				cleanup();
				emitUiCancel(id);
				resolve(defaultValue);
			}, opts.timeout);
		}
		pendingUiRequests.set(id, (response) => {
			cleanup();
			resolve(parse(response));
		});
		emitUiRequest({ id, ...request });
	});
}

// ── ExtensionUIContext factory ────────────────────────────────────────────

function createUiContext(): ExtensionUIContext {
	return {
		select: (title, options, opts) =>
			createUiDialog<string | undefined>(
				opts,
				undefined,
				{ method: "select", title, options, timeout: opts?.timeout },
				(r) => (r.cancelled ? undefined : r.value),
			),
		confirm: (title, message, opts) =>
			createUiDialog<boolean>(
				opts,
				false,
				{ method: "confirm", title, message, timeout: opts?.timeout },
				(r) => (r.cancelled ? false : Boolean(r.confirmed)),
			),
		input: (title, placeholder, opts) =>
			createUiDialog<string | undefined>(
				opts,
				undefined,
				{ method: "input", title, placeholder, timeout: opts?.timeout },
				(r) => (r.cancelled ? undefined : r.value),
			),
		editor: (title, prefill) =>
			createUiDialog<string | undefined>(
				undefined,
				undefined,
				{ method: "editor", title, prefill },
				(r) => (r.cancelled ? undefined : r.value),
			),
		notify: (message, type) =>
			emitUiRequest({ id: randomUUID(), method: "notify", message, notifyType: type }),
		setStatus: (key, text) =>
			emitUiRequest({ id: randomUUID(), method: "setStatus", statusKey: key, statusText: text }),
		setWidget: (key, content, options) => {
			if (content === undefined || Array.isArray(content)) {
				emitUiRequest({
					id: randomUUID(),
					method: "setWidget",
					widgetKey: key,
					widgetLines: content,
					widgetPlacement: options?.placement,
				});
			}
		},
		setTitle: (title) => emitUiRequest({ id: randomUUID(), method: "setTitle", title }),
		setEditorText: (text) => emitUiRequest({ id: randomUUID(), method: "set_editor_text", text }),
		pasteToEditor(text) {
			this.setEditorText(text);
		},
		getEditorText: () => "",
		onTerminalInput: () => () => {},
		setWorkingMessage: () => {},
		setWorkingVisible: () => {},
		setWorkingIndicator: () => {},
		setHiddenThinkingLabel: () => {},
		setFooter: () => {},
		setHeader: () => {},
		custom: async () => undefined as never,
		addAutocompleteProvider: () => {},
		setEditorComponent: () => {},
		getEditorComponent: () => undefined,
		get theme() {
			return MINIMAL_THEME;
		},
		getAllThemes: () => [],
		getTheme: () => undefined,
		setTheme: () => ({ success: false, error: "Theme switching not supported in Cowork" }),
		getToolsExpanded: () => false,
		setToolsExpanded: () => {},
	};
}

/**
 * Bind the UI bridge to a freshly created session. Providing a uiContext
 * flips the extension runtime's `hasUI()` to true, so ctx.hasUI-gated tools
 * (e.g. pi-ask-user) run instead of bailing out. Also emits extensions'
 * `session_start` event, which previously never fired under Cowork.
 */
export async function bindExtensionUi(
	session: {
		bindExtensions: (opts: { uiContext: ExtensionUIContext }) => Promise<void>;
	},
): Promise<void> {
	await session.bindExtensions({ uiContext: createUiContext() });
}

// ── Whitelisted extension config file helpers ────────────────────────────

const WHITELISTED_CONFIG_FILES: Record<string, () => string> = {
	"pi-messenger-bridge": () => join(homedir(), ".pi", "msg-bridge.json"),
};

export function resolveWhitelistedConfigPath(extensionId: string): string | undefined {
	for (const [key, pathFn] of Object.entries(WHITELISTED_CONFIG_FILES)) {
		if (extensionId === key || extensionId.includes(key)) return pathFn();
	}
	return undefined;
}

export function readJsonFile(path: string): Record<string, unknown> {
	try {
		if (!existsSync(path)) return {};
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

export function deepMerge(
	base: Record<string, unknown>,
	patch: Record<string, unknown>,
): Record<string, unknown> {
	const out: Record<string, unknown> = { ...base };
	for (const [k, v] of Object.entries(patch)) {
		const cur = out[k];
		if (
			v &&
			typeof v === "object" &&
			!Array.isArray(v) &&
			cur &&
			typeof cur === "object" &&
			!Array.isArray(cur)
		) {
			out[k] = deepMerge(cur as Record<string, unknown>, v as Record<string, unknown>);
		} else {
			out[k] = v;
		}
	}
	return out;
}

export function writeWhitelistedConfig(
	path: string,
	patch: Record<string, unknown>,
): Record<string, unknown> {
	const next = deepMerge(readJsonFile(path), patch);
	const dir = dirname(path);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
	writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
	try {
		chmodSync(path, 0o600);
	} catch {
		// best-effort on platforms without POSIX perms (Windows)
	}
	return next;
}
