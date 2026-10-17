import assert from "node:assert/strict";
import test from "node:test";
import { checkWebHealth, webHealthRequest } from "./healthcheck.mjs";

test("webHealthRequest targets the loopback v1 health endpoint", () => {
  const request = webHealthRequest({ PORT: "40141" });
  assert.equal(request.url, "http://127.0.0.1:40141/api/v1/health");
  assert.deepEqual(request.headers, {});
});

test("webHealthRequest adds Basic authentication when configured", () => {
  const request = webHealthRequest({ PORT: "40141", PI_WEB_PASSWORD: "secret value" });
  assert.equal(
    request.headers.authorization,
    `Basic ${Buffer.from("pi:secret value").toString("base64")}`,
  );
});

test("checkWebHealth returns true only for a successful response", async () => {
  assert.equal(await checkWebHealth({ fetchFn: async () => ({ ok: true }) }), true);
  assert.equal(await checkWebHealth({ fetchFn: async () => ({ ok: false }) }), false);
  assert.equal(await checkWebHealth({ fetchFn: async () => { throw new Error("offline"); } }), false);
});