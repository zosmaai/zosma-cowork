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
const { createSessionToken } = await jiti.import("../../../../../lib/zosma-auth/session.ts");

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

test("GET /status reports signedIn=false without a session cookie", withAgentDir(async (dir) => {
  await writeFile(join(dir, "models.json"), JSON.stringify({
    providers: {
      "zosma-router": { id: "zosma-router", apiKey: "sk", models: [{ id: "a" }] },
    },
  }));
  const body = await (await GET(new Request("http://localhost/api/auth/zosma/status"))).json();
  assert.equal(body.configured, true);
  assert.equal(body.signedIn, false);
}));

test("GET /status reports signedIn=true for a session issued for this router key", withAgentDir(async (dir) => {
  await writeFile(join(dir, "models.json"), JSON.stringify({
    providers: {
      "zosma-router": { id: "zosma-router", apiKey: "sk", models: [{ id: "a" }] },
    },
  }));
  const token = createSessionToken("sk");
  const res = await GET(new Request("http://localhost/api/auth/zosma/status", {
    headers: { cookie: `zosma_session=${token}` },
  }));
  assert.equal((await res.json()).signedIn, true);
}));

test("GET /status rejects a session issued for a different router key", withAgentDir(async (dir) => {
  await writeFile(join(dir, "models.json"), JSON.stringify({
    providers: {
      "zosma-router": { id: "zosma-router", apiKey: "sk", models: [{ id: "a" }] },
    },
  }));
  const token = createSessionToken("sk-someone-else");
  const res = await GET(new Request("http://localhost/api/auth/zosma/status", {
    headers: { cookie: `zosma_session=${token}` },
  }));
  assert.equal((await res.json()).signedIn, false);
}));
