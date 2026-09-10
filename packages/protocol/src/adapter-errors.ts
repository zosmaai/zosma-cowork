/**
 * Adapter-error and unsupported-capability semantics.
 *
 * The transport uses the shared {@link ProtocolError}; the adapter layer keeps
 * its own precise codes on top, so a daemon can report "this harness does not
 * implement that" without hard-coding it into the generic error union. Precise
 * codes travel in {@link AdapterError} and are preserved when normalized.
 */
import { ProtocolError } from "./errors.ts";

/** Precise adapter-layer error codes. */
export type AdapterErrorCode =
  | "capability_unsupported"
  | "operation_not_supported"
  | "adapter_unavailable"
  | "adapter_error";

export const ADAPTER_ERROR_CODES: readonly AdapterErrorCode[] = [
  "capability_unsupported",
  "operation_not_supported",
  "adapter_unavailable",
  "adapter_error",
] as const satisfies readonly AdapterErrorCode[];

/** A transport-safe adapter-layer error envelope. */
export interface AdapterError {
  code: AdapterErrorCode;
  message: string;
  adapterId?: string;
  operation?: string;
  capabilities?: string[];
  details?: Record<string, unknown>;
}

const ADAPTER_CODE_KINDS: Readonly<Record<AdapterErrorCode, true>> = {
  capability_unsupported: true,
  operation_not_supported: true,
  adapter_unavailable: true,
  adapter_error: true,
};

/** Type guard for {@link AdapterError}. */
export function isAdapterError(err: unknown): err is AdapterError {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    ADAPTER_CODE_KINDS[(err as AdapterError).code] === true
  );
}

/**
 * Normalize an adapter error onto the transport's neutral ProtocolError. The
 * generic code is `unknown_command` — the request is one this harness does not
 * implement — while the precise adapter code travels in `details` so callers
 * can still branch on it deterministically.
 */
export function normalizeAdapterError(ae: AdapterError): ProtocolError {
  const details: Record<string, unknown> = { ...ae.details, adapterCode: ae.code };
  if (ae.adapterId !== undefined) details.adapterId = ae.adapterId;
  if (ae.operation !== undefined) details.operation = ae.operation;
  if (ae.capabilities !== undefined) details.capabilities = ae.capabilities;
  return new ProtocolError("unknown_command", ae.message, details);
}

export function unsupportedCapabilityError(
  adapterId: string,
  capability: string,
  operation: string,
): AdapterError {
  return {
    code: "capability_unsupported",
    message: `adapter "${adapterId}" does not support capability "${capability}" for operation "${operation}"`,
    adapterId,
    operation,
    capabilities: [capability],
  };
}

export function operationNotSupportedError(adapterId: string, operation: string): AdapterError {
  return {
    code: "operation_not_supported",
    message: `adapter "${adapterId}" does not implement operation "${operation}"`,
    adapterId,
    operation,
  };
}

export function adapterUnavailableError(adapterId: string, reason: string): AdapterError {
  return {
    code: "adapter_unavailable",
    message: `adapter "${adapterId}" is unavailable: ${reason}`,
    adapterId,
  };
}

export function adapterError(adapterId: string, operation: string, message: string): AdapterError {
  return { code: "adapter_error", message, adapterId, operation };
}
