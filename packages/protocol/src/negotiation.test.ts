import { test } from "node:test";
import assert from "node:assert/strict";
import {
  negotiateVersion,
  negotiateCapabilities,
  negotiateHandshake,
} from "./negotiation.ts";
import { CURRENT_VERSION, MINIMUM_VERSION } from "./version.ts";
import type { Capability } from "./identity.ts";

const STREAM: Capability = { name: "streaming", version: 1 };
const STOP: Capability = { name: "stop", version: 1 };

test("negotiateVersion clamps an over-high request to current", () => {
  assert.equal(negotiateVersion(CURRENT_VERSION + 5, MINIMUM_VERSION, CURRENT_VERSION), CURRENT_VERSION);
});

test("negotiateVersion clamps an under-low request to minimum", () => {
  assert.equal(negotiateVersion(MINIMUM_VERSION - 3, MINIMUM_VERSION, CURRENT_VERSION), MINIMUM_VERSION);
});

test("negotiateVersion passes an in-band request through", () => {
  assert.equal(negotiateVersion(CURRENT_VERSION, MINIMUM_VERSION, CURRENT_VERSION), CURRENT_VERSION);
});

test("negotiateCapabilities intersects and sorts", () => {
  const caps = negotiateCapabilities([STREAM, STOP], [STOP, STREAM, { name: "thinking", version: 1 }]);
  assert.deepEqual(caps, [STREAM, STOP]);
});

test("negotiateCapabilities returns empty when disjoint", () => {
  const caps = negotiateCapabilities([STREAM], [{ name: "thinking", version: 1 }]);
  assert.deepEqual(caps, []);
});

test("negotiateHandshake succeeds in-band with shared capabilities", () => {
  const res = negotiateHandshake(1, MINIMUM_VERSION, CURRENT_VERSION, [STREAM, STOP], [STREAM]);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.agreed, true);
    assert.deepEqual(res.value.capabilities, [STREAM]);
  }
});

test("negotiateHandshake clamps an out-of-band version instead of rejecting", () => {
  const res = negotiateHandshake(99, MINIMUM_VERSION, CURRENT_VERSION, [STREAM], [STREAM]);
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.value.version, CURRENT_VERSION);
});

test("negotiateHandshake fails when no capability is shared", () => {
  const res = negotiateHandshake(1, MINIMUM_VERSION, CURRENT_VERSION, [STREAM], [{ name: "thinking", version: 1 }]);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.code, "unsupported_version");
});
