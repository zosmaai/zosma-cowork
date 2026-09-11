import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("POST /api-key saves the key and returns the result", withAgentDir(async (dir, t) => {
  globalThis.__zosmaAuthDepsForTests = {
    reload: async () => {},
    getAvailable: async (pid) => [{ id: "k1", provider: pid }],
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ data: [{ id: "k1" }] });
  t.after(() => {
    delete globalThis.__zosmaAuthDepsForTests;
    globalThis.fetch = realFetch;
  });
  const res = await POST(
    new Request("http://localhost/api/auth/zosma/api-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "sk-pasted" }),
    }),
  );
  assert.equal(res.status, 200);
  assert.equal((await res.json()).providerId, "zosma-router");
  const models = JSON.parse(await readFile(join(dir, "models.json"), "utf-8"));
  assert.equal(models.providers["zosma-router"].apiKey, "sk-pasted");
}));

test("POST /api-key rejects an empty key with 400", withAgentDir(async () => {
  const res = await POST(
    new Request("http://localhost/api/auth/zosma/api-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
  );
  assert.equal(res.status, 400);
}));
