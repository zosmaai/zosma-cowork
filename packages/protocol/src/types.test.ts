/**
 * Compile-time contract tests. These run under `node --experimental-strip-types`
 * as no-ops (types are stripped), but they fail the `tsc` typecheck if the wire
 * contract drifts — that is the guarantee they provide.
 */
import { createHelloEnvelope, createSayEnvelope } from "./commands.ts";
import type { Envelope } from "./types.ts";
import type { HelloCommandPayload } from "./commands.ts";
import type { SayCommandPayload } from "./commands.ts";

// createHelloEnvelope must return an Envelope whose payload is exactly a
// HelloCommandPayload (with a string `name`).
export function helloEnvelopeType(): void {
  const env: Envelope<HelloCommandPayload> = createHelloEnvelope({ name: "p", version: 1 });
  const name: string = env.payload.name;
  void name;
}

// createSayEnvelope payload must expose the optional `mode` union.
export function sayEnvelopeType(): void {
  const env: Envelope<SayCommandPayload> = createSayEnvelope({ sessionId: "s", text: "hi" });
  const mode: "agent" | "thinking" | undefined = env.payload.mode;
  void mode;
}
