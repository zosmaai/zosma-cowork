import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCapabilityManifest, DAEMON_SERVICES } from "./manifest.ts";

const piManifest = {
  id: "pi",
  name: "Pi coding agent",
  kind: "native",
  protocolVersion: 1,
  capabilities: [
    { name: "streaming", version: 1, required: true },
    { name: "thinking", version: 2 },
  ],
  config: { vendor: "zosma", version: "0.3.0", timeouts: { startup: 1 } },
};

test("manifest advertises platform, arch, hostname and runtime versions", () => {
  const m = buildCapabilityManifest([piManifest]);
  assert.equal(m.manifestVersion, 1);
  assert.equal(m.platform, process.platform);
  assert.equal(m.arch, process.arch);
  assert.ok(m.hostname.length > 0);
  assert.match(m.daemonVersion, /^\d+\.\d+\.\d+/);
  assert.equal(m.node, process.version);
});

test("manifest advertises a non-empty service surface including pi and read rpc groups", () => {
  const m = buildCapabilityManifest([piManifest]);
  assert.ok(m.services.length > 10);
  assert.ok(DAEMON_SERVICES.includes("pi:prompt"));
  assert.ok(DAEMON_SERVICES.includes("read:capabilities"));
  assert.ok(m.services.includes("files:read"));
  assert.deepEqual([...m.services].sort(), m.services, "services are sorted for stable diffs");
});

test("adapters mirror the harness manifest capabilities", () => {
  const m = buildCapabilityManifest([piManifest]);
  assert.equal(m.adapters.length, 1);
  assert.equal(m.adapters[0].id, "pi");
  assert.equal(m.adapters[0].name, "Pi coding agent");
  assert.equal(m.adapters[0].protocolVersion, 1);
  assert.deepEqual(m.adapters[0].capabilities, [
    { name: "streaming", version: 1 },
    { name: "thinking", version: 2 },
  ]);
});

test("manifest contains no undefined fields (it goes on the wire as JSON)", () => {
  const m = buildCapabilityManifest([piManifest]);
  const roundTripped = JSON.parse(JSON.stringify(m));
  assert.deepEqual(roundTripped, m);
  assert.deepEqual(Object.keys(m).sort(), ["adapters", "arch", "daemonVersion", "hostname", "manifestVersion", "node", "platform", "services"]);
});
