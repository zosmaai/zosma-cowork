import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { withAgentDir } from "./app/api/auth/zosma/test-helper.mjs";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { proxy } = await jiti.import("./proxy.ts");
const { NextRequest } = await jiti.import("next/server");
const { createSessionToken, SESSION_COOKIE } = await jiti.import("./lib/zosma-auth/session.ts");

const ROUTER_KEY = "sk-live";

async function configureZosma(dir) {
  await writeFile(join(dir, "models.json"), JSON.stringify({
    providers: {
      "zosma-router": {
        id: "zosma-router",
        name: "Zosma AI",
        baseUrl: "https://router.zosma.ai/v1",
        apiKey: ROUTER_KEY,
        api: "openai-completions",
        models: [{ id: "m1" }],
      },
    },
  }));
}

function request(path, { cookie, authorization } = {}) {
  const headers = { host: "127.0.0.1:30141" };
  if (cookie) headers.cookie = cookie;
  if (authorization) headers.authorization = authorization;
  return new NextRequest(`http://127.0.0.1:30141${path}`, { headers });
}

function passed(res) {
  return res.headers.get("x-middleware-next") === "1";
}

test("API is closed without a session cookie", withAgentDir(async (dir) => {
  await configureZosma(dir);
  const res = proxy(request("/api/v1/sessions"));
  assert.equal(res.status, 401);
  assert.match((await res.json()).error, /Sign in with Zosma/);
}));

test("API opens with a session cookie issued for this router key", withAgentDir(async (dir) => {
  await configureZosma(dir);
  const res = proxy(request("/api/v1/sessions", { cookie: `${SESSION_COOKIE}=${createSessionToken(ROUTER_KEY)}` }));
  assert.equal(res.status, 200);
  assert.equal(passed(res), true);
}));

test("a session cookie from another machine's key is rejected", withAgentDir(async (dir) => {
  await configureZosma(dir);
  const cookie = `${SESSION_COOKIE}=${createSessionToken("sk-other-machine")}`;
  assert.equal(proxy(request("/api/v1/sessions", { cookie })).status, 401);
}));

test("the OAuth onboarding routes stay reachable while signed out", withAgentDir(async (dir) => {
  await configureZosma(dir);
  for (const path of [
    "/api/auth/zosma/status",
    "/api/auth/zosma/start",
    "/api/auth/zosma/complete",
    "/api/auth/zosma/callback",
    "/api/auth/zosma/cancel",
    "/api/auth/zosma/disconnect",
  ]) {
    assert.equal(passed(proxy(request(path))), true, path);
  }
}));

test("an unconfigured machine still cannot reach the app API", withAgentDir(async () => {
  assert.equal(proxy(request("/api/v1/sessions")).status, 401);
}));

test("non-API paths are left to the client-side gate", withAgentDir(async (dir) => {
  await configureZosma(dir);
  assert.equal(passed(proxy(request("/"))), true);
}));

test("basic-auth callers are not forced through the browser flow", withAgentDir(async (dir, t) => {
  await configureZosma(dir);
  const prev = process.env.PI_WEB_PASSWORD;
  process.env.PI_WEB_PASSWORD = "hunter2";
  t.after(() => {
    if (prev === undefined) delete process.env.PI_WEB_PASSWORD;
    else process.env.PI_WEB_PASSWORD = prev;
  });
  const basic = `Basic ${Buffer.from("pi:hunter2").toString("base64")}`;
  assert.equal(passed(proxy(request("/api/v1/sessions", { authorization: basic }))), true);
  assert.equal(proxy(request("/api/v1/sessions")).status, 401);
}));