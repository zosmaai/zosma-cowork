import assert from "node:assert/strict";
import test from "node:test";
import { OutboundConnector } from "./connector.ts";

test("prototype frame tags are ignored", async () => {
  const connector = new OutboundConnector({
    url: "ws://127.0.0.1:1/ws",
    token: "test-token",
    machineId: "test-machine",
    machineName: "test",
  });

  await assert.doesNotReject(
    connector.onMessage(JSON.stringify({ type: "__proto__" })),
  );
});
