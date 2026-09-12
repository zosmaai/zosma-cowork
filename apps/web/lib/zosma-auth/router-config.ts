/**
 * Zosma Router base-URL configuration.
 *
 * Precedence: env vars > persisted file > built-in defaults.
 * Persisted file: `<piDir>/zosma-router-config.json` — same filename the old
 * sidecar used, so existing self-hosted-router configs keep working.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_AUTH_BASE_URL = "https://auth.zosma.ai";
export const DEFAULT_ROUTER_BASE_URL = "https://router.zosma.ai/v1";
export const ROUTER_CONFIG_FILE = "zosma-router-config.json";

export interface RouterConfig {
  authBaseUrl: string;
  routerBaseUrl: string;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function validateBaseUrl(name: string, value: string, pathname: string): string {
  if (!value.trim()) throw new Error(`${name} is not configured`);
  const normalized = value.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  const local = url.protocol === "http:" && isLoopbackHost(url.hostname);
  if (url.protocol !== "https:" && !local) {
    throw new Error(`${name} must use HTTPS (HTTP is allowed only for localhost development)`);
  }
  if (url.pathname !== pathname || url.search || url.hash || url.username || url.password) {
    throw new Error(`${name} must be a base URL with path ${pathname}`);
  }
  return url.toString().replace(/\/+$/, "");
}

export function validateRouterConfig(config: RouterConfig): RouterConfig {
  const auth = validateBaseUrl("authBaseUrl", config.authBaseUrl, "/");
  const router = validateBaseUrl("routerBaseUrl", config.routerBaseUrl, "/v1");
  const authUrl = new URL(auth);
  const routerUrl = new URL(router);
  if (authUrl.protocol !== routerUrl.protocol) {
    throw new Error("authBaseUrl and routerBaseUrl must use the same protocol");
  }
  if (
    authUrl.protocol === "http:" &&
    (!isLoopbackHost(authUrl.hostname) || !isLoopbackHost(routerUrl.hostname))
  ) {
    throw new Error("HTTP router configuration is allowed only for localhost development");
  }
  return { authBaseUrl: auth, routerBaseUrl: router };
}

export function routerConfigFilePath(piDir: string): string {
  return join(piDir, ROUTER_CONFIG_FILE);
}

export function loadPersistedRouterConfig(piDir: string): Partial<RouterConfig> {
  const file = routerConfigFilePath(piDir);
  if (!existsSync(file)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    throw new Error("persisted router configuration is invalid JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("persisted router configuration must be an object");
  }
  const obj = parsed as Record<string, unknown>;
  return {
    authBaseUrl: typeof obj.authBaseUrl === "string" ? obj.authBaseUrl : undefined,
    routerBaseUrl: typeof obj.routerBaseUrl === "string" ? obj.routerBaseUrl : undefined,
  };
}

export function saveRouterConfig(piDir: string, config: RouterConfig): RouterConfig {
  const validated = validateRouterConfig(config);
  const file = routerConfigFilePath(piDir);
  mkdirSync(piDir, { recursive: true });
  writeFileSync(file, JSON.stringify(validated, null, 2), "utf-8");
  chmodSync(file, 0o600);
  return validated;
}

/**
 * Resolve effective config: env > persisted file > built-in defaults.
 * Always returns a validated config or throws.
 */
export function resolveRouterConfig(
  piDir: string,
  env: NodeJS.ProcessEnv = process.env,
): RouterConfig {
  const persisted = loadPersistedRouterConfig(piDir);
  return validateRouterConfig({
    authBaseUrl: env.ZOSMA_AUTH_BASE_URL?.trim() || persisted.authBaseUrl || DEFAULT_AUTH_BASE_URL,
    routerBaseUrl: env.ZOSMA_ROUTER_BASE_URL?.trim() || persisted.routerBaseUrl || DEFAULT_ROUTER_BASE_URL,
  });
}
