import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti, stubDaemon } from "./test-helper.mjs";

// ZOS-81: /api/v1 wire-format contract matrix.
//
// contracts.ts is type-only, so it cannot catch a route that drifts on the
// WIRE shape. This test asserts every tested route returns the
// transport-neutral envelope: 2xx => { data } (+ json content-type), and never
// a bare object. A route returning the wrong shape breaks the suite, not just
// the build.
//
// Roadmap item 6: every v1 route is a daemon relay — the fetch stub answers
// the read:* / pi:* ops over the env seam.
const routes = [
  "health/route.ts",
  "agent/running/route.ts",
  "capabilities/route.ts",
  "sessions/[id]/model/route.ts",
  "sessions/[id]/context/route.ts",
  "skills/route.ts",
  "plugins/route.ts",
];

function readData(type) {
  switch (type) {
    case "read:health":
      return { status: "ok", apiVersion: "v1", piVersion: "pi-test" };
    case "read:capabilities":
      return { apiVersion: "v1", commandTransports: ["http"], eventTransports: ["sse"], features: {} };
    case "read:session-context":
      return { entries: [], thinking: [] };
    case "read:skills-list":
      return { skills: [], diagnostics: [], projectResourcesLoaded: true };
    case "read:plugins-list":
      return { packages: [], totals: { extensions: 0, skills: 0, prompts: 0, themes: 0 }, diagnostics: [], projectResourcesLoaded: true };
    default:
      return {};
  }
}

const jiti = createV1Jiti();

for (const rel of routes) {
  test(`contract: GET /${rel} returns the { data } envelope`, async (t) => {
    const { GET } = await jiti.import(new URL(rel, import.meta.url).href);
    assert.equal(typeof GET, "function");
    const unstubDaemon = stubDaemon((body) => {
        if (body.type === "pi:list") {
          return { body: { ok: true, sessions: [{ sessionId: "s1", state: "running" }] } };
        }
        if (body.type === "pi:command" && body.command?.type === "get_state") {
          return { body: { ok: true, result: { model: { id: "claude", provider: "anthropic" }, thinkingLevel: "medium" } } };
        }
        if (typeof body.type === "string" && body.type.startsWith("read:")) {
          return { body: { ok: true, data: readData(body.type) } };
        }
        return { status: 404, body: { ok: false, error: "unknown op", code: "internal_error" } };
    });
    t.after(unstubDaemon);
    const res = await GET(new Request(`http://localhost/api/v1/${rel}`), { params: Promise.resolve({ id: "s1" }) });
    assert.equal(res.status, 200, `${rel} status`);
    const ct = res.headers.get("content-type") || "";
    assert.match(ct, /application\/json/, `${rel} content-type`);
    const body = await res.json();
    assert.ok("data" in body, `${rel} envelope has data`);
    assert.equal(body.error, undefined, `${rel} no error key on 2xx`);
    assert.equal(typeof body.data, "object", `${rel} data is object`);
    assert.notEqual(body.data, null, `${rel} data not null`);
  });
}
