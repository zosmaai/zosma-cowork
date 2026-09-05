/**
 * Zosma Router Auth — PKCE (RFC 7636) helpers.
 * Re-port of agent-sidecar/src/zosma-auth/crypto.ts (sidecar deleted 2026-08-26).
 * Pure Node crypto, no dependencies.
 */

import { createHash, randomBytes } from "node:crypto";

/**
 * Generate a high-entropy random state parameter (64 hex chars = 256 bits).
 */
export function generateState(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Generate a PKCE code verifier (32 random bytes, base64url-encoded, 43 chars).
 */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Derive S256 code challenge from a code verifier.
 */
export function sha256Base64url(input: string): string {
  return createHash("sha256").update(input).digest("base64url");
}
