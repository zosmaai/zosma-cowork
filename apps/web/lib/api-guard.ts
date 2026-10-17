/**
 * Server-side guard: which requests need a Zosma browser session.
 *
 * Pure decision logic so it can be unit-tested without next/server — the
 * proxy supplies the cookie, the router key, and the Basic-auth result.
 *
 * The OAuth onboarding routes must stay reachable or nobody could ever sign
 * in; everything else under /api requires a session. Basic-auth callers
 * (PI_WEB_PASSWORD, used by scripts and remote clients) are already
 * authenticated and are not forced through the browser flow.
 */

const ZOSMA_AUTH_PREFIX = "/api/auth/zosma";

export function isZosmaAuthRoute(pathname: string): boolean {
  return pathname === ZOSMA_AUTH_PREFIX || pathname.startsWith(`${ZOSMA_AUTH_PREFIX}/`);
}

export function needsZosmaSession(input: {
  pathname: string;
  hasValidSession: boolean;
  basicAuthenticated?: boolean;
}): boolean {
  if (input.basicAuthenticated) return false;
  if (!(input.pathname === "/api" || input.pathname.startsWith("/api/"))) return false;
  if (isZosmaAuthRoute(input.pathname)) return false;
  return !input.hasValidSession;
}