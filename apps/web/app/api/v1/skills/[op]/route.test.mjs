import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti, stubDaemon } from "../../test-helper.mjs";

const jiti = createV1Jiti();
const { POST } = await jiti.import(new URL("./route.ts", import.meta.url).href);

function post(op, payload) {
  return POST(
    new Request(`http://localhost/api/v1/skills/${op}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
    { params: { op } },
  );
}

test("POST /api/v1/skills/install relays to the daemon and returns the result under { data }", async (t) => {
  const seen = [];
  const restore = stubDaemon([
    (body) => {
      seen.push(body);
      return { body: { ok: true, data: { success: true, output: "Installed 1 skill." } } };
    },
  ]);
  t.after(restore);
  const res = await post("install", { package: "acme/skill", scope: "project", cwd: "/tmp/proj" });
  assert.equal(res.status, 200);
  assert.deepEqual(seen, [{ type: "read:skills-install", source: "acme/skill", scope: "project", cwd: "/tmp/proj" }]);
  const body = await res.json();
  assert.equal(body.error, undefined);
  assert.equal(body.data.success, true);
  assert.equal(body.data.output, "Installed 1 skill.");
});

test("POST /api/v1/skills/check relays to the daemon and returns the updates under { data }", async (t) => {
  const seen = [];
  const restore = stubDaemon([
    (body) => {
      seen.push(body);
      return { body: { ok: true, data: { updates: [] } } };
    },
  ]);
  t.after(restore);
  const res = await post("check", { package: "acme/skill", scope: "project", cwd: "/tmp/proj" });
  assert.equal(res.status, 200);
  assert.deepEqual(seen, [{ type: "read:skills-check", source: "acme/skill", scope: "project", cwd: "/tmp/proj" }]);
  const body = await res.json();
  assert.equal(body.data.updates.length, 0);
});

test("POST /api/v1/skills/search relays to the daemon and returns the results under { data }", async (t) => {
  const seen = [];
  const restore = stubDaemon([
    (body) => {
      seen.push(body);
      return { body: { ok: true, data: { results: [] } } };
    },
  ]);
  t.after(restore);
  const res = await post("search", { query: "testing", limit: 5 });
  assert.equal(res.status, 200);
  assert.deepEqual(seen, [{ type: "read:skills-search", query: "testing", limit: 5 }]);
  const body = await res.json();
  assert.deepEqual(body.data.results, []);
});

test("POST /api/v1/skills/unknown op returns 400 invalid_request", async () => {
  const res = await post("bogus", {});
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, "invalid_request");
});
