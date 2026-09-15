import assert from "node:assert/strict";
import test from "node:test";
import {
  assertContainerPolicy,
  assertImagePolicy,
  assertNoSecrets,
  basicAuthorization,
} from "../docker-smoke.mjs";

const entrypoint = [
  "/opt/zosma/runtime/bin/node",
  "/opt/zosma/supervisor/run-server.mjs",
];

test("basicAuthorization creates the health-check credential without exposing plaintext", () => {
  const value = basicAuthorization("example-password");
  assert.equal(value, `Basic ${Buffer.from("pi:example-password").toString("base64")}`);
  assert.equal(value.includes("example-password"), false);
});

test("assertNoSecrets rejects secrets and their prefixes in log output", () => {
  assert.throws(
    () => assertNoSecrets("started with token abc123xyz", ["abc123xyz"]),
    /secret material appeared in logs/,
  );
  assert.throws(
    () => assertNoSecrets("started with token abc123", ["abc123xyz"]),
    /secret material appeared in logs/,
  );
  assert.doesNotThrow(() => assertNoSecrets("started without secrets", ["abc123xyz"]));
});

test("assertImagePolicy rejects a root image", () => {
  assert.throws(
    () => assertImagePolicy({ Config: { User: "", Entrypoint: entrypoint } }),
    /image must declare a non-root user/,
  );
});

test("assertContainerPolicy accepts the production boundary", () => {
  assert.doesNotThrow(() => assertContainerPolicy({
    Path: entrypoint[0],
    Args: [entrypoint[1]],
    Config: { User: "1000:1000" },
    HostConfig: {
      Privileged: false,
      NetworkMode: "zosma_default",
      CapAdd: null,
      Devices: [],
      PortBindings: { "30141/tcp": [{ HostIp: "127.0.0.1", HostPort: "32141" }] },
    },
    Mounts: [
      { Source: "/tmp/workspace", Destination: "/workspace", RW: true },
      { Source: "/tmp/state", Destination: "/data/pi-agent", RW: true },
    ],
  }, {
    uid: 1000,
    gid: 1000,
    bindAddress: "127.0.0.1",
    daemonToken: "daemon-example-secret",
    webPassword: "web-example-secret",
  }));
});

test("assertContainerPolicy rejects a root UID even when it matches the container", () => {
  assert.throws(() => assertContainerPolicy({
    Path: entrypoint[0],
    Args: [entrypoint[1]],
    Config: { User: "0:0" },
    HostConfig: {
      Privileged: false,
      NetworkMode: "zosma_default",
      CapAdd: null,
      Devices: [],
      PortBindings: { "30141/tcp": [{ HostIp: "127.0.0.1", HostPort: "32141" }] },
    },
    Mounts: [
      { Source: "/tmp/workspace", Destination: "/workspace", RW: true },
      { Source: "/tmp/state", Destination: "/data/pi-agent", RW: true },
    ],
  }, {
    uid: 0,
    gid: 0,
    bindAddress: "127.0.0.1",
    daemonToken: "daemon-example-secret",
    webPassword: "web-example-secret",
  }), /must not run as root/);
});

test("assertContainerPolicy rejects forbidden privilege and mounts", () => {
  assert.throws(() => assertContainerPolicy({
    Path: "node",
    Args: [],
    Config: { User: "1000:1000" },
    HostConfig: {
      Privileged: true,
      NetworkMode: "host",
      CapAdd: ["NET_ADMIN"],
      Devices: [{ PathOnHost: "/dev/net/tun" }],
      PortBindings: {},
    },
    Mounts: [{ Source: "/var/run/docker.sock", Destination: "/var/run/docker.sock", RW: true }],
  }, {
    uid: 1000,
    gid: 1000,
    bindAddress: "127.0.0.1",
    daemonToken: "daemon-example-secret",
    webPassword: "web-example-secret",
  }), /privileged|host network|capabilities|devices|docker socket|published port/);
});