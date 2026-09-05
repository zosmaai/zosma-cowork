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
const { PUT } = await jiti.import("./route.ts");

test("PUT /config persists a self-hosted router override", withAgentDir(async (dir) => {
  const res = await PUT(
    new Request("http://localhost/api/auth/zosma/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authBaseUrl: "https://router.internal.example",
        routerBaseUrl: "https://router.internal.example/v1",
      }),
    }),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    authBaseUrl: "https://router.internal.example",
    routerBaseUrl: "https://router.internal.example/v1",
  });
  const file = JSON.parse(await readFile(join(dir, "zosma-router-config.json"), "utf-8"));
  assert.equal(file.authBaseUrl, "https://router.internal.example");
}));

test("PUT /config rejects invalid URLs with 400", withAgentDir(async () => {
  const res = await PUT(
    new Request("http://localhost/api/auth/zosma/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authBaseUrl: "http://insecure.example", routerBaseUrl: "http://insecure.example/v1" }),
    }),
  );
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /HTTPS/);
}));
