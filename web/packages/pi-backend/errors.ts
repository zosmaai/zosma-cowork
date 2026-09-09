import type { BackendErrorCode } from "./contracts";

export type { BackendErrorCode } from "./contracts";

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
