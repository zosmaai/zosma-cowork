/**
 * Session command handlers — backed by the SessionRuntimeManager. Each loaded
 * or created session is an isolated runtime; new_session/load_session return a
 * full snapshot (messages, queue, status, structured error) so the frontend
 * hydrates the active reducer in one shot.
 *
 * Commands: reload, new_session, get_workspace, list_sessions, save_session
 * (no-op — pi auto-persists), load_session, delete_session, rename_session,
 * set_session_pinned, search_sessions.
 */

import { send, log } from "../../protocol.js";
import { makeSessionDone, makeSessionError, makeSessionResult } from "../../session-protocol.js";
import {
	snapshotRuntime,
	SessionRuntimeError,
	type SessionRuntime,
} from "../../session-runtime-manager.js";
import type { HandlerDependencies } from "../handler-registry.js";
import type { DeleteSessionCommand, SetSessionModeCommand } from "../types.js";
import { resolveWorkspace, defaultWorkspaceDir, piAgentDir } from "../../agent-init.js";
import {
	getPiSessionMode,
	listPiSessions,
	deletePiSession,
	renamePiSession,
	setPiSessionMode,
	setPiSessionPinned,
	searchPiSessions,
} from "../../pi-session-store.js";

export async function handleReload(deps: HandlerDependencies, cmd: any): Promise<void> {
	await deps.initAgent(deps.zosmaDir);
	send({ type: "result", id: cmd.id, data: { success: true } });
}

export async function handleNewSession(deps: HandlerDependencies, cmd: any): Promise<void> {
	if (!deps.authStorage || !deps.modelRegistry || !deps.settingsManager) {
		send(makeSessionError(cmd.id, cmd.sessionFile ?? "", {
			code: "session_not_loaded",
			message: "Agent not initialized",
			retryable: false,
		}));
		return;
	}
	const requestedCwd = resolveWorkspace(cmd.cwd, deps.zosmaDir);
	try {
		const runtime = await deps.runtimeManager.create(requestedCwd);
		log("new_session: workspace → %s (%s)", runtime.cwd, runtime.sessionFile);
		send(makeSessionResult(cmd.id, runtime.sessionFile, snapshotRuntime(runtime)));
	} catch (err) {
		log("new_session failed: %s", err instanceof Error ? err.message : String(err));
		send(makeSessionError(cmd.id, cmd.sessionFile ?? "", {
			code: "session_load_failed",
			message: err instanceof Error ? err.message : String(err),
			retryable: true,
		}));
	}
}

export async function handleGetWorkspace(deps: HandlerDependencies, cmd: any): Promise<void> {
	try {
		const runtime = deps.runtimeManager.require(cmd.sessionFile);
		send(makeSessionResult(cmd.id, cmd.sessionFile, {
			cwd: runtime.cwd,
			default: defaultWorkspaceDir(deps.zosmaDir),
		}));
	} catch (err) {
		send(makeSessionError(cmd.id, cmd.sessionFile, {
			code: "session_not_loaded",
			message: err instanceof Error ? err.message : String(err),
			retryable: true,
		}));
	}
}

export async function handleListSessions(deps: HandlerDependencies, cmd: any): Promise<void> {
	// Scope to the requested workspace folder (pi-style) unless allFolders.
	const cwd = cmd.allFolders ? undefined : cmd.cwd;
	const sessions = await listPiSessions(piAgentDir(), cwd);
	send({ type: "result", id: cmd.id, data: { sessions } });
}

/** No-op: pi persists sessions during the agent loop. Kept for protocol compat. */
export async function handleSaveSession(_deps: HandlerDependencies, cmd: any): Promise<void> {
	send({ type: "done", id: cmd.id });
}

export async function handleLoadSession(deps: HandlerDependencies, cmd: any): Promise<void> {
	try {
		const runtime = await deps.runtimeManager.load(cmd.sessionFile);
		log("load_session: runtime ready for %s", runtime.sessionFile);
		const mode = getPiSessionMode(piAgentDir(), runtime.sessionFile);
		send(makeSessionResult(cmd.id, runtime.sessionFile, snapshotRuntime(runtime, mode)));
	} catch (err) {
		log(
			"load_session failed for %s: %s",
			cmd.sessionFile,
			err instanceof Error ? err.message : String(err),
		);
		send(makeSessionError(cmd.id, cmd.sessionFile, {
			code: "session_load_failed",
			message: err instanceof Error ? err.message : String(err),
			retryable: true,
		}));
	}
}

export async function handleDeleteSession(
	deps: HandlerDependencies,
	cmd: DeleteSessionCommand,
): Promise<void> {
	const runtime = deps.runtimeManager.get(cmd.sessionFile);
	if (runtime && snapshotRuntime(runtime).isRunning) {
		// Trust-boundary protection: the frontend stops first, but a race or
		// direct command still cannot delete a running runtime.
		send(makeSessionError(cmd.id, cmd.sessionFile, {
			code: "session_busy",
			message: "Stop the running session before deleting it",
			retryable: true,
		}));
		return;
	}
	// Dispose the runtime first so its file handle is released before deletion.
	await deps.runtimeManager.dispose(cmd.sessionFile);
	const deleted = deletePiSession(piAgentDir(), cmd.sessionFile);
	send(makeSessionResult(cmd.id, cmd.sessionFile, { deleted }));
}

export async function handleRenameSession(_deps: HandlerDependencies, cmd: any): Promise<void> {
	const renamed = renamePiSession(piAgentDir(), cmd.sessionFile, cmd.title);
	send({ type: "result", id: cmd.id, data: { renamed } });
}

export async function handleSetSessionPinned(_deps: HandlerDependencies, cmd: any): Promise<void> {
	const ok = setPiSessionPinned(piAgentDir(), cmd.sessionFile, cmd.pinned);
	send({ type: "result", id: cmd.id, data: { ok, pinned: cmd.pinned } });
}

export async function handleSetSessionMode(
	deps: HandlerDependencies,
	cmd: SetSessionModeCommand,
): Promise<void> {
	if (cmd.mode !== "chat" && cmd.mode !== "work") {
		send(makeSessionError(cmd.id, cmd.sessionFile, {
			code: "invalid_session_mode",
			message: "Session mode must be chat or work",
			retryable: false,
		}));
		return;
	}

	let runtime: SessionRuntime;
	try {
		runtime = deps.runtimeManager.require(cmd.sessionFile);
	} catch (error) {
		const runtimeError = error as SessionRuntimeError;
		send(makeSessionError(cmd.id, cmd.sessionFile, {
			code: runtimeError.code ?? "session_not_loaded",
			message: runtimeError.message,
			retryable: runtimeError.retryable ?? true,
		}));
		return;
	}

	if (runtime.session.isStreaming || runtime.session.messages.length > 0) {
		send(makeSessionError(cmd.id, runtime.sessionFile, {
			code: "session_mode_locked",
			message: "Session mode is locked after the first prompt",
			retryable: false,
		}));
		return;
	}

	try {
		setPiSessionMode(piAgentDir(), runtime.sessionFile, cmd.mode);
		send(makeSessionResult(cmd.id, runtime.sessionFile, {
			success: true,
			mode: cmd.mode,
		}));
	} catch (error) {
		send(makeSessionError(cmd.id, runtime.sessionFile, {
			code: "session_metadata_failed",
			message: error instanceof Error ? error.message : String(error),
			retryable: true,
		}));
	}
}

export async function handleSearchSessions(deps: HandlerDependencies, cmd: any): Promise<void> {
	const cwd = cmd.allFolders ? undefined : cmd.cwd;
	const matches = await searchPiSessions(piAgentDir(), cmd.query, cwd);
	send({ type: "result", id: cmd.id, data: { matches } });
}