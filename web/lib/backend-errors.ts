import type { BackendErrorCode } from "./api-contracts.ts";

export type { BackendErrorCode } from "./api-contracts.ts";

export const BACKEND_ERROR_CODES = [
  "invalid_request",
  "cwd_required",
  "access_denied",
  "session_not_found",
  "session_not_running",
  "session_busy",
  "prompt_rejected",
  "model_not_found",
  "entry_not_found",
  "thinking_block_not_found",
  "startup_failed",
  "skill_not_found",
  "skill_install_failed",
  "skill_update_failed",
  "skill_check_failed",
  "skill_search_failed",
  "plugin_action_failed",
  "internal_error",
] as const satisfies readonly BackendErrorCode[];

export class BackendError extends Error {
  readonly code: BackendErrorCode;
  readonly details: unknown;

  constructor(
    code: BackendErrorCode,
    message: string,
    details?: unknown,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BackendError";
    this.code = code;
    this.details = details;
  }
}

export function isBackendError(error: unknown): error is BackendError {
  return error instanceof BackendError;
}

// /api/v1 documented status mapping (design spec: "Routes map errors
// consistently"): 400 invalid, 403 denied, 404 session/model/entry/block not
// found, 409 busy/invalid runtime, 500 unexpected. Pure module — importable
// from the daemon relay (lib/daemon-client) without pulling in next/server.
export const STATUS_BY_CODE: Record<BackendErrorCode, number> = {
  invalid_request: 400,
  cwd_required: 400,
  access_denied: 403,
  session_not_found: 404,
  model_not_found: 404,
  entry_not_found: 404,
  thinking_block_not_found: 404,
  skill_not_found: 404,
  session_not_running: 409,
  session_busy: 409,
  prompt_rejected: 409, // reachable only via Phase 5 command routes; maps to "busy or invalid runtime state"
  startup_failed: 500,
  skill_install_failed: 500,
  skill_update_failed: 500,
  skill_check_failed: 500,
  skill_search_failed: 500,
  plugin_action_failed: 500,
  internal_error: 500,
};
