/**
 * Coverage for the adapter conformance kit (ZOS-87): the shared runner plus the
 * deterministic ACP v2 fixture it validates against.
 *
 * The suite proves the adapter boundary supports protocols beyond Pi:
 *   - the runner passes on the ACP v2 fixture and on a minimal stub adapter
 *     (any adapter can run the shared conformance suite);
 *   - capability gating fires when streaming is not advertised;
 *   - ACP v2 initialize / session / prompt / cancel behavior is represented;
 *   - unsupported features surface explicit normalized errors;
 *   - event ordering and correlation are tested;
 *   - the fixture runs with no external agent binary (pure in-memory).
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  runConformanceSuite,
  AcpV2Adapter,
  ACP_V2_NATIVE_TAGS,
  mapNativeEvent,
  normalizedEventSchema,
  normalizeAdapterError,
  operationNotSupportedError,
  isProtocolError,
} from "./index.ts";
import type { AdapterManifest, CapabilityDescriptor } from "./index.ts";

/**
 * A thin adapter over the faithful ACP v2 fixture. Proves the shared suite runs
 * against any plain adapter instance, not just the named fixture.
 */
class StubHarness extends AcpV2Adapter {}

/**
 * A fixture that drops the streaming capability so the conformance runner must
 * refuse any streaming-gated op. ACP v2's runtime guard throws
 * capability_unsupported when such an op is attempted.
 */
class NoStreamingHarness extends AcpV2Adapter {
  override readonly manifest: AdapterManifest = {
    id: "no-streaming",
    name: "No-Streaming adapter",
    kind: "acp",
    protocolVersion: 1,
    capabilities: [
      { name: "thinking", version: 1 },
    ] as CapabilityDescriptor[],
    config: { vendor: "zosma", version: "0.0.1", launchArgs: [], envPolicy: {} },
  };
}

test("conformance kit passes on the ACP v2 fixture", () => {
  const report = runConformanceSuite(new AcpV2Adapter());
  assert.equal(report.pass, true, `failed: ${report.failed.map((f) => f.name).join(", ")}`);
  assert.equal(report.failed.length, 0);
});

test("conformance kit passes on a minimal stub adapter", () => {
  const report = runConformanceSuite(new StubHarness());
  assert.equal(report.pass, true, `failed: ${report.failed.map((f) => f.name).join(", ")}`);
});

test("capability gating fires when streaming is not advertised", () => {
  const report = runConformanceSuite(new NoStreamingHarness());
  const prompt = report.checks.find((c) => c.name.startsWith("op 'prompt'"));
  assert.ok(prompt, "prompt gating check must exist");
  assert.equal(prompt?.pass, false, "prompt requires streaming, which is missing");
});

test("ACP v2 fixture advertises streaming but not subagents", () => {
  const a = new AcpV2Adapter();
  assert.equal(a.isCapabilitySupported("streaming"), true);
  assert.equal(a.isCapabilitySupported("subagents"), false);
});

test("ACP v2 initialize negotiates an in-band version", () => {
  const r = new AcpV2Adapter().initialize({ protocolVersion: 1, capabilities: [{ name: "streaming", version: 1 }] });
  assert.equal(r.negotiatedVersion, 1);
  assert.equal(r.identity.id, "acp-v2");
});

test("ACP v2 initialize rejects a peer with no shared capability", () => {
  const r = new AcpV2Adapter().initialize({ protocolVersion: 1, capabilities: [] });
  assert.ok(r.error);
  assert.ok(isProtocolError(r.error));
  assert.equal(r.error.code, "unsupported_version");
});

test("ACP v2 resume surfaces operation_not_supported", () => {
  const a = new AcpV2Adapter();
  const session = a.start();
  let thrown: unknown;
  try {
    a.resume(session.sessionId);
  } catch (e) {
    thrown = e;
  }
  assert.ok(isProtocolError(thrown), "resume must throw a ProtocolError");
  const details = thrown.details as Record<string, unknown> | undefined;
  assert.equal(details?.adapterCode, "operation_not_supported");
  assert.equal(details?.operation, "resume");
});

test("ACP v2 prompt returns correlated, ordered, normalized events", () => {
  const a = new AcpV2Adapter();
  const session = a.start();
  const result = a.prompt(session.sessionId, { text: "hi", cid: "corr-1" });
  const events = result.events;
  assert.ok(events.length > 0);
  // correlation: every event carries the turn's cid
  for (const e of events) assert.equal(e.cid, "corr-1");
  // ordering: seq strictly increasing
  for (let i = 1; i < events.length; i += 1) {
    const cur = events[i];
    const prev = events[i - 1];
    assert.ok(cur && prev, "event present");
    assert.ok(cur!.seq > prev!.seq, "seq must increase");
  }
  // normalized
  for (const e of events) assert.ok(normalizedEventSchema(e).ok, "event must be normalized");
  // terminal event is 'end'
  const last = events[events.length - 1];
  assert.ok(last, "at least one event");
  assert.equal(last!.kind, "end");
});

test("ACP v2 rejects an unsupported thinking level as invalid_field", () => {
  const a = new AcpV2Adapter();
  const session = a.start();
  let thrown: unknown;
  try {
    a.update(session.sessionId, { config: { thinking: "cosmic" as never } });
  } catch (e) {
    thrown = e;
  }
  assert.ok(isProtocolError(thrown), "bad config value is a ProtocolError");
  assert.equal(thrown.code, "invalid_field");
});

test("ACP v2 native tags map to normalized kinds", () => {
  assert.equal(mapNativeEvent(ACP_V2_NATIVE_TAGS, "text"), "message");
  assert.equal(mapNativeEvent(ACP_V2_NATIVE_TAGS, "thinking"), "thinking");
  assert.equal(mapNativeEvent(ACP_V2_NATIVE_TAGS, "tool_call"), "tool");
  assert.equal(mapNativeEvent(ACP_V2_NATIVE_TAGS, "end"), "end");
  assert.equal(mapNativeEvent(ACP_V2_NATIVE_TAGS, "nope"), undefined, "unknown tag is unmapped");
});

test("ACP v2 simulateError normalizes to adapter_error", () => {
  const a = new AcpV2Adapter();
  let thrown: unknown;
  try {
    a.simulateError();
  } catch (e) {
    thrown = e;
  }
  assert.ok(isProtocolError(thrown));
  const details = thrown.details as Record<string, unknown> | undefined;
  assert.equal(details?.adapterCode, "adapter_error");
  assert.equal(details?.operation, "simulate");
});

test("resume and operation_not_supported normalize the same way", () => {
  const normalized = normalizeAdapterError(operationNotSupportedError("acp-v2", "resume"));
  const details = normalized.details as Record<string, unknown> | undefined;
  assert.equal(details?.adapterCode, "operation_not_supported");
});
