/**
 * Graceful shutdown wiring.
 *
 * Registers handlers for SIGINT + SIGTERM. On signal the daemon stops accepting
 * new work, stops its server, and exits cleanly (default 0). The passed
 * `shutdown` runs first and may reject, which forces a non-zero exit.
 */
export interface ShutdownOptions {
  signals?: NodeJS.Signals[];
  /** flush/handle remaining work before the process exits */
  onShutdown?: () => void | Promise<void>;
  exit?: (code: number) => void;
  logger?: {
    info(msg: string, fields?: Record<string, unknown>): void;
    warn(msg: string, fields?: Record<string, unknown>): void;
    error(msg: string, fields?: Record<string, unknown>): void;
  };
}

export function createShutdown(options: ShutdownOptions = {}) {
  const signals = options.signals ?? ["SIGINT", "SIGTERM"];
  const exit = options.exit ?? ((code) => process.exit(code));
  let active = false;

  const handler = async (signal: NodeJS.Signals): Promise<void> => {
    if (active) return;
    active = true;
    options.logger?.info("shutdown requested", { signal });
    try {
      if (options.onShutdown) await options.onShutdown();
      exit(0);
    } catch (err) {
      options.logger?.error("shutdown failed", { detail: String(err) });
      exit(1);
    }
  };

  function register(): void {
    for (const s of signals) process.on(s, () => void handler(s));
  }
  function unregister(): void {
    for (const s of signals) process.off(s, () => void handler(s));
  }

  return { register, unregister };
}
