import { NextResponse } from "next/server";
import { isBackendError } from "@/packages/pi-backend/errors";
import type { BackendErrorCode } from "@/packages/pi-backend/contracts";

// /api/v1 documented status mapping (design spec: "Routes map errors
// consistently"): 400 invalid, 403 denied, 404 session/model/entry/block not
// found, 409 busy/invalid runtime, 500 unexpected.
export const STATUS_BY_CODE: Record<BackendErrorCode, number> = {
  invalid_request: 400,
  access_denied: 403,
  session_not_found: 404,
  model_not_found: 404,
  entry_not_found: 404,
  thinking_block_not_found: 404,
  session_not_running: 409,
  session_busy: 409,
  prompt_rejected: 409, // reachable only via Phase 5 command routes; maps to "busy or invalid runtime state"
  startup_failed: 500,
  internal_error: 500,
};

export function backendErrorResponse(error: unknown): NextResponse | null {
  if (!isBackendError(error)) return null;
  return NextResponse.json(
    { error: error.message },
    { status: STATUS_BY_CODE[error.code] ?? 500 },
  );
}