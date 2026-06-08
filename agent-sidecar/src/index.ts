/**
 * Zosma Cowork — Agent Sidecar
 *
 * A thin Node.js process that runs pi-mono's agent SDK programmatically.
 * Communicates with the Tauri Rust backend via stdin/stdout JSON lines.
 *
 * Protocol:
 *   Stdin (commands):  {"type":"<cmd>", ...}
 *   Stdout (events):   {"type":"event", "event":<AgentSessionEvent>}
 *                      {"type":"result", "id":"...", "data":<value>}
 *                      {"type":"done", "id":"..."}
 *                      {"type":"error", "id":"...", "message":"..."}
 */

import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";

// ═══════════════════════════════════════════════════════════════════════════
// Timeout configuration
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Maximum time (ms) to wait for a single prompt to complete before aborting.
 * Prevents the UI from staying in "thinking" state indefinitely when the
 * agent loop hangs (e.g., on a non-responsive API call or stuck tool loop).
 * When this fires, the session is aborted and a "done" event is sent.
 */
const PROMPT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Maximum time (ms) to wait for an individual streaming API request before
 * the HTTP client times out. Applied when no default is set in settings.
 */
const PROVIDER_REQUEST_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// ═══════════════════════════════════════════════════════════════════════════
// System prompt
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Zosma Cowork system prompt.
 *
 * Replaces pi-coding-agent's default "You are an expert coding assistant
 * operating inside pi…" preamble (which would otherwise be sent verbatim and
 * make the model identify as pi). Kept deliberately short — tool schemas are
 * sent separately via the API's `tools` field, so we don't need to re-list
 * them here. `buildSystemPrompt()` will auto-append `Current date:` and
 * `Current working directory:` lines after this string.
 *
 * The "identity note" paragraph matters for users on Claude Pro/Max OAuth:
 * pi-ai prepends `system[0] = "You are Claude Code, Anthropic's official CLI
 * for Claude."` because Anthropic's subscription endpoint validates that
 * string. We can't remove `system[0]` without breaking auth, so we tell the
 * model in `system[1]` that its user-facing identity is Zosma Cowork
 * regardless of what the transport layer says.
 */
const ZOSMA_SYSTEM_PROMPT = `You are Zosma Cowork, a desktop coding assistant. You help users with their projects by reading files, running shell commands, editing code, and writing new files via your tools.

Identity: if the user asks who or what you are, always answer "Zosma Cowork". Some upstream APIs may transport-identify this client as "Claude Code" or "pi" for compatibility — that is not your user-facing identity.

Guidelines:
- Be concise.
- Show file paths clearly when working with files.
- Prefer your built-in tools over shelling out when both work.`;

import {
	AuthStorage,
	DefaultResourceLoader,
	type ExtensionFactory,
	type ExtensionUIContext,
	type ExtensionUIDialogOptions,
	ModelRegistry,
	SessionManager,
	SettingsManager,
	type Theme,
	createAgentSession,
} from "@earendil-works/pi-coding-agent";
// pi-coding-agent's AuthStorage.login does not forward an `originator`
// parameter to provider-specific OAuth flows. OpenAI's auth server
// validates `originator` against a whitelist tied to the Codex CLI
// client_id (`app_EMoamEEZ73f0CkXaXp7hrann`); known accepted values
// include `codex_cli_rs` and `Codex Desktop`. The SDK's default of
// `originator=pi` causes auth.openai.com to return
// `missing_required_parameter` and the browser shows an error page.
// We bypass AuthStorage.login for openai-codex and call the underlying
// loginOpenAICodex directly with a valid originator, then persist via
// authStorage.set() the same way AuthStorage.login would have.
//
// pi-ai is kept as a direct dependency for this `/oauth` subpath:
// pi-coding-agent does not re-export `loginOpenAICodex`, so we import it
// from pi-ai directly. (pi-ai, pi-agent-core and pi-tui are ALSO declared as
// direct deps now because disk-extension-loader.ts statically imports them to
// build the extension `virtualModules` map — see #147. This supersedes the
// earlier #154 note that pi-agent-core was intentionally undeclared.)
import { loginOpenAICodex } from "@earendil-works/pi-ai/oauth";
import {
	discoverExtensions,
	installExtension,
	searchNpmRegistry,
	setExtensionConfig,
	setExtensionEnabled,
	uninstallExtension,
} from "./extension-manager.js";
import { eventBus } from "./event-bus.js";
import { startRemoteServer, stopRemoteServer } from "./remote-server.js";
import { commandQueue } from "./command-queue.js";
import { createPromptScheduler } from "./prompt-scheduler.js";
import {
	handleClearQueueCommand,
	handleFollowUpCommand,
	handleSteerCommand,
} from "./steering.js";
import { extractChatMessages } from "./extract-chat-messages.js";
import {
	loadSettings as loadSettingsStore,
	saveSettings as saveSettingsStore,
} from "./settings-store.js";
import {
	computeInheritedCredentials,
	piAuthPath,
	readAuthFile,
} from "./auth-seed.js";
// Vendored pi-anthropic-messages bridge (see scripts/prebuild.mjs). Without
// this loaded as an extension, Claude Pro/Max OAuth requests are
// fingerprinted by Anthropic as a "third-party app" and rejected with a
// 400 invalid_request_error pointing at claude.ai/settings/usage. The
// bridge rewrites the system prompt and tool names so requests pass as
// canonical Claude CLI traffic. esbuild inlines this module into our bundle.
import piAnthropicMessages from "./vendor/anthropic-messages/extensions/index.js";
// Zosma Office Document Generation extension — registers 8 OfficeCLI tools.
import zosmaOfficeDocs from "./office-docs/extension.js";
import zosmaGoogleCalendar from "./google-calendar/extension.js";
import {
	defaultGooglePaths,
	disconnectGoogle,
	embeddedClient,
	fanOutCredentials,
	GOOGLE_SCOPES,
	googleStatus,
	hasEmbeddedClient,
	migrateLegacyTokens,
} from "./google-auth/broker.js";
import { runConsent } from "./google-auth/consent.js";
// Loads pi's disk/npm/git extensions via virtualModules-backed jiti so they
// work in the bundled sidecar (no node_modules beside it). See #147.
import {
	buildExtensionFactories,
	readPiPackages,
} from "./disk-extension-loader.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InitCommand {
	type: "init";
	zosmaDir?: string;
	/** Optional initial workspace folder; defaults to the home directory. */
	workspace?: string;
}

interface GetModelsCommand {
	type: "get_models";
	id: string;
}

interface GetActiveModelCommand {
	type: "get_active_model";
	id: string;
}

interface PromptCommand {
	type: "prompt";
	id: string;
	text: string;
	_origin?: "remote";
}

interface AbortCommand {
	type: "abort";
	id: string;
}

/**
 * Queue a steering message on the active session — delivered after the
 * current assistant turn finishes executing its tool calls, before the
 * next LLM call. Routed via the SDK's `AgentSession.steer()`, NOT through
 * the prompt-scheduler chain. See {@link ./steering.ts}.
 */
interface SteerCommand {
	type: "steer";
	id: string;
	text: string;
	images?: SteerImage[];
}

/**
 * Queue a follow-up message on the active session — delivered after the
 * agent has no more tool calls or steering messages pending. Routed via
 * `AgentSession.followUp()`. See {@link ./steering.ts}.
 */
interface FollowUpCommand {
	type: "follow_up";
	id: string;
	text: string;
	images?: SteerImage[];
}

/**
 * Atomically drain the active session's steer + follow-up queue and
 * return the drained messages. Issue #201 PR 3 — powers the composer's
 * Ctrl+↑ "edit queue" affordance. The SDK queue is left empty; if the
 * frontend wants to re-queue any pulled message it does so via
 * subsequent steer/follow_up commands.
 */
interface ClearQueueCommand {
	type: "clear_queue";
	id: string;
}

/** Re-export of the steering module's image type to avoid duplicate shapes. */
type SteerImage = import("./steering.js").ImageAttachment;

interface SetModelCommand {
	type: "set_model";
	id: string;
	provider: string;
	model: string;
}

interface SaveAuthCommand {
	type: "save_auth";
	id: string;
	provider: string;
	key: string;
}

interface StartOAuthCommand {
	type: "start_oauth";
	id: string;
	provider: string;
}

interface CancelOAuthCommand {
	type: "cancel_oauth";
	id: string;
}

interface LogoutCommand {
	type: "logout";
	id: string;
	provider: string;
}

interface GetAuthStatusCommand {
	type: "get_auth_status";
	id: string;
}

/** Broker the single Google OAuth consent (union scopes) and fan creds out. */
interface ConnectGoogleCommand {
	type: "connect_google";
	id: string;
}

/** Read both Google config destinations and report connected state. */
interface GetGoogleStatusCommand {
	type: "get_google_status";
	id: string;
}

/** Revoke + delete the brokered Google credentials. */
interface DisconnectGoogleCommand {
	type: "disconnect_google";
	id: string;
}


interface ReloadCommand {
	type: "reload";
	id: string;
}

interface SaveSessionCommand {
	type: "save_session";
	id: string;
	/** Session display title */
	title: string;
	/** Session messages (ChatMessage array) */
	messages: unknown[];
	/** Model info */
	model?: string;
	provider?: string;
}

interface LoadSessionCommand {
	type: "load_session";
	id: string;
	/** Session file name (from list_sessions) */
	sessionFile: string;
}

interface DeleteSessionCommand {
	type: "delete_session";
	id: string;
	/** Session file name to delete */
	sessionFile: string;
}

interface NewSessionCommand {
	type: "new_session";
	id: string;
	/**
	 * Optional workspace folder for the new session. When set (and different
	 * from the active workspace), the agent's file/bash tools and project-local
	 * resource discovery rebind to this folder. Omitted → keep current workspace.
	 */
	cwd?: string;
}

interface GetWorkspaceCommand {
	type: "get_workspace";
	id: string;
}

interface ListSessionsCommand {
	type: "list_sessions";
	id: string;
}

interface GetSettingsCommand {
	type: "get_settings";
	id: string;
}

interface SaveSettingsCommand {
	type: "save_settings";
	id: string;
	defaultModel?: string;
	defaultProvider?: string;
	[key: string]: unknown;
}

interface ListExtensionsCommand {
	type: "list_extensions";
	id: string;
}

interface InstallExtensionCommand {
	type: "install_extension";
	id: string;
	source: string;
	ref?: string;
}

interface UninstallExtensionCommand {
	type: "uninstall_extension";
	id: string;
	extensionId: string;
}

interface SetExtensionEnabledCommand {
	type: "set_extension_enabled";
	id: string;
	extensionId: string;
	enabled: boolean;
}

interface SetExtensionConfigCommand {
	type: "set_extension_config";
	id: string;
	extensionId: string;
	config: Record<string, unknown>;
}

interface GetExtensionConfigFileCommand {
	type: "get_extension_config_file";
	id: string;
	extensionId: string;
}

interface SaveExtensionConfigFileCommand {
	type: "save_extension_config_file";
	id: string;
	extensionId: string;
	patch: Record<string, unknown>;
}

interface SearchDiscoverCommand {
	type: "search_discover";
	id: string;
	query: string;
}

interface SearchSkillsCommand {
	type: "search_skills";
	id: string;
	query: string;
}

interface ListSkillsCommand {
	type: "list_skills";
	id: string;
}

// Skill install/remove moved to Rust (src-tauri/src/lib.rs).
// These handlers no longer exist in the sidecar — npx is not needed.
// interface InstallSkillCommand { type: "install_skill"; id: string; source: string; }
// interface RemoveSkillCommand { type: "remove_skill"; id: string; name: string; }

interface FetchSkillPackumentCommand {
	type: "fetch_skill_packument";
	id: string;
	packageName: string;
}

interface StartRemoteCommand {
	type: "start_remote";
	id: string;
	port?: number;
	host?: string;
}

interface StopRemoteCommand {
	type: "stop_remote";
	id: string;
}

interface GetRemoteStatusCommand {
	type: "get_remote_status";
	id: string;
}

/**
 * Response to an extension UI dialog request (ctx.ui.select/confirm/input/editor).
 * `id` is the UI-request id emitted by the sidecar's uiContext bridge (NOT a
 * command-correlation id — no result/done is sent back for this command).
 */
interface UiResponseCommand {
	type: "ui_response";
	id: string;
	value?: string;
	confirmed?: boolean;
	cancelled?: boolean;
}

type Command =
	| InitCommand
	| GetModelsCommand
	| GetActiveModelCommand
	| PromptCommand
	| AbortCommand
	| SteerCommand
	| FollowUpCommand
	| ClearQueueCommand
	| SetModelCommand
	| SaveAuthCommand
	| StartOAuthCommand
	| CancelOAuthCommand
	| LogoutCommand
	| GetAuthStatusCommand
	| ConnectGoogleCommand
	| GetGoogleStatusCommand
	| DisconnectGoogleCommand
	| ReloadCommand
	| SaveSessionCommand
	| LoadSessionCommand
	| DeleteSessionCommand
	| NewSessionCommand
	| GetWorkspaceCommand
	| ListSessionsCommand
	| GetSettingsCommand
	| SaveSettingsCommand
	| ListExtensionsCommand
	| InstallExtensionCommand
	| UninstallExtensionCommand
	| SetExtensionEnabledCommand
	| SetExtensionConfigCommand
	| GetExtensionConfigFileCommand
	| SaveExtensionConfigFileCommand
	| SearchDiscoverCommand
	| SearchSkillsCommand
	| ListSkillsCommand
	// | InstallSkillCommand — moved to Rust (lib.rs)
	// | RemoveSkillCommand — moved to Rust (lib.rs)
	| FetchSkillPackumentCommand
	| StartRemoteCommand
	| StopRemoteCommand
	| GetRemoteStatusCommand
	| UiResponseCommand;

// ---------------------------------------------------------------------------
// Logger (stderr — never interferes with stdout protocol)
// ---------------------------------------------------------------------------

function log(...args: unknown[]) {
	process.stderr.write(`[sidecar] ${args.join(" ")}\n`);
}

// ---------------------------------------------------------------------------
// JSON stdout sender
// ---------------------------------------------------------------------------

function send(obj: unknown) {
	// Broadcast to EventBus subscribers (e.g., WebSocket remote clients)
	// before writing to stdout. This ensures remote clients receive events
	// even when stdout is piped to the Tauri backend.
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
		// EPIPE happens when the Rust side kills us — ignore gracefully
		if ((err as NodeJS.ErrnoException)?.code === "EPIPE") {
			process.exit(0);
		}
		throw err;
	}
}

// ---------------------------------------------------------------------------
// Extension UI bridge
// ---------------------------------------------------------------------------
//
// pi extensions never render UI directly — they call abstract `ctx.ui.*`
// methods (ExtensionUIContext). Each host supplies an implementation: pi's TUI
// mode draws a terminal overlay, pi's RPC mode emits a JSON request/response
// sub-protocol, and headless/print mode is a no-op (ctx.hasUI === false).
//
// Cowork embeds the engine via createAgentSession() and previously bound NO
// uiContext, so extensions ran in "print" mode: ctx.hasUI was false and tools
// like pi-ask-user bailed out ("Ask requires interactive mode") and the model
// answered itself. This bridge mirrors pi's RPC Extension-UI protocol but
// routes requests to the desktop UI: dialog calls are emitted as
// `{ kind: "ui_request", method, id, ... }` events (which the Rust layer
// forwards to the React frontend) and resolve when the frontend posts back a
// `ui_response` command on stdin. `custom()` returns undefined so well-behaved
// extensions degrade to the portable select()/input() dialogs.

interface PendingUiResponse {
	value?: string;
	confirmed?: boolean;
	cancelled?: boolean;
}

const pendingUiRequests = new Map<string, (response: PendingUiResponse) => void>();

/** Resolve a pending ctx.ui dialog from a `ui_response` stdin command. */
function resolveUiResponse(response: PendingUiResponse & { id: string }): void {
	const resolve = pendingUiRequests.get(response.id);
	if (resolve) {
		pendingUiRequests.delete(response.id);
		resolve(response);
	}
}

/** Emit a UI request wrapped in the standard event envelope the Rust layer forwards. */
function emitUiRequest(payload: Record<string, unknown>): void {
	send({ type: "event", event: { kind: "ui_request", ...payload } });
}

/**
 * Tell the frontend to dismiss a dialog the sidecar resolved on its own
 * (timeout or abort). Without this the React dialog stays on screen while the
 * agent has already moved on with the default/cancelled value.
 */
function emitUiCancel(id: string): void {
	send({ type: "event", event: { kind: "ui_cancel", id } });
}

/**
 * Minimal Theme stub. Headless dialogs (the path extensions take here) never
 * read ctx.ui.theme, but the ExtensionUIContext type requires it. Styling
 * helpers are identity functions so anything that does touch it stays safe.
 */
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

/** Dialog helper with signal/timeout support, mirroring pi's RPC mode. */
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

// ---------------------------------------------------------------------------
// Whitelisted extension config files
// ---------------------------------------------------------------------------
//
// Some extensions store their config in their OWN file rather than Cowork's
// extension registry (set_extension_config). pi-messenger-bridge, for example,
// reads ~/.pi/msg-bridge.json directly. To offer a bespoke setup screen for
// such an extension, Cowork needs to read/write that exact file. Only known
// extensions mapped here are writable from the UI — arbitrary paths are never
// exposed to the renderer.
const WHITELISTED_CONFIG_FILES: Record<string, () => string> = {
	"pi-messenger-bridge": () => join(homedir(), ".pi", "msg-bridge.json"),
};

/** Resolve a whitelisted extension id (lenient: matches `npm:<pkg>` too) to its config-file path. */
function resolveWhitelistedConfigPath(extensionId: string): string | undefined {
	for (const [key, pathFn] of Object.entries(WHITELISTED_CONFIG_FILES)) {
		if (extensionId === key || extensionId.includes(key)) return pathFn();
	}
	return undefined;
}

/** Read+parse a JSON config file, returning {} if missing or malformed. */
function readJsonFile(path: string): Record<string, unknown> {
	try {
		if (!existsSync(path)) return {};
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

/** Recursively merge `patch` into `base` (objects merge; everything else replaces). */
function deepMerge(
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

/** Merge `patch` into a whitelisted config file and persist it with 0600 perms. */
function writeWhitelistedConfig(
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

/** Build an ExtensionUIContext that bridges ctx.ui to the desktop UI. */
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
			// Only string arrays travel over the bridge; component factories need a TUI.
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
		setEditorText: (text) =>
			emitUiRequest({ id: randomUUID(), method: "set_editor_text", text }),
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
		// TUI-only: returning undefined makes extensions fall back to dialog methods.
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
 * Bind the UI bridge to a freshly created session. Providing a uiContext flips
 * the extension runtime's `hasUI()` to true (it returns false only for the
 * internal no-op context), so `ctx.hasUI`-gated tools like pi-ask-user run
 * instead of bailing out. bindExtensions also emits the extensions'
 * `session_start` event, which previously never fired under Cowork.
 */
async function bindExtensionUi(
	s: Awaited<ReturnType<typeof createAgentSession>>["session"],
): Promise<void> {
	await s.bindExtensions({ uiContext: createUiContext() });
}

// Handle EPIPE on stdout globally (when pipe breaks before our next write)
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
	if (err.code === "EPIPE") {
		process.exit(0);
	}
});

// ---------------------------------------------------------------------------
// Zosma config directories
// ---------------------------------------------------------------------------

function defaultZosmaDir(): string {
	const home = homedir();
	return join(home, ".zosmaai");
}

function zosmaAgentDir(zosmaDir: string): string {
	return join(zosmaDir, "cowork");
}

/**
 * Default workspace directory — where the agent reads/writes files when no
 * folder is explicitly chosen.
 *
 * This is the user's HOME directory, treated as the "full system" — the same
 * mental model as opening pi in `~`: the agent can range across the whole home
 * tree. New sessions either pick a specific folder (native picker) or fall back
 * here; legacy sessions with no saved cwd also resume here.
 *
 * Why not `process.cwd()`? Cowork's sidecar is spawned by the Tauri shell,
 * which (for a GUI launch) inherits an arbitrary, user-invisible cwd — `/` on a
 * Linux .desktop launch, the app bundle dir on macOS, system32-ish on Windows.
 * Home is predictable and always exists.
 */
function defaultWorkspaceDir(): string {
	return homedir();
}

/**
 * Resolve a requested workspace path to a usable, existing directory.
 *
 * - Empty/undefined → the default workspace dir.
 * - Leading `~` is expanded to the user's home.
 * - The directory is created if missing.
 * - Anything that isn't a real directory (a file path, an un-creatable path)
 *   falls back to the default workspace dir so the agent never ends up with an
 *   invalid cwd (which would make every file tool call fail).
 */
function resolveWorkspace(requested?: string): string {
	let target = requested?.trim() ? requested.trim() : defaultWorkspaceDir();
	if (target === "~") {
		target = homedir();
	} else if (target.startsWith("~/") || target.startsWith("~\\")) {
		target = join(homedir(), target.slice(2));
	}
	try {
		ensureDir(target);
		if (!statSync(target).isDirectory()) {
			throw new Error("not a directory");
		}
		return target;
	} catch (err) {
		log(
			"workspace resolve failed for %s: %s — falling back to default",
			target,
			err instanceof Error ? err.message : String(err),
		);
		const fallback = defaultWorkspaceDir();
		ensureDir(fallback);
		return fallback;
	}
}

/**
 * pi's canonical agent directory (~/.pi/agent).
 *
 * Zosma Cowork wraps pi-coding-agent, so it shares pi's resources:
 * extensions, skills, prompts, and themes are discovered from (and
 * installed into) pi's own dirs rather than a private cowork silo. This
 * keeps the GUI and the pi CLI in sync — anything installed in one shows
 * up in the other. Cowork-private app state (auth, models, sessions,
 * settings) stays under ~/.zosmaai/cowork via zosmaAgentDir(). See #147.
 */
function piAgentDir(): string {
	return join(homedir(), ".pi", "agent");
}

function ensureDir(dir: string): void {
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

function sessionsDir(zosmaDir: string): string {
	return join(zosmaAgentDir(zosmaDir), "sessions");
}

/**
 * Clean up stale lock files left by old Rust backend (fs4) or crashed processes.
 * pi-mono's AuthStorage uses proper-lockfile which can get stuck on stale locks.
 */
function cleanStaleLocks(dir: string): void {
	if (!existsSync(dir)) return;
	for (const entry of readdirSync(dir)) {
		if (entry.endsWith(".lock")) {
			const lockPath = join(dir, entry);
			try {
				unlinkSync(lockPath);
				log("Cleaned stale lock: %s", entry);
			} catch {
				// ignore if another process holds it
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Remote session state
// ---------------------------------------------------------------------------

/**
 * Tracks the session file for the current remote conversation.
 * Created on the first remote prompt, updated on subsequent ones.
 */
let remoteSessionFile: string | null = null;
let remoteSessionFirstTs: number = 0;

// ---------------------------------------------------------------------------
// Session persistence helpers
// ---------------------------------------------------------------------------

/**
 * List all session files with their metadata headers.
 * Returns sorted by most recent first.
 */
function listSessionFiles(zosmaDir: string): Array<{
	file: string;
	title: string;
	model?: string;
	provider?: string;
	cwd?: string;
	messageCount: number;
	createdAt: number;
	lastActivity: number;
}> {
	const sDir = sessionsDir(zosmaDir);
	if (!existsSync(sDir)) return [];

	const files = readdirSync(sDir)
		.filter((f) => f.endsWith(".jsonl"))
		.sort()
		.reverse();

	const sessions: Array<{
		file: string;
		title: string;
		model?: string;
		provider?: string;
		cwd?: string;
		messageCount: number;
		createdAt: number;
		lastActivity: number;
	}> = [];

	for (const file of files) {
		try {
			const filePath = join(sDir, file);
			const content = readFileSync(filePath, "utf-8");
			const lines = content.trim().split("\n");
			if (lines.length === 0) continue;

			// First line is header
			const header = JSON.parse(lines[0]);
			if (header.type !== "session") continue;

			// Count messages (non-header lines)
			const messageCount = lines.slice(1).filter((l) => l.trim()).length;

			// Last activity is last message timestamp or header timestamp
			let lastActivity = header.createdAt || 0;
			if (lines.length > 1) {
				try {
					const lastLine = JSON.parse(lines[lines.length - 1]);
					lastActivity = lastLine.timestamp || lastActivity;
				} catch {
					// ignore
				}
			}

			sessions.push({
				file,
				title: header.title || file.replace(".jsonl", ""),
				model: header.model,
				provider: header.provider,
				cwd: typeof header.cwd === "string" ? header.cwd : undefined,
				messageCount,
				createdAt: header.createdAt || 0,
				lastActivity,
			});
		} catch (err) {
			log("Error reading session %s: %s", file, err);
		}
	}

	// Sort by lastActivity descending
	sessions.sort((a, b) => b.lastActivity - a.lastActivity);
	return sessions;
}

/**
 * Save messages to a session JSONL file.
 * Format: First line is header, subsequent lines are JSON message objects.
 */
function saveSession(
	zosmaDir: string,
	sessionId: string,
	title: string,
	messages: unknown[],
	model?: string,
	provider?: string,
	cwd?: string,
): void {
	const sDir = sessionsDir(zosmaDir);
	ensureDir(sDir);

	// Strip .jsonl if already present (sent from frontend which adds extension)
	const cleanId = sessionId.replace(/\.jsonl$/i, "");
	const filePath = join(sDir, `${cleanId}.jsonl`);
	const header = {
		type: "session",
		version: 1,
		title,
		createdAt: Date.now(),
		model,
		provider,
		// Workspace folder this conversation ran in, so resuming restores the
		// same cwd. Absent on legacy sessions → they fall back to the default.
		cwd,
		messageCount: messages.length,
	};

	const lines = [JSON.stringify(header)];
	for (const msg of messages) {
		lines.push(JSON.stringify(msg));
	}

	writeFileSync(filePath, `${lines.join("\n")}\n`, "utf-8");
	log("Saved session: %s (%d messages)", sessionId, messages.length);
}

/**
 * Load messages from a session file.
 * Returns the messages array (excluding the header).
 */
function loadSessionMessages(zosmaDir: string, sessionFile: string): unknown[] {
	const filePath = join(sessionsDir(zosmaDir), sessionFile);
	if (!existsSync(filePath)) {
		throw new Error(`Session not found: ${sessionFile}`);
	}

	const content = readFileSync(filePath, "utf-8");
	const lines = content.trim().split("\n");
	if (lines.length === 0) return [];

	const messages: unknown[] = [];
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i].trim();
		if (line) {
			try {
				messages.push(JSON.parse(line));
			} catch {
				log("Skipping invalid JSON in session line %d", i + 1);
			}
		}
	}
	return messages;
}

/**
 * Delete a session file.
 */
function deleteSessionFile(zosmaDir: string, sessionFile: string): boolean {
	const filePath = join(sessionsDir(zosmaDir), sessionFile);
	if (!existsSync(filePath)) return false;
	unlinkSync(filePath);
	log("Deleted session: %s", sessionFile);
	return true;
}

// ---------------------------------------------------------------------------
// Session context restoration
// ---------------------------------------------------------------------------

/**
 * Convert our saved ChatMessage format to pi-mono AgentMessage format
 * and restore them into the active session so the agent has context.
 */
function restoreSessionContext(
	session: Awaited<ReturnType<typeof createAgentSession>>["session"],
	messages: unknown[],
): void {
	const piMessages: unknown[] = [];

	for (const raw of messages) {
		const msg = raw as Record<string, unknown>;
		const role = msg.role as string;
		const content = msg.content as string | undefined;
		const timestamp = msg.timestamp as number | undefined;
		const thinking = msg.thinking as string | undefined;
		const toolCalls = msg.toolCalls as Array<Record<string, unknown>> | undefined;
		const model = msg.model as string | undefined;
		const provider = msg.provider as string | undefined;

		if (role === "user") {
			piMessages.push({
				role: "user",
				content: [{ type: "text", text: content || "" }],
				timestamp,
			});
		} else if (role === "assistant") {
			const contentArr: Array<Record<string, unknown>> = [];

			// Order: thinking → tool calls → final text
			if (thinking) {
				contentArr.push({ type: "thinking", thinking });
			}

			if (toolCalls && toolCalls.length > 0) {
				for (const tc of toolCalls) {
					contentArr.push({
						type: "toolCall",
						id: tc.id,
						name: tc.name,
						arguments: tc.args || {},
					});
				}
			}

			if (content) {
				contentArr.push({ type: "text", text: content });
			}

			// pi-ai's AssistantMessage requires usage/stopReason/api fields.
			// Without them, AgentSession.prompt() -> _checkCompaction() ->
			// calculateContextTokens(usage) throws on undefined usage, which
			// aborts the very next prompt in a restored session (no LLM response).
			piMessages.push({
				role: "assistant",
				content: contentArr,
				timestamp,
				model: model || "",
				provider: provider || "",
				api: provider || "",
				stopReason: "stop",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
			});

			// Append tool result messages for completed tool calls
			if (toolCalls) {
				for (const tc of toolCalls) {
					const status = tc.status as string;
					if (status === "completed" || status === "error") {
						piMessages.push({
							role: "toolResult",
							toolCallId: tc.id,
							toolName: tc.name as string,
							content: [{ type: "text", text: (tc.result as string) || "" }],
							isError: status === "error",
							timestamp,
						});
					}
				}
			}
		}
		// System messages: skip — they're display-only status indicators
	}

	if (piMessages.length > 0) {
		log("Restoring %d messages into session context", piMessages.length);
		// biome-ignore lint/suspicious/noExplicitAny: pi-mono doesn't export AgentState type
		(session as any).agent.state.messages = piMessages;
	}
}

// ---------------------------------------------------------------------------
// Settings persistence
// ---------------------------------------------------------------------------

function loadSettings(zosmaDir: string): Record<string, unknown> {
	return loadSettingsStore(zosmaAgentDir(zosmaDir));
}

// Persist a PARTIAL settings update. Delegates to the settings-store, which
// merges into the existing file so independent keys (model, persona, telemetry
// consent) don't clobber one another.
function saveSettings(zosmaDir: string, settings: Record<string, unknown>): void {
	saveSettingsStore(zosmaAgentDir(zosmaDir), settings);
	log("Settings saved");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	log("Sidecar starting (pid=%s)", process.pid);

	// Defaults
	let zosmaDir = defaultZosmaDir();
	// The agent's working directory — where file/bash tools read & write the
	// user's project files. Pinned to a predictable default until a session
	// explicitly selects a folder (see resolveWorkspace + new_session.cwd).
	// Deliberately NOT process.cwd(): a GUI-launched sidecar inherits an
	// arbitrary cwd the user never chose.
	let workspaceCwd = resolveWorkspace();
	let activePromptId: string | null = null;
	// Serializes prompt execution WITHOUT blocking the stdin read loop, so an
	// `abort` (and the next prompt) stay readable mid-generation. See
	// runPromptTask + the "prompt" command handler, and prompt-scheduler.ts.
	const promptScheduler = createPromptScheduler();

	// In-flight OAuth login (only one at a time). Holds the AbortController so
	// `cancel_oauth` can interrupt the SDK's loopback callback server, and the
	// promise tracking the flow's full lifecycle so a re-entrant `start_oauth`
	// can wait for the previous flow's cleanup before installing a fresh one.
	let oauthAbort: AbortController | null = null;
	let oauthInflight: Promise<void> | null = null;
	// Separate slot for the Google broker consent flow (loopback+PKCE), kept
	// distinct from provider OAuth above so a Sign-In and a Connect-Google can
	// be in flight independently.
	let googleConsentAbort: AbortController | null = null;

	// These are set during init
	let authStorage: AuthStorage | undefined;
	let modelRegistry: ModelRegistry | undefined;
	let sessionManager: ReturnType<typeof SessionManager.inMemory> | undefined;
	let settingsManager: ReturnType<typeof SettingsManager.inMemory> | undefined;
	let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | undefined;
	let resourceLoader: DefaultResourceLoader | undefined;

	// Flag: ready to accept prompts
	let initialized = false;

	/**
	 * Build a DefaultResourceLoader bound to a specific workspace `cwd`.
	 *
	 * Extracted from initAgent so a fresh session can rebind the loader to a
	 * newly-selected folder (new_session.cwd) without a full re-init. Shared pi
	 * resources still come from ~/.pi/agent (agentDir); only project-local
	 * discovery and the tools' working directory follow `cwd`.
	 *
	 * Requires settingsManager to be initialized first.
	 */
	async function buildResourceLoader(
		cwd: string,
	): Promise<DefaultResourceLoader> {
		if (!settingsManager) {
			throw new Error("buildResourceLoader: settingsManager not initialized");
		}
		const piResourceDir = piAgentDir();
		ensureDir(piResourceDir);

		// Load pi's disk/npm/git extensions ourselves, via virtualModules-backed
		// jiti (see disk-extension-loader.ts). The shipped sidecar is a single
		// esbuild bundle with no node_modules, so pi's native loader cannot
		// resolve extension deps and every extension fails silently (#147). We
		// resolve entry paths with pi's own package manager and load them with
		// the bundled package copies. This path is used in dev too (tsx) for
		// dev/prod parity. `noExtensions: true` below stops the resource loader
		// from also trying (and failing) to load them.
		let diskExtensionFactories: ExtensionFactory[] = [];
		try {
			const built = await buildExtensionFactories({
				cwd,
				agentDir: piResourceDir,
				settingsManager,
			});
			diskExtensionFactories = built.factories;
			log(
				`loading ${built.paths.length} pi extension(s) via virtualModules: ${
					built.paths.join(", ") || "(none)"
				}`,
			);
		} catch (err) {
			log(
				`failed to resolve pi extensions: ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
		}

		const loader = new DefaultResourceLoader({
			cwd,
			// Discover shared pi resources from ~/.pi/agent (not the cowork dir).
			agentDir: piResourceDir,
			settingsManager,
			// We load ALL extensions ourselves (vendored inline + pi's disk/npm
			// extensions via jiti). Skills/prompts/themes still load normally.
			noExtensions: true,
			extensionFactories: [
				piAnthropicMessages,
				zosmaOfficeDocs,
				zosmaGoogleCalendar,
				...diskExtensionFactories,
			],
			systemPromptOverride: () => ZOSMA_SYSTEM_PROMPT,
			appendSystemPromptOverride: () => [],
		});
		await loader.reload();
		// Surface any extension-load errors — they're silently collected by
		// the loader otherwise, which made the pi-anthropic-messages bridge
		// look "installed" while never actually activating.
		try {
			const extResult = loader.getExtensions();
			if (extResult.errors && extResult.errors.length > 0) {
				for (const err of extResult.errors) {
					log("extension load error: %s — %s", err.path, err.error);
				}
			}
			log(
				"extensions loaded: %d (errors: %d)",
				extResult.extensions?.length ?? 0,
				extResult.errors?.length ?? 0,
			);
			for (const ext of extResult.extensions ?? []) {
				log("  - %s", ext.path);
			}
		} catch (err) {
			log("getExtensions failed: %s", err);
		}
		return loader;
	}

	async function initAgent(zosmaDirPath: string, workspace?: string) {
		zosmaDir = zosmaDirPath;
		// A caller-supplied workspace folder overrides the default. Resolved &
		// created here so the rest of init binds tools/sessions to a real dir.
		if (workspace !== undefined) {
			workspaceCwd = resolveWorkspace(workspace);
		}
		log("Workspace cwd: %s", workspaceCwd);
		const agentDir = zosmaAgentDir(zosmaDir);
		ensureDir(agentDir);

		const authPath = join(agentDir, "auth.json");
		const modelsPath = join(agentDir, "models.json");

		// Clean stale lock files from old Rust backend
		cleanStaleLocks(agentDir);

		// One-time migration of legacy Google token files (pre-unified OAuth).
		const piDir = piAgentDir();
		const migration = migrateLegacyTokens(defaultGooglePaths(piDir));
		if (migration.migrated) {
			log("Migrated legacy Google tokens from %s", migration.from);
		}

		log("Agent dir: %s", agentDir);
		log("Auth path: %s", authPath);
		log("Models path: %s", modelsPath);

		// Auth storage — points at our zosma dir
		authStorage = AuthStorage.create(authPath);

		// Credential inheritance from the pi CLI. When Cowork has NO credentials of
		// its own, fall back to ~/.pi/agent/auth.json and seed every provider the
		// user already configured in pi (API keys AND OAuth). This makes those
		// providers work immediately and means the onboarding/Connect screen only
		// appears when NOTHING is configured anywhere (in pi OR Cowork). Once Cowork
		// has any credential of its own we stop inheriting, so a deliberate logout
		// of a single provider sticks; only a fully-empty Cowork auth falls back to
		// pi again. See user request in the #169 thread.
		if (authStorage.list().length === 0) {
			try {
				const inherited = computeInheritedCredentials(
					{},
					readAuthFile(piAuthPath(piAgentDir())),
				);
				const ids = Object.keys(inherited);
				for (const id of ids) {
					authStorage.set(id, inherited[id] as Parameters<typeof authStorage.set>[1]);
				}
				if (ids.length > 0) {
					log("Seeded %d credential(s) from pi: %s", ids.length, ids.join(", "));
				}
			} catch (err) {
				log(
					"pi credential seed failed: %s",
					err instanceof Error ? err.message : String(err),
				);
			}
		}

		// Model registry — reads built-in + custom models from our dir
		modelRegistry = ModelRegistry.create(authStorage, modelsPath);

		// Settings — in-memory for now, minimal config
		// Set a default provider timeout so API calls never hang indefinitely.
		//
		// Compaction is NOT explicitly disabled here: pi-coding-agent ships
		// auto-compaction + branch summarization on by default
		// (DEFAULT_COMPACTION_SETTINGS in dist/core/compaction/compaction.js,
		// reserveTokens=16384, keepRecentTokens=20000) and we want both. Without
		// it, long Zosma sessions hard-fail with context-window overflow
		// instead of self-summarising older turns. See #135.
		settingsManager = SettingsManager.inMemory({
			retry: {
				provider: {
					timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS,
					maxRetries: 3,
				},
			},
		});
		// Share pi's installed packages (~/.pi/agent/settings.json `packages`) so
		// the resource loader resolves pi's npm/git/local skills, prompts and
		// themes — and so we can resolve pi's extensions below. Cowork wraps pi
		// and surfaces the same resources. See #147.
		const piPackages = readPiPackages(piAgentDir());
		if (piPackages.length > 0) {
			settingsManager.setPackages(piPackages);
		}

		// Resource loader — discovers extensions, skills, prompts, and themes
		// from pi's agent dir (~/.pi/agent), NOT the cowork-private dir. Cowork
		// is a GUI wrapper over pi-coding-agent, so it shares pi's resources:
		// extensions installed via the pi CLI (or dropped into
		// ~/.pi/agent/extensions) are picked up here, and cowork's own installs
		// land in the same place (see extension-manager.ts). Closes #147.
		//
		// The vendored pi-anthropic-messages bridge and Zosma office-docs
		// extension are passed as inline factories; pi's disk/npm/git extensions
		// are loaded via disk-extension-loader.ts (virtualModules-backed jiti)
		// since the bundled sidecar has no node_modules for pi's native loader
		// to resolve extension deps against (#147).
		//
		// Brand the system prompt as Zosma Cowork (closes #112). Without
		// `systemPromptOverride`, pi-coding-agent's default
		// `buildSystemPrompt()` ships a ~250-token prompt that opens with
		// "You are an expert coding assistant operating inside pi…" plus a
		// full pi documentation block. That leaks the wrong identity to the
		// model. Anthropic Claude Pro/Max OAuth additionally prepends
		// `system[0]` = "You are Claude Code, Anthropic's official CLI for
		// Claude." inside pi-ai (mandatory — the subscription endpoint
		// validates that string). Our prompt explicitly disambiguates so the
		// model's user-facing identity is always Zosma Cowork even when the
		// transport-layer identity says otherwise.
		//
		// `appendSystemPromptOverride: () => []` suppresses any
		// APPEND_SYSTEM.md the loader would otherwise pick up from
		// ~/.zosmaai/agent (or pi's own dirs) — those files are meant for
		// pi CLI users, not Zosma's bundled sidecar.
		// Build the resource loader bound to the active workspace cwd. Project-
		// local resources (a `.agents/` folder inside the chosen workspace) are
		// discovered relative to this cwd, mirroring pi's "open from any folder".
		resourceLoader = await buildResourceLoader(workspaceCwd);

		// Session manager — in-memory (persistence handled by sidecar commands).
		// Bind it to the workspace cwd so the agent's file/bash tools read & write
		// the user's chosen folder, not the sidecar's inherited process.cwd().
		sessionManager = SessionManager.inMemory(workspaceCwd);

		// Create the agent session. `cwd` is passed explicitly (not left to the
		// process default) so tools are bound to the workspace folder.
		const result = await createAgentSession({
			cwd: workspaceCwd,
			authStorage,
			modelRegistry,
			sessionManager,
			settingsManager,
			resourceLoader,
		});
		session = result.session;

		// Subscribe to all agent events and forward to stdout
		session.subscribe((event) => {
			send({ type: "event", event });
		});

		// Bind the extension UI bridge (mode "rpc" → ctx.hasUI true) so ctx.ui
		// dialogs (e.g. pi-ask-user) render in the desktop UI, and so extensions
		// receive their session_start event.
		await bindExtensionUi(result.session);

		initialized = true;

		// Report available models
		const available = await modelRegistry.getAvailable();
		const models = available.map((m) => ({
			id: m.id,
			name: m.name,
			provider: m.provider,
			reasoning: m.reasoning,
			contextWindow: m.contextWindow,
			maxTokens: m.maxTokens,
		}));

		// Build provider list
		const providerMap = new Map<string, { id: string; modelCount: number }>();
		for (const m of available) {
			const p = m.provider;
			const existing = providerMap.get(p) ?? { id: p, modelCount: 0 };
			existing.modelCount++;
			providerMap.set(p, existing);
		}

		send({
			type: "ready",
			models,
			providers: Array.from(providerMap.values()),
			// The model the engine will actually run unless/until the UI sets one.
			// Lets the frontend mirror reality instead of guessing models[0].
			activeModel: session?.model
				? {
						provider: session.model.provider,
						id: session.model.id,
						name: session.model.name,
					}
				: null,
		});

		log("Sidecar ready — %d models available", models.length);
	}

	/// Runs one prompt to completion. Extracted from the "prompt" command so it
	/// can be scheduled on promptChain instead of being awaited inline in the
	/// stdin read loop. Awaiting inline blocked the loop for the entire
	/// generation, so a desktop `abort` (delivered over stdin) could not be read
	/// until the prompt finished — making "stop" a no-op mid-generation and
	/// queuing the next prompt behind the 10-minute auto-abort timeout.
	async function runPromptTask(cmd: {
		id: string;
		text: string;
		_origin?: string;
	}): Promise<void> {
		const activeSession = session;
		if (!activeSession) {
			send({ type: "error", id: cmd.id, message: "Not initialized" });
			send({ type: "done", id: cmd.id });
			return;
		}
		const promptModel = activeSession.model;
		log("prompt: using model %s/%s", promptModel?.provider, promptModel?.id);
		activePromptId = cmd.id;

		// Auto-abort timeout: prevents the UI from staying in "thinking" state
		// indefinitely when a prompt hangs (e.g. streaming request interrupted,
		// API unresponsive, tool loop stuck). The timeout calls
		// session.abort() which triggers the agent's abort signal, cancelling
		// the active streaming request or tool execution. The agent loop then
		// terminates with "aborted" stop reason and session.prompt() resolves,
		// allowing the "done" event to be sent.
		const abortTimeout = setTimeout(() => {
			log("prompt: timeout after %dms — aborting session", PROMPT_TIMEOUT_MS);
			try {
				activeSession.abort();
			} catch {
				// ignore if session already completed
			}
		}, PROMPT_TIMEOUT_MS);

		const isRemote = cmd._origin === "remote";

		try {
			await activeSession.prompt(cmd.text);
		} catch (err) {
			// Surface SDK errors back to the UI instead of swallowing them
			// silently with just a "done" event.
			const msg = err instanceof Error ? err.message : String(err);
			log("prompt: %s", msg);
			send({ type: "error", id: cmd.id, message: msg });
		} finally {
			clearTimeout(abortTimeout);
			send({ type: "done", id: cmd.id });
			activePromptId = null;

			// Persist session to shared store so the desktop UI sees it
			if (isRemote && activeSession) {
				try {
					if (
						activeSession.agent?.state?.messages &&
						Array.isArray(activeSession.agent.state.messages)
					) {
						// Create session ID on first remote prompt
						if (!remoteSessionFile) {
							remoteSessionFirstTs = Date.now();
							remoteSessionFile = `remote-${remoteSessionFirstTs}`;
						}

						const chatMessages = extractChatMessages(
							activeSession.agent.state.messages as unknown[],
						);
						if (chatMessages.length > 0) {
							saveSession(
								zosmaDir,
								remoteSessionFile,
								"Remote Chat",
								chatMessages,
								activeSession.model?.id,
								activeSession.model?.provider,
								workspaceCwd,
							);
							log(
								"Saved remote session: %s (%d messages)",
								remoteSessionFile,
								chatMessages.length,
							);
						}
					}
				} catch (err) {
					log("Failed to save remote session: %s", err);
				}
			}
		}
	}

	/// Processes a single command through the sidecar's command switch.
	/// Extracted so both stdin lines and queued remote commands use the
	/// same dispatch logic.
	async function handleCommand(cmd: Command): Promise<void> {
		log("Command: type=%s id=%s", cmd.type, "id" in cmd ? cmd.id : "-");

		switch (cmd.type) {
				// ── init ───────────────────────────────────────────────────
				case "init": {
					await initAgent(cmd.zosmaDir ?? defaultZosmaDir(), cmd.workspace);
					break;
				}

				// ── get_models ─────────────────────────────────────────────
				case "get_models": {
					if (!initialized || !modelRegistry) {
						send({ type: "error", id: cmd.id, message: "Not initialized" });
						break;
					}
					const available = await modelRegistry.getAvailable();
					const models = available.map((m) => ({
						id: m.id,
						name: m.name,
						provider: m.provider,
						reasoning: m.reasoning,
						contextWindow: m.contextWindow,
						maxTokens: m.maxTokens,
					}));
					send({ type: "result", id: cmd.id, data: { models } });
					break;
				}

				// ── prompt ─────────────────────────────────────────────────
				case "prompt": {
					if (!initialized || !session) {
						send({ type: "error", id: cmd.id, message: "Not initialized" });
						break;
					}
					// Schedule on the serialized chain but DO NOT await here — awaiting
					// inside the stdin read loop would block it for the whole
					// generation, so a desktop `abort` (sent over stdin) could not be
					// read until the prompt finished. By scheduling and returning, the
					// loop keeps reading stdin: `abort` is dispatched immediately
					// (calls session.abort()), and the next prompt runs only after this
					// one settles (the chain serializes prompts so two never overlap).
					const promptCmd = cmd;
					promptScheduler.schedule(
						() => runPromptTask(promptCmd),
						(err: unknown) => {
							// runPromptTask handles its own errors; this is a defensive
							// guard so a thrown task never breaks the chain for later
							// prompts.
							const msg = err instanceof Error ? err.message : String(err);
							log("prompt task error: %s", msg);
							send({ type: "error", id: promptCmd.id, message: msg });
							send({ type: "done", id: promptCmd.id });
						},
					);
					break;
				}

				// ── abort ──────────────────────────────────────────────────
				case "abort": {
					if (session) {
						session.abort();
					}
					send({
						type: "done",
						id: cmd.id ?? activePromptId ?? "abort",
					});
					activePromptId = null;
					break;
				}

				// ── steer ─────────────────────────────────────────────────
				// Queue a steering message on the running session. Delivered
				// after the current assistant turn's tool calls finish, before
				// the next LLM call. Bypasses promptScheduler deliberately —
				// see steering.ts for the protocol contract.
				case "steer": {
					if (!initialized || !session) {
						send({ type: "error", id: cmd.id, message: "Not initialized" });
						break;
					}
					await handleSteerCommand(session, cmd, send);
					break;
				}

				// ── follow_up ─────────────────────────────────────────────
				// Queue a follow-up message; delivered once the agent has no
				// more tool calls or steering messages pending. Bypasses
				// promptScheduler — see steering.ts.
				case "follow_up": {
					if (!initialized || !session) {
						send({ type: "error", id: cmd.id, message: "Not initialized" });
						break;
					}
					await handleFollowUpCommand(session, cmd, send);
					break;
				}

				// ── clear_queue ─────────────────────────────
				// Drain the SDK queue and return what was drained so the
				// composer can present the messages for editing. Issue #201
				// PR 3 — see steering.ts.
				case "clear_queue": {
					if (!initialized || !session) {
						send({ type: "error", id: cmd.id, message: "Not initialized" });
						break;
					}
					await handleClearQueueCommand(session, cmd, send);
					break;
				}

				// ── ui_response ────────────────────────────────────────────
				// Frontend's answer to a ctx.ui dialog request. Resolves the
				// pending promise in the extension UI bridge; no result/done is
				// sent (the `id` is a UI-request id, not a command id).
				case "ui_response": {
					resolveUiResponse({
						id: cmd.id,
						value: cmd.value,
						confirmed: cmd.confirmed,
						cancelled: cmd.cancelled,
					});
					break;
				}

				// ── set_model ──────────────────────────────────────────────
				// ── get_active_model ───────────────────────────────────────
				// Returns the model the engine will actually run (session.model).
				// The frontend uses this to mirror the engine on startup so the
				// model shown near the input matches the model that answers.
				case "get_active_model": {
					if (!initialized || !session) {
						send({ type: "error", id: cmd.id, message: "Not initialized" });
						break;
					}
					const m = session.model;
					send({
						type: "result",
						id: cmd.id,
						data: m
							? { provider: m.provider, id: m.id, name: m.name }
							: null,
					});
					break;
				}

				case "set_model": {
					if (!initialized || !session) {
						send({ type: "error", id: cmd.id, message: "Not initialized" });
						break;
					}
					const found = modelRegistry?.find(cmd.provider, cmd.model);
					if (found) {
						log("set_model: found %s/%s (id=%s)", cmd.provider, cmd.model, found.id);
						await session.setModel(found as Parameters<typeof session.setModel>[0]);
						const currentModel = session.model;
						log(
							"set_model: after setModel, session.model = %s/%s",
							currentModel?.provider,
							currentModel?.id,
						);
						send({ type: "result", id: cmd.id, data: { success: true } });
					} else {
						log("set_model: NOT FOUND %s/%s", cmd.provider, cmd.model);
						send({
							type: "error",
							id: cmd.id,
							message: `Model not found: ${cmd.provider}/${cmd.model}`,
						});
					}
					break;
				}

				// ── save_auth ──────────────────────────────────────────────
				case "save_auth": {
					const agentDir = zosmaAgentDir(zosmaDir);
					ensureDir(agentDir);
					cleanStaleLocks(agentDir);

					const authPath = join(agentDir, "auth.json");
					let existing: Record<string, unknown> = {};
					try {
						if (existsSync(authPath)) {
							existing = JSON.parse(readFileSync(authPath, "utf-8"));
						}
					} catch {
						// Start fresh if corrupt
					}

					existing[cmd.provider] = { type: "api_key", key: cmd.key };
					writeFileSync(authPath, JSON.stringify(existing, null, 2), "utf-8");
					log("Saved API key for %s", cmd.provider);

					// Reload: recreate everything with fresh auth
					await initAgent(zosmaDir);
					send({ type: "result", id: cmd.id, data: { success: true } });
					break;
				}

				// ── start_oauth ────────────────────────────────────────────
				case "start_oauth": {
					if (!authStorage) {
						send({ type: "error", id: cmd.id, message: "Not initialized" });
						break;
					}
					// If a previous flow is still in flight (e.g. the user closed
					// the browser without completing), abort it and wait for its
					// cleanup before installing a new one. This makes start_oauth
					// idempotent — clicking "Sign In" again always works.
					if (oauthAbort) {
						log("start_oauth: aborting previous in-flight flow");
						oauthAbort.abort();
						if (oauthInflight) {
							try {
								await oauthInflight;
							} catch {
								// expected: previous flow rejected with AbortError
							}
						}
					}
					const ac = new AbortController();
					oauthAbort = ac;
					const provider = cmd.provider;
					const cmdId = cmd.id;
					const storage = authStorage;
					log("Starting OAuth for %s", provider);
					// Build the callback bag once so we can reuse it for both the
					// generic storage.login() path AND the openai-codex override
					// path below. Closing over `provider`, `ac`, `storage`, and
					// `cmdId` makes the duplication painless.
					oauthInflight = (async () => {
						try {
							if (provider === "openai-codex") {
								// Direct call to loginOpenAICodex with a whitelisted
								// originator. See the import-site comment for context.
								const creds = await loginOpenAICodex({
									originator: "codex_cli_rs",
									onAuth: (info) => {
										send({
											type: "event",
											event: {
												kind: "oauth_open_url",
												provider,
												url: info.url,
												instructions: info.instructions,
											},
										});
									},
									onPrompt: async (prompt) => {
										throw new Error(
											`Interactive prompts are not supported in the desktop OAuth flow (message: ${String(prompt.message ?? "")})`,
										);
									},
									onProgress: (message) => {
										send({
											type: "event",
											event: { kind: "oauth_progress", provider, message },
										});
									},
									onManualCodeInput: () =>
										new Promise<string>((_resolve, reject) => {
											const err = new Error("OAuth cancelled");
											err.name = "AbortError";
											if (ac.signal.aborted) {
												reject(err);
												return;
											}
											ac.signal.addEventListener("abort", () => reject(err), {
												once: true,
											});
										}),
								});
								// Persist exactly the way AuthStorage.login would have.
								storage.set(provider, { type: "oauth", ...creds });
							} else {
							await storage.login(provider, {
								onAuth: (info) => {
									send({
										type: "event",
										event: {
											kind: "oauth_open_url",
											provider,
											url: info.url,
											instructions: info.instructions,
										},
									});
								},
								onPrompt: async (prompt) => {
									// Some providers (notably GitHub Copilot) ask for a
									// GitHub Enterprise URL during the OAuth flow with a
									// "blank for github.com" affordance. There's no input
									// surface in the desktop UI for this, so accept the
									// blank default. Any prompt whose placeholder reads as
									// "blank for <something>" or "default <something>" is
									// safe to default — the SDK validates the result and
									// will report a clear error if the empty answer is
									// rejected. Everything else still throws.
									const msg = String(prompt.message ?? "").trim();
									const placeholder = String(prompt.placeholder ?? "").trim();
									const blankIsValid =
										/blank for|default[: ]/i.test(placeholder) ||
										/enterprise/i.test(msg);
									if (blankIsValid) {
										log(
											"OAuth prompt auto-answered with empty (message=%s, placeholder=%s)",
											msg,
											placeholder,
										);
										return "";
									}
									throw new Error(
										`Interactive prompts are not supported in the desktop OAuth flow (message: ${msg})`,
									);
								},
								onProgress: (message) => {
									send({
										type: "event",
										event: { kind: "oauth_progress", provider, message },
									});
								},
								// The SDK's loginAnthropic ignores the `signal` parameter,
								// so `cancel_oauth` cannot unstick the loopback HTTP
								// server (bound on 53692) directly. Provide an
								// onManualCodeInput callback that rejects when our
								// AbortController fires: that triggers the SDK's
								// server.cancelWait() path, which lets the finally
								// block in loginAnthropic close the server. Without this
								// the server stays bound and subsequent sign-in attempts
								// fail with EADDRINUSE.
								onManualCodeInput: () =>
									new Promise<string>((_resolve, reject) => {
										const err = new Error("OAuth cancelled");
										err.name = "AbortError";
										if (ac.signal.aborted) {
											reject(err);
											return;
										}
										const onAbort = () => reject(err);
										ac.signal.addEventListener("abort", onAbort, {
											once: true,
										});
									}),
								signal: ac.signal,
							});
							}
							log("OAuth login succeeded for %s", provider);
							// Release the AbortSignal so the dangling
							// onManualCodeInput promise rejects and gets GC'd.
							if (!ac.signal.aborted) ac.abort();
							send({ type: "result", id: cmdId, data: { success: true } });
							send({
								type: "event",
								event: { kind: "oauth_completed", provider },
							});
							// Reload the agent so the new provider's models appear.
							initAgent(zosmaDir).catch((err) => {
								log("initAgent failed after oauth: %s", err);
								send({
									type: "event",
									event: { kind: "agent_reload_failed", error: String(err) },
								});
							});
						} catch (err: unknown) {
							const errAny = err as { name?: string; message?: string } | undefined;
							const cancelled = errAny?.name === "AbortError" || ac.signal.aborted;
							log(
								"OAuth login %s for %s: %s",
								cancelled ? "cancelled" : "failed",
								provider,
								errAny?.message ?? err,
							);
							send({
								type: "result",
								id: cmdId,
								data: {
									success: false,
									cancelled,
									error: cancelled ? undefined : String(errAny?.message ?? err),
								},
							});
							send({
								type: "event",
								event: {
									kind: cancelled ? "oauth_cancelled" : "oauth_failed",
									provider,
									error: cancelled ? undefined : String(errAny?.message ?? err),
								},
							});
						} finally {
							// Only clear if we still own the slot. A subsequent
							// start_oauth call may have installed a fresh AC/promise
							// while this one was unwinding.
							if (oauthAbort === ac) {
								oauthAbort = null;
								oauthInflight = null;
							}
						}
					})();
					break;
				}

				// ── cancel_oauth ───────────────────────────────────────────
				case "cancel_oauth": {
					if (oauthAbort) {
						log("Cancelling OAuth flow");
						oauthAbort.abort();
					}
					send({ type: "result", id: cmd.id, data: { success: true } });
					break;
				}

				// ── logout ─────────────────────────────────────────────────
				case "logout": {
					if (!authStorage) {
						send({ type: "error", id: cmd.id, message: "Not initialized" });
						break;
					}
					try {
						authStorage.logout(cmd.provider);
						log("Logged out provider %s", cmd.provider);
					} catch (err) {
						log("logout failed: %s", err);
					}
					send({ type: "result", id: cmd.id, data: { success: true } });
					initAgent(zosmaDir).catch((err) => {
						log("initAgent failed after logout: %s", err);
						send({
							type: "event",
							event: { kind: "agent_reload_failed", error: String(err) },
						});
					});
					break;
				}

				// ── get_auth_status ────────────────────────────────────────
				case "get_auth_status": {
					if (!authStorage) {
						send({ type: "error", id: cmd.id, message: "Not initialized" });
						break;
					}
					const providers: Array<{
						id: string;
						type: "api_key" | "oauth" | "unknown";
						expires?: number;
					}> = [];
					for (const providerId of authStorage.list()) {
						const cred = authStorage.get(providerId);
						if (!cred) continue;
						if (cred.type === "oauth") {
							providers.push({
								id: providerId,
								type: "oauth",
								expires: (cred as { expires?: number }).expires,
							});
						} else if (cred.type === "api_key") {
							providers.push({ id: providerId, type: "api_key" });
						} else {
							providers.push({ id: providerId, type: "unknown" });
						}
					}
					// Also expose OAuth providers the SDK supports, so the UI can
					// offer "Sign in" buttons for providers the user hasn't yet
					// configured.
					let supported: string[] = [];
					try {
						supported = authStorage.getOAuthProviders().map((p) => p.id);
					} catch {
						// older SDKs may not expose this — fail soft
					}
					// Expose the full list of providers pi-mono knows about, so the
					// UI can offer an API-key entry for any of them (issue #150 —
					// previously the UI hardcoded a single "opencode-go" slot).
					// Built from modelRegistry.getAll() deduped by provider, with
					// the registry's own displayName for pretty labels.
					let apiKeyProviders: Array<{ id: string; displayName: string }> = [];
					try {
						if (!modelRegistry) throw new Error("model registry not ready");
						const seen = new Set<string>();
						for (const m of modelRegistry.getAll()) {
							if (seen.has(m.provider)) continue;
							seen.add(m.provider);
							apiKeyProviders.push({
								id: m.provider,
								displayName:
									modelRegistry.getProviderDisplayName?.(m.provider) ??
									m.provider,
							});
						}
						apiKeyProviders.sort((a, b) =>
							a.displayName.localeCompare(b.displayName),
						);
					} catch {
						// fail soft — UI will fall back to a freeform input
						apiKeyProviders = [];
					}
					send({
						type: "result",
						id: cmd.id,
						data: { providers, supported, apiKeyProviders },
					});
					break;
				}

				// ── connect_google (B2 #186) ────────────────────────────────
				case "connect_google": {
					if (!hasEmbeddedClient()) {
						send({
							type: "error",
							id: cmd.id,
							message:
								"Zosma Google OAuth client not configured. Set ZOSMA_GOOGLE_CLIENT_ID and ZOSMA_GOOGLE_CLIENT_SECRET.",
						});
						break;
					}
					// Abort a prior in-flight flow if the user clicks Connect again.
					if (googleConsentAbort) {
						googleConsentAbort.abort();
					}
					const ac = new AbortController();
					googleConsentAbort = ac;
					const cmdId = cmd.id;
					const client = embeddedClient();
					const paths = defaultGooglePaths();

					// Fire the async consent flow (non-blocking from the handler's
					// perspective — the send() for result/error comes from within).
					(async () => {
						try {
							send({
								type: "event",
								event: {
									kind: "oauth_progress",
									provider: "google",
									message: "Opening browser for Google consent…",
								},
							});
							const result = await runConsent({
								client,
								onAuthUrl: (url) => {
									send({
										type: "event",
										event: {
											kind: "oauth_open_url",
											provider: "google",
											url,
											instructions:
												"Sign in with your Google account to connect Gmail, Calendar, Drive, Docs, Sheets and Slides.",
										},
									});
								},
								signal: ac.signal,
							});

							send({
								type: "event",
								event: {
									kind: "oauth_progress",
									provider: "google",
									message: "Google consent granted. Fanning out credentials…",
								},
							});

							fanOutCredentials(paths, {
								client,
								tokens: result.tokens,
								email: result.email,
								redirectUri: result.redirectUri,
							});

							log("Google: credentials fanned out to %s and %s + %s", paths.workspaceOAuth, paths.piSettings, paths.gmailTokens);
							if (!ac.signal.aborted) ac.abort();
							googleConsentAbort = null;

							send({
								type: "result",
								id: cmdId,
								data: { success: true, email: result.email },
							});
							send({
								type: "event",
								event: { kind: "oauth_completed", provider: "google", email: result.email },
							});
						} catch (err: unknown) {
							const errMsg = err instanceof Error ? err.message : String(err);
							const cancelled = err instanceof Error && err.name === "AbortError";
							log("Google consent %s: %s", cancelled ? "cancelled" : "failed", errMsg);
							// Release the abort controller slot so re-connect works.
							if (googleConsentAbort === ac) googleConsentAbort = null;
							send({
								type: "result",
								id: cmdId,
								data: { success: false, cancelled, error: errMsg },
							});
							send({
								type: "event",
								event: {
									kind: cancelled ? "oauth_cancelled" : "oauth_failed",
									provider: "google",
									error: cancelled ? undefined : errMsg,
								},
							});
						}
						void 0; // no return value expected
					})();
					break;
				}

				// ── get_google_status (B2 #186) ───────────────────────────────
				case "get_google_status": {
					try {
						const paths = defaultGooglePaths();
						const status = googleStatus(paths);
						log("Google status: connected=%s email=%s", status.connected, status.email ?? "-");
						send({ type: "result", id: cmd.id, data: status });
					} catch (err: unknown) {
						const errMsg = err instanceof Error ? err.message : String(err);
						log("get_google_status error: %s", errMsg);
						send({
							type: "error",
							id: cmd.id,
							message: `Failed to check Google status: ${errMsg}`,
						});
					}
					break;
				}

				// ── disconnect_google (B2 #186) ────────────────────────────
				case "disconnect_google": {
					try {
						const paths = defaultGooglePaths();
						const result = await disconnectGoogle(paths);
						log("Google disconnected: revoked=%s removed=%s", result.revoked, result.removed.join(", "));
						send({ type: "result", id: cmd.id, data: result });
					} catch (err: unknown) {
						const errMsg = err instanceof Error ? err.message : String(err);
						log("disconnect_google error: %s", errMsg);
						send({
							type: "error",
							id: cmd.id,
							message: `Failed to disconnect Google: ${errMsg}`,
						});
					}
					break;
				}

				// ── reload ─────────────────────────────────────────────────
				case "reload": {
					await initAgent(zosmaDir);
					send({ type: "result", id: cmd.id, data: { success: true } });
					break;
				}

				// ── new_session ────────────────────────────────────────────
				case "new_session": {
					// Reset the in-memory session for a fresh start
					if (session) {
						session.abort();
					}
					if (!authStorage || !modelRegistry || !settingsManager || !resourceLoader) {
						send({ type: "error", id: cmd.id, error: "Agent not initialized" });
						break;
					}
					// If the UI passed a folder, switch the workspace. A changed cwd
					// also rebinds the resource loader so a `.agents/` folder inside
					// the chosen project is discovered (pi's "open from any folder").
					// Same folder → reuse the cached loader (avoids a disk re-scan).
					const requestedCwd = resolveWorkspace(cmd.cwd);
					if (requestedCwd !== workspaceCwd) {
						workspaceCwd = requestedCwd;
						log("new_session: workspace → %s", workspaceCwd);
						resourceLoader = await buildResourceLoader(workspaceCwd);
					}
					const newSessionManager = SessionManager.inMemory(workspaceCwd);
					const result = await createAgentSession({
						cwd: workspaceCwd,
						authStorage,
						modelRegistry,
						sessionManager: newSessionManager,
						settingsManager,
						resourceLoader,
					});
					session = result.session;
					sessionManager = newSessionManager;

					// Re-subscribe to events
					session.subscribe((event) => {
						send({ type: "event", event });
					});

					// Re-bind the extension UI bridge for the new session.
					await bindExtensionUi(result.session);

					send({
						type: "result",
						id: cmd.id,
						data: { success: true, cwd: workspaceCwd },
					});
					break;
				}

				// ── get_workspace ──────────────────────────────────────────
				case "get_workspace": {
					send({
						type: "result",
						id: cmd.id,
						data: { cwd: workspaceCwd, default: defaultWorkspaceDir() },
					});
					break;
				}

				// ── list_sessions ──────────────────────────────────────────
				case "list_sessions": {
					const sessions = listSessionFiles(zosmaDir);
					send({
						type: "result",
						id: cmd.id,
						data: { sessions },
					});
					break;
				}

				// ── save_session ───────────────────────────────────────────
				case "save_session": {
					saveSession(
						zosmaDir,
						cmd.id,
						cmd.title || "Chat",
						cmd.messages || [],
						cmd.model,
						cmd.provider,
						// Stamp the active workspace so resume restores this folder.
						workspaceCwd,
					);
					send({ type: "done", id: cmd.id });
					break;
				}

				// ── load_session ───────────────────────────────────────────
				case "load_session": {
					try {
						const messages = loadSessionMessages(zosmaDir, cmd.sessionFile);
						// Also read the header for metadata
						const filePath = join(sessionsDir(zosmaDir), cmd.sessionFile);
						const content = readFileSync(filePath, "utf-8");
						const header = JSON.parse(content.trim().split("\n")[0]);

						// Resume semantics (like pi's /resume): reload the pi session
						// so newly added extensions/skills/prompts are picked up
						// without restarting the app, then continue the saved
						// conversation inside the reloaded session.
						//
						// Extensions/skills are bound at session-creation time, so the
						// currently-active session can't see resources added after it
						// was built. We re-scan the loader and rebuild the session.
						// Unlike the `reload` command we do NOT call initAgent(): that
						// re-emits `ready` and would reset the frontend model selection.
						if (authStorage && modelRegistry && settingsManager && resourceLoader) {
							// 0. Restore the workspace this conversation ran in. Legacy
							//    sessions have no saved cwd → resolveWorkspace(undefined)
							//    falls back to the default (home).
							const sessionCwd = resolveWorkspace(
								typeof header.cwd === "string" ? header.cwd : undefined,
							);
							if (sessionCwd !== workspaceCwd) {
								// Folder changed: rebuild the loader bound to the restored
								// cwd (this also re-scans disk for new extensions/skills).
								workspaceCwd = sessionCwd;
								log("load_session: workspace → %s", workspaceCwd);
								resourceLoader = await buildResourceLoader(workspaceCwd);
							} else {
								// Same folder: just re-scan for newly added resources.
								await resourceLoader.reload();
							}
							// Rebuild the session from the (re)loaded loader.
							if (session) {
								session.abort();
							}
							const resumedSessionManager =
								SessionManager.inMemory(workspaceCwd);
							const resumed = await createAgentSession({
								cwd: workspaceCwd,
								authStorage,
								modelRegistry,
								sessionManager: resumedSessionManager,
								settingsManager,
								resourceLoader,
							});
							session = resumed.session;
							sessionManager = resumedSessionManager;
							// Re-subscribe so the rebuilt session's events reach stdout.
							session.subscribe((event) => {
								send({ type: "event", event });
							});

							// Re-bind the extension UI bridge for the resumed session.
							await bindExtensionUi(resumed.session);
						}

						// 3. Restore the saved conversation into the reloaded session.
						if (session && Array.isArray(messages) && messages.length > 0) {
							restoreSessionContext(session, messages);
						}

						send({
							type: "result",
							id: cmd.id,
							data: {
								messages,
								title: header.title || "",
								model: header.model,
								provider: header.provider,
								cwd: workspaceCwd,
							},
						});
					} catch (err) {
						send({
							type: "error",
							id: cmd.id,
							message: err instanceof Error ? err.message : String(err),
						});
					}
					break;
				}

				// ── delete_session ─────────────────────────────────────────
				case "delete_session": {
					const deleted = deleteSessionFile(zosmaDir, cmd.sessionFile);
					send({
						type: "result",
						id: cmd.id,
						data: { deleted },
					});
					break;
				}

				// ── get_settings ───────────────────────────────────────────
				case "get_settings": {
					try {
						const settings = loadSettings(zosmaDir);
						send({
							type: "result",
							id: cmd.id,
							data: { settings },
						});
					} catch (err) {
						send({
							type: "error",
							id: cmd.id,
							message: err instanceof Error ? err.message : String(err),
						});
					}
					break;
				}

				// ── save_settings ───────────────────────────────────────────
				case "save_settings": {
					try {
						const { id: _sid, type: _t, ...rest } = cmd as Record<string, unknown>;
						saveSettings(zosmaDir, rest as Record<string, unknown>);
						send({ type: "result", id: cmd.id, data: { success: true } });
					} catch (err) {
						send({
							type: "error",
							id: cmd.id,
							message: err instanceof Error ? err.message : String(err),
						});
					}
					break;
				}

				// ── list_extensions ─────────────────────────────────────────
				case "list_extensions": {
					const extensions = discoverExtensions(zosmaDir);
					send({ type: "result", id: cmd.id, data: { extensions } });
					break;
				}

				// ── install_extension ───────────────────────────────────────
				case "install_extension": {
					const ext = installExtension(zosmaDir, cmd.source, cmd.ref);
					send({ type: "result", id: cmd.id, data: { extension: ext } });
					break;
				}

				// ── uninstall_extension ─────────────────────────────────────
				case "uninstall_extension": {
					uninstallExtension(zosmaDir, cmd.extensionId);
					send({ type: "result", id: cmd.id, data: { success: true } });
					break;
				}

				// ── set_extension_enabled ───────────────────────────────────
				case "set_extension_enabled": {
					setExtensionEnabled(zosmaDir, cmd.extensionId, cmd.enabled);
					send({ type: "result", id: cmd.id, data: { success: true } });
					break;
				}

				// ── set_extension_config ────────────────────────────────────
				case "set_extension_config": {
					setExtensionConfig(zosmaDir, cmd.extensionId, cmd.config);
					send({ type: "result", id: cmd.id, data: { success: true } });
					break;
				}

				// ── get_extension_config_file ───────────────────────────────
				// Read a whitelisted extension's OWN config file (e.g.
				// pi-messenger-bridge → ~/.pi/msg-bridge.json), so Cowork can
				// offer a bespoke setup screen for it.
				case "get_extension_config_file": {
					const path = resolveWhitelistedConfigPath(cmd.extensionId);
					if (!path) {
						send({
							type: "error",
							id: cmd.id,
							message: `Extension "${cmd.extensionId}" is not whitelisted for file-based config`,
						});
						break;
					}
					send({ type: "result", id: cmd.id, data: { config: readJsonFile(path), path } });
					break;
				}

				// ── save_extension_config_file ──────────────────────────────
				case "save_extension_config_file": {
					const path = resolveWhitelistedConfigPath(cmd.extensionId);
					if (!path) {
						send({
							type: "error",
							id: cmd.id,
							message: `Extension "${cmd.extensionId}" is not whitelisted for file-based config`,
						});
						break;
					}
					const config = writeWhitelistedConfig(path, cmd.patch ?? {});
					send({ type: "result", id: cmd.id, data: { config, path } });
					break;
				}

				// ── search_discover ─────────────────────────────────────────
				case "search_discover": {
					const results = await searchNpmRegistry(cmd.query || "pi extension");
					send({ type: "result", id: cmd.id, data: { packages: results } });
					break;
				}

				// ── skills: search ────────────────────────────────────────────
				case "search_skills": {
					const query = (cmd as unknown as Record<string, string>).query || "";
					if (!query.trim()) {
						send({ type: "result", id: cmd.id, data: { results: [] } });
						break;
					}
					try {
						const url = `https://skills.sh/api/search?q=${encodeURIComponent(query.trim())}&limit=20`;
						const controller = new AbortController();
						const timeout = setTimeout(() => controller.abort(), 15000);
						const res = await fetch(url, { signal: controller.signal });
						clearTimeout(timeout);
						if (!res.ok) {
							log("search_skills: API returned %d", res.status);
							send({ type: "result", id: cmd.id, data: { results: [] } });
							break;
						}
						const data = (await res.json()) as {
							skills: Array<{
								id: string;
								name: string;
								installs: number;
								source: string;
							}>;
						};
						const results = (data.skills || []).map((skill) => {
							// Construct a proper URL: skill.id is owner/repo/skill-name or owner/repo
							const path = skill.id || (skill.source ? `${skill.source}/${skill.name}` : skill.name);
							return {
								id: path,
								installCount: skill.installs || 0,
								url: `https://skills.sh/${path}`,
								npmData: null,
							};
						});
						send({ type: "result", id: cmd.id, data: { results } });
					} catch (err) {
						const message = err instanceof Error ? err.message : String(err);
						log("search_skills error: %s", message);
						send({ type: "result", id: cmd.id, data: { results: [] } });
					}
					break;
				}

				// ── skills: list installed ───────────────────────────────────
				case "list_skills": {
					try {
						// Cowork wraps pi, so surface the same skill dirs pi loads:
						// pi's global skills (~/.pi/agent/skills/), the shared agents
						// dir (~/.agents/skills/), and project-local (./.agents/skills/).
						// See #147.
						const skills: Array<{ name: string; path: string; scope: string; agents: string[] }> = [];
						const seen = new Set<string>();

						const piSkillsDir = join(homedir(), ".pi", "agent", "skills");
						const globalDir = join(homedir(), ".agents", "skills");
						const localDir = join(workspaceCwd, ".agents", "skills");

						for (const [scope, dir] of [
							["global", piSkillsDir],
							["global", globalDir],
							["project", localDir],
						] as const) {
							if (existsSync(dir)) {
								for (const entry of readdirSync(dir)) {
									const fullPath = join(dir, entry);
									if (entry.startsWith(".") || entry.startsWith("_") || entry === "node_modules") continue;
									if (seen.has(entry)) continue;
									seen.add(entry);
									skills.push({
										name: entry,
										path: fullPath,
										scope,
										agents: [],
									});
								}
							}
						}
						send({ type: "result", id: cmd.id, data: skills });
					} catch (err) {
						const message = err instanceof Error ? err.message : String(err);
						log("list_skills error: %s", message);
						send({ type: "result", id: cmd.id, data: [] });
					}
					break;
				}

				// ── start_remote (HTTP/WS remote access server) ────────────────
				case "start_remote": {
					const rc = cmd as StartRemoteCommand;
					try {
						const port = rc.port || 8765;
						const host = rc.host || "127.0.0.1";
						startRemoteServer(zosmaDir, { port, host });
						send({ type: "result", id: rc.id, data: { port, host, running: true } });
					} catch (err) {
						const message = err instanceof Error ? err.message : String(err);
						log("start_remote error: %s", message);
						send({ type: "error", id: rc.id, message });
					}
					break;
				}

				// ── stop_remote ────────────────────────────────────────────────
				case "stop_remote": {
					const rc = cmd as StopRemoteCommand;
					try {
						stopRemoteServer();
						send({ type: "result", id: rc.id, data: { running: false } });
					} catch (err) {
						const message = err instanceof Error ? err.message : String(err);
						log("stop_remote error: %s", message);
						send({ type: "error", id: rc.id, message });
					}
					break;
				}

				// ── get_remote_status ────────────────────────────────────────────
				case "get_remote_status": {
					const { getRemoteStatus } = await import("./remote-server.js");
					try {
						const status = getRemoteStatus();
						send({ type: "result", id: cmd.id, data: status });
					} catch {
						send({ type: "result", id: cmd.id, data: { running: false } });
					}
					break;
				}

				// Skill install/remove handled directly in Rust (lib.rs) — no npx needed.
				// case "install_skill" and case "remove_skill" removed from sidecar.

				default:
					send({
						type: "error",
						id: "unknown",
						message: `Unknown command: ${(cmd as Command).type}`,
					});
			}
	}

	// ── Remote command queue processor ────────────────────────────────
	// The remote server (HTTP/WebSocket) enqueues commands into commandQueue
	// when mobile users send prompts. These must be processed independently
	// of stdin activity — the main loop below only drains the queue after
	// each stdin line, which means queued commands never fire if the Tauri
	// backend stays idle. This interval polls the queue every 100ms so
	// remote commands always get dispatched promptly.
	let queueCheckHandle: ReturnType<typeof setInterval> | null = null;
	function startQueueProcessor() {
		if (queueCheckHandle) return;
		queueCheckHandle = setInterval(() => {
			while (commandQueue.hasPending()) {
				const qCmd = commandQueue.dequeue()!;
				handleCommand(qCmd as Command).catch((err: unknown) => {
					const msg = err instanceof Error ? err.message : String(err);
					log("Queue processor error: %s", msg);
					send({
						type: "error",
						id: qCmd.id || "unknown",
						message: msg,
					});
				});
			}
		}, 100);
	}

	startQueueProcessor();

	// Process stdin commands
	const rl = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });

	for await (const line of rl) {
		if (!line.trim()) continue;

		let cmd: Command;
		try {
			cmd = JSON.parse(line);
		} catch {
			log("Invalid JSON: %s", line.slice(0, 100));
			continue;
		}

		try {
			await handleCommand(cmd);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			log("Error: %s", message);
			send({
				type: "error",
				id: "id" in cmd ? cmd.id : "unknown",
				message,
			});
			if (activePromptId) {
				send({ type: "done", id: activePromptId });
				activePromptId = null;
			}
		}

		// Process any commands queued by the remote server (HTTP/WebSocket)
		while (commandQueue.hasPending()) {
			const qCmd = commandQueue.dequeue()!;
			try {
				await handleCommand(qCmd as Command);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				log("Queue error: %s", message);
				send({
					type: "error",
					id: qCmd.id || "unknown",
					message,
				});
			}
		}
	}

	log("Sidecar shutting down (stdin closed)");
	if (queueCheckHandle) clearInterval(queueCheckHandle);
	process.exit(0);
}

main().catch((err) => {
	log("Fatal: %s", err instanceof Error ? err.message : String(err));
	process.exit(1);
});
