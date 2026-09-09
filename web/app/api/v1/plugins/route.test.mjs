import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti } from "../test-helper.mjs";

// ZOS-82: /api/v1/plugins route — transport-neutral envelope for the plugin
// management surface (list + install/update/remove/disable/enable). The route
// only calls the pi-backend facade; the file-access + project-trust gating
// lives in the facade and is covered by packages/pi-backend/plugins.test.mjs.
const jiti = createV1Jiti();
const { GET, POST } = await jiti.import(
  new URL("./route.ts", import.meta.url).href,
);

const PLUGINS_RESP = {
  packages: [],
  totals: { extensions: 0, skills: 0, prompts: 0, themes: 0 },
  diagnostics: [],
  projectResourcesLoaded: true,
};

let callCount = 0;
let original;
function stub() {
  original = globalThis.__piBackend;
  callCount = 0;
  globalThis.__piBackend = {
    listPlugins: async () => PLUGINS_RESP,
    managePlugin: async () => { callCount += 1; return PLUGINS_RESP; },
  };
}
function unstub() { globalThis.__piBackend = original; }

test("GET /api/v1/plugins returns the listing under { data }", async () => {
  stub();
  try {
    const res = await GET(new Request("http://localhost/api/v1/plugins?cwd=/p"), {});
    assert.equal(res.status, 200, "status");
    const body = await res.json();
    assert.equal(body.error, undefined, "no error");
    assert.equal(typeof body.data, "object", "data is object");
    assert.deepEqual(body.data, PLUGINS_RESP);
  } finally { unstub(); }
});

test("POST /api/v1/plugins install calls the facade once and returns { data }", async () => {
  stub();
  try {
    const res = await POST(new Request("http://localhost/api/v1/plugins", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "install", source: "npm:foo", scope: "project", cwd: "/p" }),
    }), {});
    assert.equal(res.status, 200, "status");
    assert.equal(callCount, 1, "managePlugin invoked once");
    const body = await res.json();
    assert.equal(body.error, undefined, "no error");
    assert.deepEqual(body.data, PLUGINS_RESP);
  } finally { unstub(); }
});

test("POST /api/v1/plugins rejects an unknown action with 400 invalid_request", async () => {
  stub();
  try {
    const res = await POST(new Request("http://localhost/api/v1/plugins", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "explode", source: "npm:foo", cwd: "/p" }),
    }), {});
    assert.equal(res.status, 400, "status");
    const body = await res.json();
    assert.equal(body.error.code, "invalid_request", "invalid_request code");
  } finally { unstub(); }
});
