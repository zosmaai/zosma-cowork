import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { startZosmaAuth, ZOSMA_CLIENT_ID, completeZosmaAuth, disconnectZosmaAuth, cancelZosmaAuth, refreshZosmaModels, getZosmaStatus, authenticateWithKey } = await jiti.import("./index.ts");
const stateModule = await jiti.import("./state.ts");

function withPiDir(run) {
  return async () => {
    const dir = await mkdtemp(join(tmpdir(), "zosma-index-"));
    try {
      await run(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

function stubFetch(handler) {
  return async (url, init) => handler(String(url), init);
}

function fileExists(path) {
  return readFile(path, "utf-8").then(() => true, () => false);
}

test("startZosmaAuth returns the server authorization_url", withPiDir(async (dir) => {
  const fetch = stubFetch(async () =>
    Response.json({ authorization_url: "https://router.zosma.ai/authorize?x=1" }),
  );
  const res = await startZosmaAuth(dir, { fetch });
  assert.equal(res.authorizationUrl, "https://router.zosma.ai/authorize?x=1");
}));

test("startZosmaAuth persists pending tx + device id before the network call", withPiDir(async (dir) => {
  const calls = [];
  const fetch = stubFetch(async (url) => {
    calls.push(url);
    // Read state mid-flight: pending file must already exist.
    const pending = JSON.parse(await readFile(join(dir, "zosma-auth-pending.json"), "utf-8"));
    assert.ok(pending.state);
    assert.ok(pending.codeVerifier);
    assert.ok(pending.deviceId);
    return Response.json({ authorization_url: "https://x/authorize" });
  });
  await startZosmaAuth(dir, { fetch });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^https:\/\/auth\.zosma\.ai\/v1\/cowork\/authorizations$/);
  const deviceId = (await readFile(join(dir, "zosma-device-id.txt"), "utf-8")).trim();
  assert.match(deviceId, /^cowork-[0-9a-f]{32}$/);
}));

test("startZosmaAuth sends frozen client_id, PKCE fields and device id", withPiDir(async (dir) => {
  let body;
  const fetch = stubFetch(async (_url, init) => {
    body = JSON.parse(init.body);
    return Response.json({ authorization_url: "https://x/authorize" });
  });
  await startZosmaAuth(dir, { fetch });
  assert.equal(body.client_id, ZOSMA_CLIENT_ID);
  assert.match(body.state, /^[0-9a-f]{64}$/);
  assert.match(body.code_challenge, /^[A-Za-z0-9_-]+$/);
  assert.equal(body.code_challenge_method, "S256");
  assert.match(body.device_id, /^cowork-/);
}));

test("startZosmaAuth reuses an existing device id across calls", withPiDir(async (dir) => {
  const fetch = stubFetch(async () => Response.json({ authorization_url: "https://x/authorize" }));
  await startZosmaAuth(dir, { fetch });
  const first = await readFile(join(dir, "zosma-device-id.txt"), "utf-8");
  await startZosmaAuth(dir, { fetch });
  assert.equal(await readFile(join(dir, "zosma-device-id.txt"), "utf-8"), first);
}));

test("startZosmaAuth throws and clears pending tx when the auth server errors", withPiDir(async (dir) => {
  const fetch = stubFetch(async () => new Response("nope", { status: 500 }));
  await assert.rejects(() => startZosmaAuth(dir, { fetch }), /Auth server returned 500/);
  assert.equal(await fileExists(join(dir, "zosma-auth-pending.json")), false);
}));

test("startZosmaAuth throws when authorization_url is missing", withPiDir(async (dir) => {
  const fetch = stubFetch(async () => Response.json({}));
  await assert.rejects(() => startZosmaAuth(dir, { fetch }), /missing authorization_url/);
}));

const okCatalog = [
  { id: "m-a", display_name: "Model A", context_window: 1000, max_tokens: 100, reasoning: true, input: ["text", "image"] },
  { id: "m-b", input_modalities: ["text"] },
];

function completeFetch() {
  return stubFetch(async (url) => {
    if (url.endsWith("/v1/cowork/token")) return Response.json({ access_token: "sk-new-key" });
    if (url.endsWith("/v1/models")) return Response.json({ data: okCatalog });
    throw new Error(`unexpected url ${url}`);
  });
}

function seedPending(dir, over = {}) {
  stateModule.savePending(
    { state: "s1", codeVerifier: "v1", deviceId: "cowork-d1", expiresAt: Date.now() + 600_000, ...over },
    dir,
  );
}

const recordingDeps = () => {
  const calls = { reload: 0, available: [] };
  const deps = {
    reload: async () => { calls.reload += 1; },
    getAvailable: async (providerId) => {
      calls.available.push(providerId);
      return [{ id: "m-a", provider: providerId }, { id: "m-b", provider: providerId }];
    },
    fetch: completeFetch(),
  };
  return { calls, deps };
};

test("completeZosmaAuth: happy path saves provider, reloads, verifies, returns result", withPiDir(async (dir) => {
  seedPending(dir);
  const { calls, deps } = recordingDeps();
  const res = await completeZosmaAuth("code1", "s1", dir, deps);
  assert.deepEqual(res, { providerId: "zosma-router", selectedModelId: "m-a", modelCount: 2 });
  assert.equal(calls.reload, 1);
  assert.deepEqual(calls.available, ["zosma-router"]);

  const models = JSON.parse(await readFile(join(dir, "models.json"), "utf-8"));
  const prov = models.providers["zosma-router"];
  assert.equal(prov.apiKey, "sk-new-key");
  assert.equal(prov.baseUrl, "https://router.zosma.ai/v1");
  assert.equal(prov.api, "openai-completions");
  assert.deepEqual(prov.models, [
    { id: "m-a", name: "Model A", contextWindow: 1000, maxTokens: 100, reasoning: true, input: ["text", "image"] },
    { id: "m-b", name: "m-b", reasoning: false, input: ["text"] },
  ]);
  // pending tx consumed
  assert.equal(await fileExists(join(dir, "zosma-auth-pending.json")), false);
}));

test("completeZosmaAuth: missing code or state throws", withPiDir(async (dir) => {
  seedPending(dir);
  const { deps } = recordingDeps();
  await assert.rejects(() => completeZosmaAuth("", "s1", dir, deps), /missing code or state/);
  await assert.rejects(() => completeZosmaAuth("c", "", dir, deps), /missing code or state/);
}));

test("completeZosmaAuth: no pending transaction throws", withPiDir(async (dir) => {
  const { deps } = recordingDeps();
  await assert.rejects(
    () => completeZosmaAuth("code1", "s1", dir, deps),
    /no pending auth transaction/,
  );
}));

test("completeZosmaAuth: state mismatch deletes pending tx and throws", withPiDir(async (dir) => {
  seedPending(dir);
  const { deps } = recordingDeps();
  await assert.rejects(() => completeZosmaAuth("code1", "WRONG", dir, deps), /state mismatch/);
  assert.equal(await fileExists(join(dir, "zosma-auth-pending.json")), false);
}));

test("completeZosmaAuth: token exchange 401 maps to friendly error", withPiDir(async (dir) => {
  seedPending(dir);
  const deps = {
    reload: async () => {},
    getAvailable: async () => [],
    fetch: stubFetch(async () => new Response("unauthorized", { status: 401 })),
  };
  await assert.rejects(() => completeZosmaAuth("code1", "s1", dir, deps), /code expired or already used/);
}));

test("completeZosmaAuth: empty catalog throws and saves nothing", withPiDir(async (dir) => {
  seedPending(dir);
  const deps = {
    reload: async () => {},
    getAvailable: async () => [],
    fetch: stubFetch(async (url) => {
      if (url.endsWith("/v1/cowork/token")) return Response.json({ access_token: "sk-x" });
      return Response.json({ data: [] });
    }),
  };
  await assert.rejects(() => completeZosmaAuth("code1", "s1", dir, deps), /no models entitled/);
  assert.equal(await fileExists(join(dir, "models.json")), false);
}));

test("completeZosmaAuth: verification failure rolls back the previous provider", withPiDir(async (dir) => {
  // Pre-existing provider entry that must survive the failed attempt.
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    join(dir, "models.json"),
    JSON.stringify({ providers: { "zosma-router": { id: "zosma-router", name: "Old", apiKey: "sk-old", models: [] } } }),
  );
  seedPending(dir);
  const deps = {
    reload: async () => {},
    getAvailable: async () => [{ id: "only-a", provider: "zosma-router" }], // m-b missing -> verify fails
    fetch: completeFetch(),
  };
  await assert.rejects(() => completeZosmaAuth("code1", "s1", dir, deps), /not found in registry/);
  const models = JSON.parse(await readFile(join(dir, "models.json"), "utf-8"));
  assert.equal(models.providers["zosma-router"].apiKey, "sk-old");
}));

test("completeZosmaAuth: verify failure with no previous provider deletes the new one", withPiDir(async (dir) => {
  seedPending(dir);
  const deps = {
    reload: async () => {},
    getAvailable: async () => [],
    fetch: completeFetch(),
  };
  await assert.rejects(() => completeZosmaAuth("code1", "s1", dir, deps), /not found in registry/);
  const models = JSON.parse(await readFile(join(dir, "models.json"), "utf-8"));
  assert.equal(models.providers["zosma-router"], undefined);
}));

test("disconnectZosmaAuth revokes server-side, deletes provider, reloads", withPiDir(async (dir) => {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(dir, "models.json"), JSON.stringify({
    providers: { "zosma-router": { id: "zosma-router", name: "Z", baseUrl: "https://router.zosma.ai/v1", apiKey: "sk-live", api: "openai-completions", models: [] } },
  }));
  const revokeCalls = [];
  const deps = {
    reload: async () => {},
    getAvailable: async () => [],
    fetch: stubFetch(async (url, init) => {
      revokeCalls.push([url, init.headers.Authorization]);
      return new Response("ok", { status: 200 });
    }),
  };
  await disconnectZosmaAuth(dir, deps);
  assert.equal(revokeCalls.length, 1);
  assert.match(revokeCalls[0][0], /\/v1\/cowork\/revoke$/);
  assert.equal(revokeCalls[0][1], "Bearer sk-live");
  const models = JSON.parse(await readFile(join(dir, "models.json"), "utf-8"));
  assert.equal(models.providers["zosma-router"], undefined);
}));

test("disconnectZosmaAuth proceeds locally when the revoke call fails", withPiDir(async (dir) => {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(dir, "models.json"), JSON.stringify({
    providers: { "zosma-router": { id: "zosma-router", apiKey: "sk-live", models: [] } },
  }));
  const deps = {
    reload: async () => {},
    getAvailable: async () => [],
    fetch: stubFetch(async () => new Response("boom", { status: 500 })),
  };
  await disconnectZosmaAuth(dir, deps); // must not throw
  const models = JSON.parse(await readFile(join(dir, "models.json"), "utf-8"));
  assert.equal(models.providers["zosma-router"], undefined);
}));

test("cancelZosmaAuth deletes the pending tx only", withPiDir(async (dir) => {
  seedPending(dir);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(dir, "models.json"), JSON.stringify({
    providers: { "zosma-router": { id: "zosma-router", apiKey: "sk-live", models: [] } },
  }));
  await cancelZosmaAuth(dir);
  assert.equal(await fileExists(join(dir, "zosma-auth-pending.json")), false);
  const models = JSON.parse(await readFile(join(dir, "models.json"), "utf-8"));
  assert.ok(models.providers["zosma-router"]); // provider untouched
}));

test("refreshZosmaModels re-fetches the catalog with the existing key", withPiDir(async (dir) => {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(dir, "models.json"), JSON.stringify({
    providers: { "zosma-router": { id: "zosma-router", name: "Z", baseUrl: "https://router.zosma.ai/v1", apiKey: "sk-live", api: "openai-completions", models: [{ id: "old" }] } },
  }));
  const deps = {
    reload: async () => {},
    getAvailable: async (pid) => [{ id: "new-1", provider: pid }],
    fetch: stubFetch(async (url) => {
      if (!url.endsWith("/v1/models")) throw new Error(`unexpected ${url}`);
      return Response.json({ data: [{ id: "new-1", display_name: "New 1" }] });
    }),
  };
  const res = await refreshZosmaModels(dir, deps);
  assert.deepEqual(res, { modelCount: 1, selectedModelId: "new-1" });
  const models = JSON.parse(await readFile(join(dir, "models.json"), "utf-8"));
  assert.equal(models.providers["zosma-router"].apiKey, "sk-live"); // key unchanged
  assert.equal(models.providers["zosma-router"].models.length, 1);
  assert.equal(models.providers["zosma-router"].models[0].id, "new-1");
}));

test("refreshZosmaModels throws when not configured", withPiDir(async (dir) => {
  const deps = {
    reload: async () => {},
    getAvailable: async () => [],
    fetch: stubFetch(async () => Response.json({ data: [] })),
  };
  await assert.rejects(() => refreshZosmaModels(dir, deps), /not configured/);
}));

test("getZosmaStatus reports configured/pending/model count", withPiDir(async (dir) => {
  seedPending(dir);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(dir, "models.json"), JSON.stringify({
    providers: { "zosma-router": { id: "zosma-router", baseUrl: "https://router.zosma.ai/v1", apiKey: "sk", models: [{ id: "a" }, { id: "b" }] } },
  }));
  const status = getZosmaStatus(dir);
  assert.equal(status.configured, true);
  assert.equal(status.pending, true);
  assert.equal(status.modelCount, 2);
  assert.equal(status.baseUrl, "https://router.zosma.ai/v1");
  assert.equal(status.authBaseUrl, "https://auth.zosma.ai");
}));

test("getZosmaStatus is clean when nothing is set up", withPiDir(async (dir) => {
  const status = getZosmaStatus(dir);
  assert.deepEqual(status, {
    configured: false,
    pending: false,
    modelCount: 0,
    baseUrl: null,
    authBaseUrl: "https://auth.zosma.ai",
    routerBaseUrl: "https://router.zosma.ai/v1",
  });
}));

test("authenticateWithKey saves a fresh key and its catalog", withPiDir(async (dir) => {
  const deps = {
    reload: async () => {},
    getAvailable: async (pid) => [{ id: "k1", provider: pid }],
    fetch: stubFetch(async (url) => {
      if (!String(url).endsWith("/v1/models")) throw new Error(`unexpected ${url}`);
      return Response.json({ data: [{ id: "k1", display_name: "K1" }] });
    }),
  };
  const res = await authenticateWithKey("  sk-pasted  ", dir, deps);
  assert.deepEqual(res, { providerId: "zosma-router", selectedModelId: "k1", modelCount: 1 });
  const models = JSON.parse(await readFile(join(dir, "models.json"), "utf-8"));
  assert.equal(models.providers["zosma-router"].apiKey, "sk-pasted");
}));

test("authenticateWithKey rolls back on verification failure", withPiDir(async (dir) => {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(dir, "models.json"), JSON.stringify({
    providers: { "zosma-router": { id: "zosma-router", name: "Old", apiKey: "sk-old", models: [] } },
  }));
  const deps = {
    reload: async () => {},
    getAvailable: async () => [],
    fetch: stubFetch(async () => Response.json({ data: [{ id: "k1" }] })),
  };
  await assert.rejects(() => authenticateWithKey("sk-new", dir, deps), /not found in registry/);
  const models = JSON.parse(await readFile(join(dir, "models.json"), "utf-8"));
  assert.equal(models.providers["zosma-router"].apiKey, "sk-old");
}));
