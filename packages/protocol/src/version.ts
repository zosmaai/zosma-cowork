/**
 * Protocol version metadata.
 *
 * Cowork's wire contract is versioned so the daemon can later speak multiple
 * protocol generations to native adapters (Claude Code, Codex app-server,
 * ACP) without breaking existing clients.
 */

/** Human-readable protocol name. */
export const PROTOCOL_NAME = "cowork";

/** The protocol version this package defines and currently issues. */
export const CURRENT_VERSION = 1;

/** The oldest protocol version a peer may negotiate with this daemon. */
export const MINIMUM_VERSION = 1;

/**
 * A requested version is valid when it is an integer inside the daemon's
 * supported range `[MINIMUM_VERSION, CURRENT_VERSION]`. Requests below
 * MINIMUM_VERSION are rejected so an old client can never force a newer
 * daemon to speak a format it no longer understands.
 */
export function isSupportedVersion(version: number): boolean {
  return Number.isInteger(version) && version >= MINIMUM_VERSION && version <= CURRENT_VERSION;
}

/**
 * Negotiated version when a request omits one: a peer that says nothing is
 * assumed to run the current version.
 */
export function defaultVersion(requested: number | undefined): number {
  return requested ?? CURRENT_VERSION;
}

/** Fully-qualified type-tag prefix for the version-1 schemas. */
export const TAG_PREFIX = `${PROTOCOL_NAME}.v${CURRENT_VERSION}`;
