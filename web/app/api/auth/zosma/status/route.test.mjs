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
const { GET } = await jiti.import("./route.ts");

test("GET /status reports an unconfigured default state", withAgentDir(async () => {
  const res = await GET(new Request("http://localhost/api/auth/zosma/status"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.configured, false);
  assert.equal(body.modelCount, 0);
  assert.equal(body.authBaseUrl, "https://auth.zosma.ai");
  assert.equal(body.routerBaseUrl, "https://router.zosma.ai/v1");
}));

test("GET /status reports a configured provider", withAgentDir(async (dir) => {
  await writeFile(join(dir, "models.json"), JSON.stringify({
    providers: {
      "zosma-router": {
        id: "zosma-router", name: "Z", baseUrl: "https://router.zosma.ai/v1",
        apiKey: "sk", api: "openai-completions", models: [{ id: "a" }, { id: "b" }],
      },
    },
  }));
  const res = await GET(new Request("http://localhost/api/auth/zosma/status"));
  const body = await res.json();
  assert.equal(body.configured, true);
  assert.equal(body.modelCount, 2);
  assert.equal(body.baseUrl, "https://router.zosma.ai/v1");
}));
