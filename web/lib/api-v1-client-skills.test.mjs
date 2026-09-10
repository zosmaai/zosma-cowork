import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti } from "../app/api/v1/test-helper.mjs";

const jiti = createV1Jiti();
const client = await jiti.import(new URL("./api-v1-client.ts", import.meta.url).href);
const { installSkill, checkSkillUpdates, searchSkills, ApiV1Error } = client;

test("installSkill POSTs the input body to /api/v1/skills/install", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (p, init) => {
    captured = { p, init };
    return new Response(
      JSON.stringify({ data: { success: true, output: "Installed 1 skill." } }),
      { status: 200 },
    );
  };
  try {
    const res = await installSkill({ package: "acme/skill", scope: "project", cwd: "/tmp/proj" });
    assert.equal(captured.p, "/api/v1/skills/install");
    assert.equal(captured.init.method, "POST");
    assert.deepEqual(JSON.parse(captured.init.body), {
      package: "acme/skill",
      scope: "project",
      cwd: "/tmp/proj",
    });
    assert.equal(res.success, true);
  } finally { globalThis.fetch = originalFetch; }
});

test("checkSkillUpdates POSTs and decodes the updates", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (p, init) => {
    captured = { p, init };
    return new Response(
      JSON.stringify({ data: { updates: [{ package: "acme/skill", scope: "project", state: "update-available" }] } }),
      { status: 200 },
    );
  };
  try {
    const res = await checkSkillUpdates({ package: "acme/skill", scope: "project", cwd: "/tmp/proj" });
    assert.equal(captured.p, "/api/v1/skills/check");
    assert.equal(res.updates.length, 1);
    assert.equal(res.updates[0].state, "update-available");
  } finally { globalThis.fetch = originalFetch; }
});

test("searchSkills POSTs query + limit and decodes results", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (p, init) => {
    captured = { p, init };
    return new Response(
      JSON.stringify({ data: { results: [{ package: "acme@tool", installs: "1K installs", url: "https://skills.sh/acme/tool" }] } }),
      { status: 200 },
    );
  };
  try {
    const res = await searchSkills({ query: "testing", limit: 3 });
    assert.equal(captured.p, "/api/v1/skills/search");
    assert.deepEqual(JSON.parse(captured.init.body), { query: "testing", limit: 3 });
    assert.deepEqual(res.results, [
      { package: "acme@tool", installs: "1K installs", url: "https://skills.sh/acme/tool" },
    ]);
  } finally { globalThis.fetch = originalFetch; }
});

test("installSkill throws ApiV1Error with the wire code on error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { code: "access_denied", message: "no" } }), {
      status: 403,
    });
  try {
    await assert.rejects(
      () => installSkill({ package: "x", scope: "project", cwd: "/tmp/proj" }),
      (error) => error instanceof ApiV1Error && error.code === "access_denied",
    );
  } finally { globalThis.fetch = originalFetch; }
});
