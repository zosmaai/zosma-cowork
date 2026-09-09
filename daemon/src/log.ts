/**
 * Structured logging for the daemon.
 *
 * JSON lines to stderr. Every field except the ones the daemon sets itself
 * (level, ts, msg) is run through a sanitizer so a caller passing a secret by
 * mistake never leaks it into logs.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogRecord {
  level: LogLevel;
  ts: string;
  msg: string;
  fields?: Record<string, unknown>;
}

const SECRET_KEYS = new Set([
  "token",
  "apikey",
  "api_key",
  "key",
  "secret",
  "password",
  "passwd",
  "authorization",
  "auth",
]);

const SECRET_SUFFIX = new Set(["token", "privatekey", "accesskey"]);

function isSecretKey(key: string): boolean {
  const k = key.toLowerCase();
  if (SECRET_KEYS.has(k)) return true;
  return SECRET_SUFFIX.has(k.replace(/[^a-z0-9]+/g, ""));
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSecretKey(k) ? "[REDACTED]" : sanitize(v);
    }
    return out;
  }
  return value;
}

export interface LoggerOptions {
  /** where the sink writes; default process.stderr */
  sink?: (line: string) => void;
  level?: LogLevel;
  fields?: Record<string, unknown>;
}

export class Logger {
  private readonly sink: (line: string) => void;
  private readonly levelPriority: Record<LogLevel, number>;
  private readonly minLevel: LogLevel;
  private readonly fields: Record<string, unknown>;

  constructor(options: LoggerOptions = {}) {
    this.sink = options.sink ?? ((line) => process.stderr.write(line + "\n"));
    this.levelPriority = { debug: 10, info: 20, warn: 30, error: 40 };
    this.minLevel = options.level ?? "info";
    this.fields = options.fields ?? {};
  }

  private emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
    if ((this.levelPriority[level] ?? 0) < this.levelPriority[this.minLevel]) return;
    const record: LogRecord = {
      level,
      ts: new Date().toISOString(),
      msg,
    };
    const merged: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(this.fields)) merged[k] = sanitize(v);
    for (const [k, v] of Object.entries(fields ?? {})) merged[k] = sanitize(v);
    if (Object.keys(merged).length > 0) record.fields = merged;
    this.sink(JSON.stringify(sanitize(record)));
  }

  debug(msg: string, fields?: Record<string, unknown>): void {
    this.emit("debug", msg, fields);
  }
  info(msg: string, fields?: Record<string, unknown>): void {
    this.emit("info", msg, fields);
  }
  warn(msg: string, fields?: Record<string, unknown>): void {
    this.emit("warn", msg, fields);
  }
  error(msg: string, fields?: Record<string, unknown>): void {
    this.emit("error", msg, fields);
  }
}

export function createLogger(options: LoggerOptions = {}): Logger {
  return new Logger(options);
}
