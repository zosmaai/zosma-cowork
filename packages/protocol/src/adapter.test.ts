/**
 * Contract coverage for the ZOS-90 harness-adapter boundary (adapter.ts,
 * session-state.ts, events-mapping.ts, adapter-errors.ts, capability wiring).
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  ADAPTER_OPS,
  ADAPTER_OPS_SPEC,
  envPolicySchema,
  adapterManifestSchema,
  capabilityGapsForOp,
  capabilityGaps,
  capabilityMet,
  advertisedNames,
  capabilityDescriptorSchema,
  sessionStateSchema,
  canTransition,
  mapNativeEvent,
  normalizedEventSchema,
  isAdapterError,
  normalizeAdapterError,
  unsupportedCapabilityError,
  operationNotSupportedError,
  adapterUnavailableError,
  adapterError,
} from "./index.ts";
import type { AdapterEventMapping, CapabilityDescriptor } from "./index.ts";
import { isProtocolError } from "./errors.ts";

test("manifest validates a full native adapter", () => {
  const res = adapterManifestSchema({
    id: "pi",
    name: "Pi",
    kind: "native",
    protocolVersion: 1,
    capabilities: [
      { name: "streaming", version: 1, required: true },
      { name: "thinking", version: 2 },
    ],
    config: {
      vendor: "zosma",
      version: "0.84.2",
      binary: "/usr/local/bin/pi",
      launchArgs: ["--headless"],
      envPolicy: { PATH: "inherit", ZOSMA_DAEMON_TOKEN: "required" },
      timeouts: { startup: 8000, prompt: 30000 },
    },
  });
  assert.ok(res.ok);
});

test("manifest rejects an unknown capability name", () => {
  const res = adapterManifestSchema({
    id: "pi",
    name: "Pi",
    kind: "native",
    protocolVersion: 1,
    capabilities: [
      { name: "streaming", version: 1 },
      { name: "teleport", version: 1 },
    ] as unknown as CapabilityDescriptor[],
    config: { vendor: "zosma", version: "1" },
  });
  assert.ok(!res.ok);
});

test("manifest rejects a bad env policy value", () => {
  const res = adapterManifestSchema({
    id: "pi",
    name: "Pi",
    kind: "native",
    protocolVersion: 1,
    capabilities: [],
    config: { vendor: "zosma", version: "1", envPolicy: { PATH: "maybe" } },
  });
  assert.ok(!res.ok);
});

test("every declared op has a capability requirement", () => {
  for (const op of ADAPTER_OPS) {
    assert.ok(Array.isArray(ADAPTER_OPS_SPEC[op].requires));
  }
  assert.ok(ADAPTER_OPS_SPEC.prompt.requires.includes("streaming"));
});

test("capabilityGapsForOp reports the unsupported op gap", () => {
  // prompt requires streaming; the adapter does not advertise streaming.
  assert.deepEqual(
    capabilityGapsForOp("prompt", ["thinking"]),
    ["streaming"],
  );
  assert.deepEqual(
    capabilityGapsForOp("prompt", ["streaming"]),
    [],
  );
});

test("capabilityMet and advertisedNames agree", () => {
  const descriptors: CapabilityDescriptor[] = [
    { name: "streaming", version: 1 },
    { name: "tools", version: 1 },
  ];
  const advertised = advertisedNames(descriptors);
  assert.deepEqual(advertised, ["streaming", "tools"]);
  assert.equal(capabilityMet(["streaming", "tools"], advertised), true);
  assert.equal(capabilityMet(["streaming"], advertised), true);
  assert.equal(capabilityMet(["permissions"], advertised), false);
});

test("capabilityGaps returns only required-but-missing names", () => {
  assert.deepEqual(capabilityGaps(["permissions", "streaming"], ["streaming", "tools"]), ["permissions"]);
  assert.deepEqual(capabilityGaps(["streaming"], ["streaming", "tools"]), []);
});

test("session state validation accepts known states, rejects unknown", () => {
  assert.equal(sessionStateSchema("created").ok, true);
  assert.equal(sessionStateSchema("detached").ok, true);
  assert.equal(sessionStateSchema("frobnicated").ok, false);
});

test("session state transitions are gated", () => {
  assert.equal(canTransition("created", "running"), true);
  assert.equal(canTransition("running", "closed"), true);
  assert.equal(canTransition("closed", "running"), false, "closed cannot resume");
  assert.equal(canTransition("running", "running"), false, "no self-loop");
});

test("event mapping resolves a native tag to a normalized kind", () => {
  const mappings: AdapterEventMapping[] = [
    { kind: "message", nativeTypes: ["assistant", "message"] },
    { kind: "tool", nativeTypes: ["tool_call", "tool_use"] },
  ];
  assert.equal(mapNativeEvent(mappings, "assistant"), "message");
  assert.equal(mapNativeEvent(mappings, "tool_call"), "tool");
  assert.equal(mapNativeEvent(mappings, "unknown"), undefined, "unmapped -> undefined");
});

test("normalized event schema enforces a numeric seq", () => {
  assert.ok(
    normalizedEventSchema({
      cid: "c-1",
      seq: 4,
      kind: "message",
      payload: { role: "assistant", text: "hi" },
    }).ok,
  );
  assert.ok(
    !normalizedEventSchema({
      cid: "c-1",
      seq: "nope",
      kind: "message",
      payload: {},
    }).ok,
  );
});

test("unsupported capability error carries capability + operation", () => {
  const err = unsupportedCapabilityError("native", "streaming", "prompt");
  assert.ok(isAdapterError(err));
  assert.equal(err.adapterId, "native");
  assert.equal(err.operation, "prompt");
  assert.deepEqual(err.capabilities, ["streaming"]);
  const normalized = normalizeAdapterError(err);
  const details = normalized.details as Record<string, unknown>;
  assert.ok(isProtocolError(normalized));
  assert.equal(details.adapterCode, "capability_unsupported");
  assert.equal(details.adapterId, "native");
  assert.deepEqual(details.capabilities, ["streaming"]);
});

test("operationNotSupportedError carries the operation", () => {
  const err = operationNotSupportedError("acp", "resume");
  assert.ok(isAdapterError(err));
  assert.equal(err.adapterId, "acp");
  assert.equal(err.operation, "resume");
  const normalized = normalizeAdapterError(err);
  const details = normalized.details as Record<string, unknown>;
  assert.equal(details.adapterCode, "operation_not_supported");
  assert.equal(details.operation, "resume");
});

test("adapterUnavailableError carries the adapter id", () => {
  const err = adapterUnavailableError("probe", "binary missing");
  assert.equal(err.code, "adapter_unavailable");
  assert.equal(err.adapterId, "probe");
  const normalized = normalizeAdapterError(err);
  const details = normalized.details as Record<string, unknown>;
  assert.equal(details.adapterCode, "adapter_unavailable");
});

test("adapterError carries a generic code and operation", () => {
  const err = adapterError("pi", "health", "boom");
  assert.equal(err.code, "adapter_error");
  assert.equal(err.operation, "health");
  const normalized = normalizeAdapterError(err);
  const details = normalized.details as Record<string, unknown>;
  assert.equal(details.adapterCode, "adapter_error");
  assert.equal(details.operation, "health");
});

test("normalizeAdapterError preserves identity across all codes", () => {
  const cases = [
    unsupportedCapabilityError("pi", "models", "probe"),
    operationNotSupportedError("pi", "cancel"),
    adapterUnavailableError("pi", "reason"),
    adapterError("pi", "health", "boom"),
  ];
  for (const err of cases) {
    const n = normalizeAdapterError(err);
    const details = n.details as Record<string, unknown>;
    assert.ok(isProtocolError(n));
    assert.equal(details.adapterId, "pi");
  }
});

test("capabilityDescriptorSchema enforces version + name", () => {
  assert.equal(capabilityDescriptorSchema({ name: "streaming", version: 1 }).ok, true);
  assert.equal(
    capabilityDescriptorSchema({ name: "streaming", version: 1, required: true }).ok,
    true,
  );
  assert.equal(capabilityDescriptorSchema({ name: "teleport", version: 1 }).ok, false);
  assert.equal(
    capabilityDescriptorSchema({ name: "streaming", version: "1" }).ok,
    false,
  );
});

test("envPolicySchema round-trips", () => {
  const res = envPolicySchema({ A: "inherit", B: "required", C: "omit" });
  assert.ok(res.ok && res.value && res.value.A === "inherit");
});

test("known op contract is closed for lifecycle ops", () => {
  for (const op of ADAPTER_OPS) {
    assert.ok(ADAPTER_OPS_SPEC[op].description.length > 0);
  }
});
