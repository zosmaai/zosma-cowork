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