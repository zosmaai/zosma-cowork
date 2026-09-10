import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti } from "../../test-helper.mjs";

const jiti = createV1Jiti();
// Bracketed `[op]` makes node's --test glob skip this file (it reads `[op]` as
// a character class), so this is run manually, not via `app/**/*.test.mjs`.
const { POST } = await jiti.import(new URL("./route.ts", import.meta.url).href);

function stubFacade(overrides = {}) {
  const original = globalThis.__piBackend;
  globalThis.__piBackend = {
    installSkill: async () => ({ success: true, output: "Installed 1 skill." }),
    checkSkillUpdates: async () => ({ updates: [] }),
    updateSkill: async () => ({ success: true, skill: undefined, output: "ok" }),
    searchSkills: async () => ({ results: [] }),
    ...overrides,
  };
  return () => { globalThis.__piBackend = original; };
}

test("POST /api/v1/skills/install returns the result under { data }", async () => {
  const restore = stubFacade();
  try {
    const res = await POST(
      new Request("http://localhost/api/v1/skills/install", {
        method: "POST",
        body: JSON.stringify({ package: "acme/skill", scope: "project", cwd: "/tmp/proj" }),
      }),
      { params: { op: "install" } },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.error, undefined);
    assert.equal(body.data.success, true);
    assert.equal(body.data.output, "Installed 1 skill.");
  } finally { restore(); }
});

test("POST /api/v1/skills/check returns the updates under { data }", async () => {
  const restore = stubFacade();
  try {
    const res = await POST(
      new Request("http://localhost/api/v1/skills/check", {
        method: "POST",
        body: JSON.stringify({ package: "acme/skill", scope: "project", cwd: "/tmp/proj" }),
      }),
      { params: { op: "check" } },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.updates.length, 0);
  } finally { restore(); }
});

test("POST /api/v1/skills/search returns the results under { data }", async () => {
  const restore = stubFacade();
  try {
    const res = await POST(
      new Request("http://localhost/api/v1/skills/search", {
        method: "POST",
        body: JSON.stringify({ query: "testing", limit: 5 }),
      }),
      { params: { op: "search" } },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.data.results, []);
  } finally { restore(); }
});

test("POST /api/v1/skills/unknown op returns 400 invalid_request", async () => {
  const res = await POST(
    new Request("http://localhost/api/v1/skills/bogus", { method: "POST" }),
    { params: { op: "bogus" } },
  );
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.code, "invalid_request");
});
