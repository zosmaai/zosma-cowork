/**
 * Stable, typed protocol errors.
 *
 * Every validation failure is a `ProtocolError` carrying a fixed `code` so a
 * client can branch on it deterministically instead of parsing a message.
 * Errors are safe to serialize and send across the wire (see `toWire`).
 */

export type ProtocolErrorCode =
  | "invalid_protocol_version"
  | "unsupported_version"
  | "unknown_command"
  | "missing_field"
  | "invalid_field"
  | "unknown_type";

export const PROTOCOL_ERROR_CODES = [
  "invalid_protocol_version",
  "unsupported_version",
  "unknown_command",
  "missing_field",
  "invalid_field",
  "unknown_type",
] as const satisfies readonly ProtocolErrorCode[];

export class ProtocolError extends Error {
  readonly code: ProtocolErrorCode;
  readonly details: unknown;

  constructor(
    code: ProtocolErrorCode,
    message: string,
    details?: unknown,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProtocolError";
    this.code = code;
    this.details = details;
  }

  /** Transport-neutral, JSON-safe form for sending to a client. */
  toWire(): ProtocolErrorWire {
    const out: ProtocolErrorWire = { code: this.code, message: this.message };
    if (this.details !== undefined) out.details = this.details;
    return out;
  }
}

export interface ProtocolErrorWire {
  code: ProtocolErrorCode;
  message: string;
  details?: unknown;
}

export function isProtocolError(error: unknown): error is ProtocolError {
  return error instanceof ProtocolError;
}

export function missingField(path: string): ProtocolError {
  return new ProtocolError("missing_field", `missing field "${path}"`);
}

export function invalidField(path: string, expected: string): ProtocolError {
  return new ProtocolError("invalid_field", `field "${path}" is not ${expected}`, { expected });
}

export function invalidProtocolVersion(expected: number, got: unknown): ProtocolError {
  return new ProtocolError(
    "unsupported_version",
    `protocol version ${JSON.stringify(got)} is not supported (allowed: ${expected})`,
    { got, expected },
  );
}

export function unknownType(expectedType: string, found: unknown): ProtocolError {
  return new ProtocolError(
    "unknown_type",
    `unknown message type "${expectedType}" (got ${JSON.stringify(found)})`,
    { expectedType, found },
  );
}

export function unknownCommand(type: string): ProtocolError {
  return new ProtocolError("unknown_command", `unknown command "${type}"`);
}
