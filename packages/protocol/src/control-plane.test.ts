/**
 * ZOS-96: outbound daemon <-> control-plane frame validators.
 * Frames travel over the daemon's outbound WebSocket; correlationId is
 * server-generated, machineId scopes each machine's channel, watermark
 * enables catch-up after reconnect.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  hello,
  rpcRequest,
  rpcResponse,
  ack,
  watermark,
  ping,
  pong,
  CONTROL_TAGS,
  CLOSE_MACHINE_REVOKED,
  CLOSE_DUPLICATE_MACHINE,
} from "./control-plane.ts";

test("control frame tags are versioned and unique", () => {
  assert.deepEqual(CONTROL_TAGS, [
    "cowork.v1.control.hello",
    "cowork.v1.control.rpc.request",
    "cowork.v1.control.rpc.response",
    "cowork.v1.control.ack",
    "cowork.v1.control.ping",
    "cowork.v1.control.pong",
    "cowork.v1.control.watermark",
  ]);
  assert.equal(new Set(CONTROL_TAGS).size, CONTROL_TAGS.length);
});

test("hello accepts a machine registration", () => {
  const r = hello({ machineId: "m-01", name: "dev-laptop", version: 1, watermark: 0 });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.machineId, "m-01");
});

test("hello rejects a missing machineId", () => {
  const r = hello({ name: "dev-laptop", version: 1, watermark: 0 });
  assert.equal(r.ok, false);
});

test("rpcRequest accepts server-generated correlation id", () => {
  const r = rpcRequest({ correlationId: "c-1", method: "session.start" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.method, "session.start");
  assert.equal(r.value.timeoutMs, undefined);
});

test("rpcRequest accepts optional params and timeout", () => {
  const r = rpcRequest({ correlationId: "c-2", method: "ja", params: { cwd: "/x" }, timeoutMs: 5000 });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.value.params, { cwd: "/x" });
  assert.equal(r.value.timeoutMs, 5000);
});

test("rpcRequest rejects a missing correlationId", () => {
  const r = rpcRequest({ method: "session.start" });
  assert.equal(r.ok, false);
});

test("rpcResponse accepts success and error arms", () => {
  const okRes = rpcResponse({ correlationId: "c-1", ok: true, data: { id: 7 } });
  assert.equal(okRes.ok, true);
  const errRes = rpcResponse({ correlationId: "c-1", ok: false, error: { code: "session_not_found", message: "gone" } });
  assert.equal(errRes.ok, true);
  if (!errRes.ok) return;
  assert.equal(errRes.value.error?.code, "session_not_found");
});

test("rpcResponse rejects unknown code shape and missing ok", () => {
  assert.equal(rpcResponse({ correlationId: "c-1", error: { code: "x" } }).ok, false);
  assert.equal(rpcResponse({ correlationId: "c-1", ok: true, error: { code: "x" } }).ok, false);
  assert.equal(rpcResponse({ correlationId: "c-1", ok: false, error: { brot: 1 } }).ok, false);
  assert.equal(rpcResponse({ correlationId: "c-1" }).ok, false);
});

test("ack, watermark and heartbeat frames validate", () => {
  assert.equal(ack({ correlationId: "c-1" }).ok, true);
  assert.equal(ack({}).ok, false);
  assert.equal(watermark({ watermark: 12 }).ok, true);
  assert.equal(watermark({ watermark: -1 }).ok, false);
  assert.equal(ping({}).ok, true);
  assert.equal(pong({}).ok, true);
});

// --- ZOS-91: capability manifest on hello (additive) ---

test("hello still validates without a manifest (older daemon)", () => {
  const r = hello({ machineId: "m-01", name: "dev-laptop", version: 1, watermark: 0 });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.manifest, undefined);
});

test("hello carries a capability manifest", () => {
  const r = hello({
    machineId: "m-01",
    name: "dev-laptop",
    version: 1,
    watermark: 3,
    manifest: {
      manifestVersion: 1,
      platform: "darwin",
      arch: "arm64",
      hostname: "dev-laptop",
      daemonVersion: "0.1.0",
      node: "v22.19.0",
      adapters: [{ id: "pi", name: "Pi coding agent", protocolVersion: 1, capabilities: [{ name: "streaming", version: 1 }] }],
      services: ["pi:prompt", "read:capabilities"],
    },
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.manifest?.adapters?.[0]?.id, "pi");
  assert.deepEqual(r.value.manifest?.services, ["pi:prompt", "read:capabilities"]);
});

test("the manifest is additive: unknown fields and partial payloads are tolerated", () => {
  // a newer daemon adding fields must not break an older plane's validator
  const extra = hello({ machineId: "m-01", name: "l", version: 1, watermark: 0, manifest: { manifestVersion: 2, futureField: { deep: true }, services: ["pi:prompt"] }, anotherFutureField: 1 });
  assert.equal(extra.ok, true);
  // a partial manifest (only the version) is valid too
  const partial = hello({ machineId: "m-01", name: "l", version: 1, watermark: 0, manifest: { manifestVersion: 1 } });
  assert.equal(partial.ok, true);
});

test("a malformed manifest is rejected (wrong nested type)", () => {
  const bad = hello({
    machineId: "m-01",
    name: "l",
    version: 1,
    watermark: 0,
    manifest: { manifestVersion: 1, adapters: [{ id: "pi", capabilities: [{ name: 42 }] }] },
  });
  assert.equal(bad.ok, false);
  const noId = hello({ machineId: "m-01", name: "l", version: 1, watermark: 0, manifest: { adapters: [{ capabilities: [] }] } });
  assert.equal(noId.ok, false);
});

test("machine close codes are shared constants (4003 revoked, 4004 duplicate)", () => {
  assert.equal(CLOSE_MACHINE_REVOKED, 4003);
  assert.equal(CLOSE_DUPLICATE_MACHINE, 4004);
  assert.notEqual(CLOSE_MACHINE_REVOKED, CLOSE_DUPLICATE_MACHINE);
});