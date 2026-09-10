import type { Result } from "./result.ts";
import type { ProtocolErrorCode } from "./errors.ts";
import { ProtocolError } from "./errors.ts";
import type { Capability } from "./identity.ts";

/**
 * Protocol negotiation rules.
 *
 * Version negotiation clamps a peer's requested version into our supported
 * band [MINIMUM_VERSION, CURRENT_VERSION]. Capability negotiation intersects
 * two peers' advertised sets. A peer downgrades to the highest version and the
 * shared capability band it can still run on.
 */

/** Clamp `requested` into the supported band [MINIMUM, CURRENT]. */
export function negotiateVersion(
  requested: number,
  MINIMUM_VERSION: number,
  CURRENT_VERSION: number,
): number {
  if (requested > CURRENT_VERSION) return CURRENT_VERSION;
  if (requested < MINIMUM_VERSION) return MINIMUM_VERSION;
  return requested;
}

/** Value identity key for a capability, so distinct object entries match by value, not reference. */
function capabilityKey(c: Capability): string {
  return `${c.name}@${c.version}`;
}

/** Intersect two capability sets; returns the entries of `a` shared with `b` (empty array if none). */
export function negotiateCapabilities(
  a: Capability[],
  b: Capability[],
): Capability[] {
  const bKeys = new Set(b.map(capabilityKey));
  const out: Capability[] = [];
  for (const c of a) if (bKeys.has(capabilityKey(c))) out.push(c);
  out.sort();
  return out;
}

export type Negotiation = Result<{
  version: number;
  capabilities: Capability[];
  agreed: boolean;
  message: string;
}>;

export function negotiationError(
  code: ProtocolErrorCode,
  message: string,
): Negotiation {
  return { ok: false, error: new ProtocolError(code, message) };
}

/**
 * Handshake a peer's version against our band, then intersect capabilities.
 * Returns a {@link Negotiation}: success when the version is in-band and the
 * capability intersection is non-empty, otherwise a typed failure.
 */
export function negotiateHandshake(
  version: number,
  MINIMUM_VERSION: number,
  CURRENT_VERSION: number,
  myCapabilities: Capability[],
  peerCapabilities: Capability[],
): Negotiation {
  const agreedVersion = negotiateVersion(
    version,
    MINIMUM_VERSION,
    CURRENT_VERSION,
  );

  if (agreedVersion < MINIMUM_VERSION || agreedVersion > CURRENT_VERSION) {
    return negotiationError(
      "unsupported_version",
      `peer wants version ${version}, we support ${MINIMUM_VERSION}-${CURRENT_VERSION}`,
    );
  }

  const capabilities = negotiateCapabilities(myCapabilities, peerCapabilities);
  if (capabilities.length === 0) {
    return negotiationError(
      "unsupported_version",
      "no shared capability; negotiation cannot proceed",
    );
  }

  return {
    ok: true,
    value: {
      version: agreedVersion,
      capabilities,
      agreed: true,
      message: `negotiated version ${agreedVersion} with capabilities [${capabilities.join(", ")}]`,
    },
  };
}
