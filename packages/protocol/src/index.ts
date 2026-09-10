/**
 * @zosma-cowork/protocol — transport-neutral, versioned, runtime-validated
 * messages for the Cowork runtime.
 *
 * No Next.js / Pi / UI / transport imports. Validate payloads with the
 * zero-dependency validators in `schema.ts`, verify an envelope's transport
 * shape with `verifyEnvelope`, and build envelopes with `createEnvelope`.
 */

// --- version metadata ---
export {
  PROTOCOL_NAME,
  CURRENT_VERSION,
  MINIMUM_VERSION,
  isSupportedVersion,
  defaultVersion,
  TAG_PREFIX,
} from "./version.ts";

// --- typed errors ---
export type { ProtocolErrorCode } from "./errors.ts";
export {
  ProtocolError,
  PROTOCOL_ERROR_CODES,
  isProtocolError,
  missingField,
  invalidField,
  invalidProtocolVersion,
  unknownType,
  unknownCommand,
} from "./errors.ts";
export type { ProtocolErrorWire } from "./errors.ts";

// --- result combinator ---
export type { Result } from "./result.ts";
export { ok, fail, expect, isOk } from "./result.ts";

// --- validators ---
export type { Schema, SpecObject, Infer } from "./schema.ts";
export {
  literal,
  string,
  nonEmptyString,
  number,
  boolean,
  enum_ as enumValidator,
  optional,
  record,
  array,
  object,
} from "./schema.ts";

// --- negotiation ---
export type { Negotiation } from "./negotiation.ts";
export {
  negotiateVersion,
  negotiateCapabilities,
  negotiateHandshake,
  negotiationError,
} from "./negotiation.ts";

// --- envelope shapes + factories ---
export type { Envelope, EnvelopePayload } from "./envelope.ts";
export {
  envelope,
  serialize,
  deserialize,
  isEnvelope,
  verifyEnvelope,
  createEnvelope,
} from "./envelope.ts";

// --- commands (client -> daemon) ---
export { HELLO, SAY, STOP, commandTags, hello, say, stop, createHelloEnvelope, createSayEnvelope, createStopEnvelope } from "./commands.ts";
export type { HelloCommandPayload, SayCommandPayload, StopCommandPayload } from "./commands.ts";

// --- events (daemon -> client stream) ---
export { MESSAGE, AGENT, eventTags, message, agent } from "./events.ts";
export type { MessageEventPayload, AgentEventPayload } from "./events.ts";

// --- responses (daemon -> client terminal) ---
export { HELLO_RESPONSE, COMMAND_RESPONSE, responseTags, helloResponse, command, createHelloResponseEnvelope } from "./responses.ts";
export type { HelloResponsePayload, CommandResponsePayload } from "./responses.ts";

// --- identity / capability / session / correlation ---
export type { Identity, Session, SessionKind, Capability, CapabilityName, CorrelationId } from "./identity.ts";
export { identitySchema, capabilitySchema, sessionSchema, correlationId } from "./identity.ts";

// --- harness adapter contract (ZOS-90) ---
// Additive capability descriptors.
export type {
  CapabilityName as CapabilityDescriptorName,
  CapabilityDescriptor,
} from "./capability.ts";
export {
  CAPABILITY_NAMES,
  capabilityDescriptorSchema,
  advertisedNames,
  isCapabilitySupported,
  capabilityGaps,
  capabilityMet,
  assertKnownCapability,
} from "./capability.ts";

// Adapter interface + manifest + lifecycle op/capability wiring.
export type {
  AdapterId,
  AdapterKind,
  AdapterOp,
  AdapterOpSpec,
  AdapterConfig,
  EnvPolicy,
  EnvValuePolicy,
  AdapterManifest,
} from "./adapter.ts";
export {
  ADAPTER_KINDS,
  ADAPTER_OPS,
  ADAPTER_OP_DESCRIPTIONS,
  ADAPTER_OPS_SPEC,
  ENV_VALUE_POLICIES,
  envPolicyValueSchema,
  envPolicySchema,
  adapterManifestSchema,
  capabilityGapsForOp,
} from "./adapter.ts";

// Normalized session state.
export type { SessionState, SessionHandle } from "./session-state.ts";
export { SESSION_STATES, sessionStateSchema, canTransition, sessionHandleSchema } from "./session-state.ts";

// Normalized event mapping boundary.
export type {
  NormalizedEventKind,
  AdapterEventMapping,
  NormalizedEvent,
} from "./events-mapping.ts";
export {
  NORMALIZED_EVENT_KINDS,
  adapterEventMappingSchema,
  mapNativeEvent,
  normalizedEventSchema,
} from "./events-mapping.ts";

// Session-to-harness persistence (ZOS-89).
export type { SessionRecord, RecoveredSessions } from "./store.ts";
export {
  sessionRecordSchema,
  recover,
  SessionStore,
  STORE_FILENAME,
} from "./store.ts";

// Adapter-error + unsupported-capability semantics.
export type { AdapterErrorCode, AdapterError } from "./adapter-errors.ts";
export { ADAPTER_ERROR_CODES, isAdapterError, normalizeAdapterError, unsupportedCapabilityError, operationNotSupportedError, adapterUnavailableError, adapterError } from "./adapter-errors.ts";

// --- adapter conformance kit (ZOS-87) ---
// Shared conformance runner + the runtime adapter surface it drives.
export type {
  HarnessAdapter,
  InitializeRequest,
  InitializeResponse,
  Turn,
  TurnResult,
  UpdatePatch,
  SessionStateLike,
  AcpSessionConfig,
  PermissionRequest,
  PermissionResponse,
  HealthStatus,
  ConformanceCheck,
  ConformanceReport,
} from "./conformance.ts";
export { runConformanceSuite } from "./conformance.ts";

// ACP v2 deterministic fixture.
export { AcpV2Adapter, ACP_V2_NATIVE_TAGS } from "./acp-v2.ts";
