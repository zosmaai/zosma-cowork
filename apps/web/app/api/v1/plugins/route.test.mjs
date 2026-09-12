import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti, stubDaemon } from "../test-helper.mjs";

const jiti = createV1Jiti();
const { GET, POST } = await jiti.import(new URL("./route.ts", import.meta.url).href);

const PLUGINS_RESP = {
  packages: [],
  totals: { extensions: 0, skills: 0, prompts: 0, themes: 0 },
  diagnostics: [],
  projectResourcesLoaded: true,
};

test("GET /api/v1/plugins relays to the daemon and returns the listing under { data }", async (t) => {
  const seen = [];
  const restore = stubDaemon([
    (body) => {
      seen.push(body);
      return { body: { ok: true, data: PLUGINS_RESP } };
    },
  ]);
  t.after(restore);
  const res = await GET(new Request("http://localhost/api/v1/plugins?cwd=/p"), {});
  assert.equal(res.status, 200, "status");
  assert.deepEqual(seen, [{ type: "read:plugins-list", cwd: "/p" }]);
  const body = await res.json();
  assert.equal(body.error, undefined, "no error");
  assert.deepEqual(body.data, PLUGINS_RESP);
});

test("POST /api/v1/plugins install relays to the daemon once and returns { data }", async (t) => {
  const seen = [];
  const restore = stubDaemon([
    (body) => {
      seen.push(body);
      return { body: { ok: true, data: PLUGINS_RESP } };
    },
  ]);
  t.after(restore);
  const res = await POST(new Request("http://localhost/api/v1/plugins", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "install", source: "npm:foo", scope: "project", cwd: "/p" }),
  }), {});
  assert.equal(res.status, 200, "status");
  assert.deepEqual(seen, [{ type: "read:plugins-manage", action: "install", source: "npm:foo", scope: "project", cwd: "/p" }]);
  const body = await res.json();
  assert.equal(body.error, undefined, "no error");
  assert.deepEqual(body.data, PLUGINS_RESP);
});

test("POST /api/v1/plugins rejects an unknown action with 400 invalid_request", async () => {
  const res = await POST(new Request("http://localhost/api/v1/plugins", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "explode", source: "npm:foo", cwd: "/p" }),
  }), {});
  assert.equal(res.status, 400, "status");
  const body = await res.json();
  assert.equal(body.error.code, "invalid_request", "invalid_request code");
});
