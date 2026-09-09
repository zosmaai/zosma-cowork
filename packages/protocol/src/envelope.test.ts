import { test } from "node:test";
import assert from "node:assert/strict";
import { isEnvelope, verifyEnvelope, serialize, deserialize, createEnvelope } from "./envelope.ts";
import { HELLO, createHelloEnvelope } from "./commands.ts";
import { CURRENT_VERSION } from "./version.ts";

test("createEnvelope builds a well-formed envelope", () => {
  const env = createEnvelope(HELLO, { name: "peer", version: 1 });
  assert.equal(env.v, CURRENT_VERSION);
  assert.equal(env.t, HELLO);
  assert.ok(typeof env.cid === "string" && env.cid.length > 0);
  assert.ok(typeof env.ts === "number");
  assert.deepEqual(env.payload, { name: "peer", version: 1 });
});

test("isEnvelope guards transport shape", () => {
  assert.ok(isEnvelope(createEnvelope(HELLO, { name: "peer", version: 1 })));
  assert.equal(isEnvelope({ v: 1, t: HELLO }), false);
  assert.equal(isEnvelope(null), false);
  assert.equal(isEnvelope("nope"), false);
});

test("createHelloEnvelope is typed as a valid hello envelope", () => {
  const env = createHelloEnvelope({ name: "peer", version: 1 });
  assert.equal(env.t, HELLO);
  assert.equal(env.payload.name, "peer");
});

test("verifyEnvelope accepts a valid envelope", () => {
  const env = createEnvelope(HELLO, { name: "peer", version: 1 });
  const res = verifyEnvelope(env, HELLO);
  assert.equal(res.ok, true);
});

test("verifyEnvelope rejects a missing protocol version", () => {
  const { v: _v, ...rest } = createEnvelope(HELLO, { name: "peer", version: 1 });
  const res = verifyEnvelope(rest, HELLO);
  assert.equal(res.ok, false);
});

test("verifyEnvelope rejects a missing type tag", () => {
  const { t: _t, ...rest } = createEnvelope(HELLO, { name: "peer", version: 1 });
  const res = verifyEnvelope(rest, HELLO);
  assert.equal(res.ok, false);
});

test("verifyEnvelope rejects a wrong type tag", () => {
  const env = createEnvelope(HELLO, { name: "peer", version: 1 });
  const res = verifyEnvelope(env, "cowork.v1.command.say");
  assert.equal(res.ok, false);
});

test("serialize then deserialize round-trips the transport shape", () => {
  const env = createEnvelope(HELLO, { name: "peer", version: 1 });
  const wire = serialize(env);
  const parsed = deserialize(wire);
  assert.equal(parsed.ok, true);
});
