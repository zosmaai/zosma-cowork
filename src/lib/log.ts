/**
 * Frontend logging — thin wrapper over console with a dev gate.
 *
 * `debug`/`log` are silenced in production builds (import.meta.env.DEV is false)
 * so verbose tracing never ships to users. `warn`/`error` always fire — they
 * surface real problems and Sentry (when configured) captures them.
 *
 * Calls delegate lazily (not bound at import) so console can be spied in tests.
 *
 * Usage: prefix messages with a `[scope]` tag, e.g. log.debug("[settings]", ...).
 */

const DEV = import.meta.env.DEV;

export const log = {
	/** Dev-only verbose trace (fired events, state transitions, sequence). */
	debug: (...args: unknown[]) => {
		if (DEV) console.log(...args);
	},
	/** Alias of debug — dev-only. */
	log: (...args: unknown[]) => {
		if (DEV) console.log(...args);
	},
	/** Always emitted — recoverable problems. */
	warn: (...args: unknown[]) => console.warn(...args),
	/** Always emitted — errors. */
	error: (...args: unknown[]) => console.error(...args),
};
