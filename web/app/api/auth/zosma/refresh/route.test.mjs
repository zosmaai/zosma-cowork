import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { withAgentDir } from "../test-helper.mjs";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { POST } = await jiti.import("./route.ts");

test("POST /refresh re-fetches the catalog with the existing key", withAgentDir(async (dir, t) => {
  await writeFile(join(dir, "models.json"), JSON.stringify({
    providers: {
      "zosma-router": {
        id: "zosma-router", name: "Z", baseUrl: "https://router.zosma.ai/v1",
        apiKey: "sk-live", api: "openai-completions", models: [{ id: "old" }],
      },
    },
  }));
  globalThis.__zosmaAuthDepsForTests = {
    reload: async () => {},
    getAvailable: async (pid) => [{ id: "new-1", provider: pid }],
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/v1\/models$/);
    return Response.json({ data: [{ id: "new-1", display_name: "New 1" }] });
  };
  t.after(() => {
    delete globalThis.__zosmaAuthDepsForTests;
    globalThis.fetch = realFetch;
  });
  const res = await POST(new Request("http://localhost/api/auth/zosma/refresh", { method: "POST" }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { modelCount: 1, selectedModelId: "new-1" });
}));

test("POST /refresh is 400 when not configured", withAgentDir(async (_dir, t) => {
  globalThis.__zosmaAuthDepsForTests = {
    reload: async () => {},
    getAvailable: async () => [],
  };
  t.after(() => { delete globalThis.__zosmaAuthDepsForTests; });
  const res = await POST(new Request("http://localhost/api/auth/zosma/refresh", { method: "POST" }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /not configured/);
}));
