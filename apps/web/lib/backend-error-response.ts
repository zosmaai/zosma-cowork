import { NextResponse } from "next/server";
import { isBackendError, STATUS_BY_CODE } from "./backend-errors.ts";

export { STATUS_BY_CODE };

export function backendErrorResponse(error: unknown): NextResponse | null {
  if (!isBackendError(error)) return null;
  return NextResponse.json(
    { error: error.message },
    { status: STATUS_BY_CODE[error.code] ?? 500 },
  );
}