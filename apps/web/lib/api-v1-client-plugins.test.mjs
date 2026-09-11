import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti } from "../app/api/v1/test-helper.mjs";

const jiti = createV1Jiti();
const client = await jiti.import(new URL("./api-v1-client.ts", import.meta.url).href);
const { listPlugins, managePlugin, ApiV1Error } = client;

const RESP = {
  packages: [],
  totals: { extensions: 0, skills: 0, prompts: 0, themes: 0 },
  diagnostics: [],
  projectResourcesLoaded: true,
};

test("listPlugins GETs /api/v1/plugins?cwd= and decodes the listing", async () => {
  const originalFetch = globalThis.fetch;
  let path = "";
  globalThis.fetch = async (p) => {
    path = p;
    return new Response(JSON.stringify({ data: RESP }), { status: 200 });
  };
  try {
    const res = await listPlugins("/p");
    assert.equal(path, "/api/v1/plugins?cwd=%2Fp");
    assert.deepEqual(res, RESP);
  } finally { globalThis.fetch = originalFetch; }
});

test("managePlugin POSTs { action } to /api/v1/plugins and decodes the re-read listing", async () => {
  const originalFetch = globalThis.fetch;
  let method = "";
  let body = "";
  globalThis.fetch = async (p, init) => {
    method = init?.method ?? "";
    body = init?.body ?? "";
    return new Response(JSON.stringify({ data: RESP }), { status: 200 });
  };
  try {
    const res = await managePlugin({ action: "install", source: "npm:foo", scope: "project", cwd: "/p" });
    assert.equal(method, "POST");
    assert.equal(body, JSON.stringify({ action: "install", source: "npm:foo", scope: "project", cwd: "/p" }));
    assert.deepEqual(res, RESP);
  } finally { globalThis.fetch = originalFetch; }
});

test("listPlugins throws ApiV1Error with the wire code on a non-ok response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { code: "access_denied", message: "no" } }), { status: 403 });
  try {
    await assert.rejects(
      () => listPlugins("/p"),
      (error) => error instanceof ApiV1Error && error.code === "access_denied",
    );
  } finally { globalThis.fetch = originalFetch; }
});
