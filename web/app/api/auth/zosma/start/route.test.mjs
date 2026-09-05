import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { withAgentDir } from "../test-helper.mjs";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { POST } = await jiti.import("./route.ts");

test("POST /start returns the authorizationUrl from the auth server", withAgentDir(async (_dir, t) => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ authorization_url: "https://stub.example/authorize?state=x" });
  t.after(() => { globalThis.fetch = realFetch; });
  const res = await POST(new Request("http://localhost/api/auth/zosma/start", { method: "POST" }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { authorizationUrl: "https://stub.example/authorize?state=x" });
}));

test("POST /start does not forward redirectUri (auth server rejects unexpected fields)", withAgentDir(async (_dir, t) => {
  let seenBody;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    seenBody = JSON.parse(init.body);
    return Response.json({ authorization_url: "https://stub.example/authorize" });
  };
  t.after(() => { globalThis.fetch = realFetch; });
  const res = await POST(
    new Request("http://localhost/api/auth/zosma/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirectUri: "http://127.0.0.1:30141/api/auth/zosma/callback" }),
    }),
  );
  assert.equal(res.status, 200);
  assert.equal(seenBody.redirect_uri, undefined);
  assert.equal(seenBody.redirectUri, undefined);
}));

test("POST /start maps auth server errors to 502 with a message", withAgentDir(async (_dir, t) => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("down", { status: 503 });
  t.after(() => { globalThis.fetch = realFetch; });
  const res = await POST(new Request("http://localhost/api/auth/zosma/start", { method: "POST" }));
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: "Auth server returned 503" });
}));

test("POST /start tolerates a missing body", withAgentDir(async (_dir, t) => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ authorization_url: "https://stub.example/authorize" });
  t.after(() => { globalThis.fetch = realFetch; });
  const res = await POST(new Request("http://localhost/api/auth/zosma/start", { method: "POST" }));
  assert.equal(res.status, 200);
}));
