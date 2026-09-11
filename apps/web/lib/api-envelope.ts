import { NextResponse } from "next/server";
import { isBackendError } from "./backend-errors.ts";
import { STATUS_BY_CODE } from "./backend-error-response";

export function apiSuccess<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ data }, init);
}

export function apiErrorResponse(error: unknown): NextResponse {
  if (isBackendError(error)) {
    const body = {
      code: error.code,
      message: error.message,
      ...(error.details !== undefined ? { details: error.details } : {}),
    };
    return NextResponse.json(
      { error: body },
      { status: STATUS_BY_CODE[error.code] ?? 500 },
    );
  }
  return NextResponse.json(
    {
      error: {
        code: "internal_error",
        message: error instanceof Error ? error.message : String(error),
      },
    },
    { status: 500 },
  );
}