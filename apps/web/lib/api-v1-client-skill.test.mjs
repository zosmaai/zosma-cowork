import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti } from "../app/api/v1/test-helper.mjs";

const jiti = createV1Jiti();
const client = await jiti.import(new URL("./api-v1-client.ts", import.meta.url).href);
const { listSkills, ApiV1Error } = client;

test("listSkills GETs /api/v1/skills and decodes the skills list", async () => {
  const originalFetch = globalThis.fetch;
  let path = "";
  globalThis.fetch = async (p) => {
    path = p;
    return new Response(
      JSON.stringify({
        data: {
          skills: [{ name: "a", description: "d", filePath: "/x", baseDir: "/y", disableModelInvocation: false, sourceInfo: {} }],
          diagnostics: [],
          projectResourcesLoaded: true,
        },
      }),
      { status: 200 },
    );
  };
  try {
    const res = await listSkills();
    assert.equal(path, "/api/v1/skills");
    assert.deepEqual(res.skills, [
      { name: "a", description: "d", filePath: "/x", baseDir: "/y", disableModelInvocation: false, sourceInfo: {} },
    ]);
    assert.equal(res.projectResourcesLoaded, true);
  } finally { globalThis.fetch = originalFetch; }
});

test("listSkills throws ApiV1Error with the wire code on a non-ok response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { code: "access_denied", message: "no" } }), { status: 403 });
  try {
    await assert.rejects(
      () => listSkills(),
      (error) => error instanceof ApiV1Error && error.code === "access_denied",
    );
  } finally { globalThis.fetch = originalFetch; }
});
