/**
 * Zosma web session — per-browser sign-in cookie.
 *
 * The session is a stateless HMAC token keyed by the router key itself, so
 * there is no session store to persist, expire or migrate:
 *
 *   - disconnecting (removing the provider from models.json) invalidates
 *     every cookie that was issued for it, automatically
 *   - a cookie copied to another machine is useless — that machine has no
 *     matching router key
 *   - tampering with the expiry or the key fingerprint breaks the HMAC
 *
 * Format: `<sha256(routerKey)>.<expiresAtMs>.<hmac>`
 *
 * This is what makes the sign-in gate a real boundary: the machine may be
 * signed in to Zosma, but a given *browser* only gets in after completing
 * the OAuth flow and receiving this cookie.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { readProviderEntry, ZOSMA_PROVIDER_ID } from "./models-json";

export const SESSION_COOKIE = "zosma_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function signingKey(apiKey: string): string {
  return `zosma-web-session:${apiKey}`;
}

/** Stable, non-reversible id for a router key. Safe to put in a cookie. */
export function sessionFingerprint(apiKey: string): string {
  return createHash("sha256").update(apiKey, "utf8").digest("hex");
}

function sign(payload: string, apiKey: string): string {
  return createHmac("sha256", signingKey(apiKey)).update(payload).digest("base64url");
}

export function createSessionToken(apiKey: string, now: number = Date.now()): string {
  const payload = `${sessionFingerprint(apiKey)}.${now + SESSION_TTL_MS}`;
  return `${payload}.${sign(payload, apiKey)}`;
}

export function verifySessionToken(
  token: string | null | undefined,
  apiKey: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (typeof token !== "string" || typeof apiKey !== "string" || !apiKey) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [fingerprint, expires, signature] = parts;
  if (!fingerprint || !expires || !signature) return false;
  if (fingerprint !== sessionFingerprint(apiKey)) return false;

  const expiresAt = Number(expires);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;

  const expected = sign(`${fingerprint}.${expires}`, apiKey);
  const actual = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (actual.length !== want.length) return false;
  return timingSafeEqual(actual, want);
}

/** Read one cookie value out of a raw `Cookie:` header. */
export function readSessionCookie(
  cookieHeader: string | null | undefined,
  name: string = SESSION_COOKIE,
): string | null {
  if (!cookieHeader) return null;
  for (const pair of cookieHeader.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() !== name) continue;
    const value = pair.slice(eq + 1).trim();
    return value || null;
  }
  return null;
}

export function sessionSetCookie(token: string, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function sessionClearCookie(secure: boolean): string {
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/** Only mark cookies Secure on https — localhost is plain http. */
export function isHttpsRequest(req: Request): boolean {
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

/** The router key currently configured for this machine, or null. */
export function currentRouterKey(piDir: string): string | null {
  const entry = readProviderEntry(join(piDir, "models.json"), ZOSMA_PROVIDER_ID);
  const key = entry?.apiKey;
  return typeof key === "string" && key.length > 0 ? key : null;
}

/**
 * `Set-Cookie` header that signs this browser in — empty when the machine
 * has no router key (nothing to bind a session to).
 */
export function signInCookies(req: Request, piDir: string): Record<string, string> {
  const key = currentRouterKey(piDir);
  if (!key) return {};
  return { "set-cookie": sessionSetCookie(createSessionToken(key), isHttpsRequest(req)) };
}

/** `Set-Cookie` header that signs this browser out. */
export function signOutCookies(req: Request): Record<string, string> {
  return { "set-cookie": sessionClearCookie(isHttpsRequest(req)) };
}