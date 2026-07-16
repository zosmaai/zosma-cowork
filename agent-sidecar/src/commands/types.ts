/**
 * Zosma Content CoWork — Sidecar Command Types
 *
 * All stdin command type interfaces for the JSON-line protocol between the
 * Tauri Rust backend and the Node.js agent sidecar.
 */

// ── Core commands ──────────────────────────────────────────────────────────

export interface InitCommand {
	type: "init";
	zosmaDir?: string;
	workspace?: string;
}

export interface GetModelsCommand {
	type: "get_models";
	id: string;
}

export interface GetActiveModelCommand {
	type: "get_active_model";
	id: string;
}

export interface PromptCommand {
	type: "prompt";
	id: string;
	text: string;
	_origin?: "remote";
}

export interface AbortCommand {
	type: "abort";
	id: string;
}

export interface SteerCommand {
	type: "steer";
	id: string;
	text: string;
	images?: SteerImage[];
}

export interface FollowUpCommand {
	type: "follow_up";
	id: string;
	text: string;
	images?: SteerImage[];
}

export interface ClearQueueCommand {
	type: "clear_queue";
	id: string;
}

export type SteerImage = import("../steering.js").ImageAttachment;

export interface SetModelCommand {
	type: "set_model";
	id: string;
	provider: string;
	model: string;
}

// ── Auth commands ──────────────────────────────────────────────────────────

export interface SaveAuthCommand {
	type: "save_auth";
	id: string;
	provider: string;
	key: string;
}

export interface ValidateProviderKeyCommand {
	type: "validate_provider_key";
	id: string;
	provider: string;
	key: string;
}

export interface StartOAuthCommand {
	type: "start_oauth";
	id: string;
	provider: string;
}

export interface CancelOAuthCommand {
	type: "cancel_oauth";
	id: string;
}

export interface LogoutCommand {
	type: "logout";
	id: string;
	provider: string;
}

export interface GetAuthStatusCommand {
	type: "get_auth_status";
	id: string;
}

// ── Custom provider commands (issue #207) ──────────────────────────────────

export interface ListCustomProvidersCommand {
	type: "list_custom_providers";
	id: string;
}

export interface SaveCustomProviderCommand {
	type: "save_custom_provider";
	id: string;
	provider: import("../custom-providers.js").SaveCustomProviderInput;
}

export interface DeleteCustomProviderCommand {
	type: "delete_custom_provider";
	id: string;
	providerId: string;
}

export interface TestCustomProviderConnectionCommand {
	type: "test_custom_provider_connection";
	id: string;
	baseUrl: string;
	apiKey?: string;
}

// ── Google commands ────────────────────────────────────────────────────────

export interface ConnectGoogleCommand {
	type: "connect_google";
	id: string;
	prefs?: import("../google-auth/scopes.js").ScopePrefs;
	byo?: { clientId: string; clientSecret: string } | null;
}

export interface GetGoogleStatusCommand {
	type: "get_google_status";
	id: string;
}

export interface DisconnectGoogleCommand {
	type: "disconnect_google";
	id: string;
}

export interface GetGooglePrefsCommand {
	type: "get_google_prefs";
	id: string;
}

export interface SaveGooglePrefsCommand {
	type: "save_google_prefs";
	id: string;
	prefs?: import("../google-auth/scopes.js").ScopePrefs;
	byo?: { clientId: string; clientSecret: string } | null;
}

export interface GetGoogleAppStatusCommand {
	type: "get_google_app_status";
	id: string;
	prefs?: import("../google-auth/scopes.js").ScopePrefs;
}

export interface InstallGoogleAppCommand {
	type: "install_google_app";
	id: string;
	prefs?: import("../google-auth/scopes.js").ScopePrefs;
}

// ── GitHub App commands ────────────────────────────────────────────────────

export interface GhAuthStatusCommand {
	type: "gh_auth_status";
	id: string;
}

export interface GhOrganizationsCommand {
	type: "gh_organizations";
	id: string;
}

export interface GhAuthLoginCommand {
	type: "gh_auth_login";
	id: string;
	scopes?: string;
}

export interface GhAuthCancelCommand {
	type: "gh_auth_cancel";
	id: string;
}

export interface GhAuthLogoutCommand {
	type: "gh_auth_logout";
	id: string;
}

// ── Session commands ───────────────────────────────────────────────────────

export interface ReloadCommand {
	type: "reload";
	id: string;
}

export interface NewSessionCommand {
	type: "new_session";
	id: string;
	cwd?: string;
}

export interface GetWorkspaceCommand {
	type: "get_workspace";
	id: string;
}

export interface ListSessionsCommand {
	type: "list_sessions";
	id: string;
}

export interface SaveSessionCommand {
	type: "save_session";
	id: string;
	title: string;
	messages: unknown[];
	model?: string;
	provider?: string;
}

export interface LoadSessionCommand {
	type: "load_session";
	id: string;
	sessionFile: string;
}

export interface DeleteSessionCommand {
	type: "delete_session";
	id: string;
	sessionFile: string;
}

export interface RenameSessionCommand {
	type: "rename_session";
	id: string;
	sessionFile: string;
	title: string;
}

export interface SetSessionPinnedCommand {
	type: "set_session_pinned";
	id: string;
	sessionFile: string;
	pinned: boolean;
}

export interface SearchSessionsCommand {
	type: "search_sessions";
	id: string;
	query: string;
}

// ── Settings / Instructions commands ───────────────────────────────────────

export interface GetSettingsCommand {
	type: "get_settings";
	id: string;
}

export interface SaveSettingsCommand {
	type: "save_settings";
	id: string;
	[key: string]: unknown;
}

export interface GetInstructionsCommand {
	type: "get_instructions";
	id: string;
}

export interface SaveInstructionsCommand {
	type: "save_instructions";
	id: string;
	content: string;
}

// ── Extension commands ─────────────────────────────────────────────────────

export interface ListExtensionsCommand {
	type: "list_extensions";
	id: string;
}

// ── Skills commands ────────────────────────────────────────────────────────

export interface SearchSkillsCommand {
	type: "search_skills";
	id: string;
	query: string;
}

export interface ListSkillsCommand {
	type: "list_skills";
	id: string;
}

export interface FetchSkillPackumentCommand {
	type: "fetch_skill_packument";
	id: string;
	packageName: string;
}

// ── Tasks commands ─────────────────────────────────────────────────────────

export interface TasksListCommand {
	type: "tasks_list";
	id: string;
	cwd?: string;
}

export interface TasksDeleteCommand {
	type: "tasks_delete";
	id: string;
	taskId: string;
	cwd?: string;
}

export interface TasksSetEnabledCommand {
	type: "tasks_set_enabled";
	id: string;
	taskId: string;
	enabled: boolean;
	cwd?: string;
}

export interface TasksRunNowCommand {
	type: "tasks_run_now";
	id: string;
	taskId: string;
	cwd?: string;
}

export interface TasksListRunsCommand {
	type: "tasks_list_runs";
	id: string;
	taskId: string;
	cwd?: string;
	limit?: number;
}

export interface TasksGetCompletedCommand {
	type: "tasks_get_completed";
	id: string;
	cwd?: string;
}

// ── Remote / UI commands ───────────────────────────────────────────────────

export interface StartRemoteCommand {
	type: "start_remote";
	id: string;
	port?: number;
	host?: string;
}

export interface StopRemoteCommand {
	type: "stop_remote";
	id: string;
}

export interface GetRemoteStatusCommand {
	type: "get_remote_status";
	id: string;
}

export interface UiResponseCommand {
	type: "ui_response";
	id: string;
	value?: string;
	confirmed?: boolean;
	cancelled?: boolean;
}

// ── Union type ─────────────────────────────────────────────────────────────

export type Command =
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
	| ValidateProviderKeyCommand
	| StartOAuthCommand
	| CancelOAuthCommand
	| LogoutCommand
	| GetAuthStatusCommand
	| ListCustomProvidersCommand
	| SaveCustomProviderCommand
	| DeleteCustomProviderCommand
	| TestCustomProviderConnectionCommand
	| ConnectGoogleCommand
	| GetGoogleStatusCommand
	| DisconnectGoogleCommand
	| GetGooglePrefsCommand
	| SaveGooglePrefsCommand
	| GetGoogleAppStatusCommand
	| InstallGoogleAppCommand
	| ReloadCommand
	| SaveSessionCommand
	| LoadSessionCommand
	| DeleteSessionCommand
	| RenameSessionCommand
	| SetSessionPinnedCommand
	| SearchSessionsCommand
	| NewSessionCommand
	| GetWorkspaceCommand
	| ListSessionsCommand
	| GetSettingsCommand
	| SaveSettingsCommand
	| GetInstructionsCommand
	| SaveInstructionsCommand
	| ListExtensionsCommand
	| TasksListCommand
	| TasksDeleteCommand
	| TasksSetEnabledCommand
	| TasksRunNowCommand
	| TasksListRunsCommand
	| TasksGetCompletedCommand
	| SearchSkillsCommand
	| ListSkillsCommand
	| FetchSkillPackumentCommand
	| StartRemoteCommand
	| StopRemoteCommand
	| GetRemoteStatusCommand
	| UiResponseCommand
	| GhAuthStatusCommand
	| GhOrganizationsCommand
	| GhAuthLoginCommand
	| GhAuthCancelCommand
	| GhAuthLogoutCommand;
