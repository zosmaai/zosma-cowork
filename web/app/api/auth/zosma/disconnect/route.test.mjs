import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
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

test("POST /disconnect removes the provider and reports ok", withAgentDir(async (dir, t) => {
  await writeFile(join(dir, "models.json"), JSON.stringify({
    providers: { "zosma-router": { id: "zosma-router", apiKey: "sk-live", models: [] } },
  }));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("ok", { status: 200 });
  t.after(() => { globalThis.fetch = realFetch; });
  const res = await POST(new Request("http://localhost/api/auth/zosma/disconnect", { method: "POST" }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  const models = JSON.parse(await readFile(join(dir, "models.json"), "utf-8"));
  assert.equal(models.providers["zosma-router"], undefined);
}));

test("POST /disconnect is a clean no-op when not configured", withAgentDir(async () => {
  const res = await POST(new Request("http://localhost/api/auth/zosma/disconnect", { method: "POST" }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
}));
