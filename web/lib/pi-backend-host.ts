import "server-only";

import {
  createPiBackend,
  type PiBackend,
} from "@/packages/pi-backend";

declare global {
  var __piBackend: PiBackend | undefined;
}

export function getPiBackend(): PiBackend {
  return globalThis.__piBackend ??= createPiBackend({
    piVersion: process.env.NEXT_PUBLIC_PI_VERSION ?? "unknown",
  });
}
