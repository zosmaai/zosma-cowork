import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti, stubDaemon } from "../test-helper.mjs";

const jiti = createV1Jiti();
const { GET } = await jiti.import(new URL("./route.ts", import.meta.url).href);

test("GET /api/v1/capabilities relays to the daemon and advertises transports + features", async (t) => {
  const seen = [];
  const restore = stubDaemon([
    (body) => {
      seen.push(body);
      return {
        body: {
          ok: true,
          data: {
            apiVersion: "v1",
            commandTransports: ["http"],
            eventTransports: ["sse"],
            features: {
              concurrentSessions: true,
              prompt: true,
              abort: true,
              steering: true,
              followUp: true,
              sessionBranches: true,
              bash: true,
              extensions: true,
            },
          },
        },
      };
    },
  ]);
  t.after(restore);
  const res = await GET();
  assert.equal(res.status, 200);
  assert.deepEqual(seen, [{ type: "read:capabilities" }]);
  const body = await res.json();
  assert.deepEqual(body.data, {
    apiVersion: "v1",
    commandTransports: ["http"],
    eventTransports: ["sse"],
    features: {
      concurrentSessions: true,
      prompt: true,
      abort: true,
      steering: true,
      followUp: true,
      sessionBranches: true,
      bash: true,
      extensions: true,
    },
  });
  assert.equal(body.error, undefined);
});
