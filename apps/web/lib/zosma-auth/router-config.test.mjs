import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const {
  DEFAULT_AUTH_BASE_URL,
  DEFAULT_ROUTER_BASE_URL,
  validateRouterConfig,
  resolveRouterConfig,
  saveRouterConfig,
  loadPersistedRouterConfig,
} = await jiti.import("./router-config.ts");

test("defaults point at auth/router hosts", () => {
  assert.equal(DEFAULT_AUTH_BASE_URL, "https://auth.zosma.ai");
  assert.equal(DEFAULT_ROUTER_BASE_URL, "https://router.zosma.ai/v1");
});

test("validateRouterConfig accepts the default https pair", () => {
  const cfg = validateRouterConfig({
    authBaseUrl: "https://router.zosma.ai",
    routerBaseUrl: "https://router.zosma.ai/v1",
  });
  assert.deepEqual(cfg, {
    authBaseUrl: "https://router.zosma.ai",
    routerBaseUrl: "https://router.zosma.ai/v1",
  });
});

test("validateRouterConfig trims trailing slashes", () => {
  const cfg = validateRouterConfig({
    authBaseUrl: "https://router.zosma.ai///",
    routerBaseUrl: "https://router.zosma.ai/v1/",
  });
  assert.deepEqual(cfg, {
    authBaseUrl: "https://router.zosma.ai",
    routerBaseUrl: "https://router.zosma.ai/v1",
  });
});

test("validateRouterConfig allows http only for loopback", () => {
  assert.deepEqual(
    validateRouterConfig({ authBaseUrl: "http://127.0.0.1:8080", routerBaseUrl: "http://127.0.0.1:8080/v1" }),
    { authBaseUrl: "http://127.0.0.1:8080", routerBaseUrl: "http://127.0.0.1:8080/v1" },
  );
  assert.throws(
    () => validateRouterConfig({ authBaseUrl: "http://router.example.com", routerBaseUrl: "http://router.example.com/v1" }),
    /must use HTTPS/,
  );
});

test("validateRouterConfig enforces exact base paths", () => {
  assert.throws(
    () => validateRouterConfig({ authBaseUrl: "https://router.zosma.ai/v1", routerBaseUrl: "https://router.zosma.ai/v1" }),
    /authBaseUrl must be a base URL with path \//,
  );
  assert.throws(
    () => validateRouterConfig({ authBaseUrl: "https://router.zosma.ai", routerBaseUrl: "https://router.zosma.ai" }),
    /routerBaseUrl must be a base URL with path \/v1/,
  );
  assert.throws(
    () => validateRouterConfig({ authBaseUrl: "https://router.zosma.ai?x=1", routerBaseUrl: "https://router.zosma.ai/v1" }),
    /must be a base URL/,
  );
});

test("validateRouterConfig requires matching protocols", () => {
  assert.throws(
    () => validateRouterConfig({ authBaseUrl: "https://router.zosma.ai", routerBaseUrl: "http://127.0.0.1/v1" }),
    /same protocol/,
  );
});

test("resolveRouterConfig falls back to defaults with empty env and no file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zosma-rc-"));
  try {
    assert.deepEqual(
      resolveRouterConfig(dir, {}),
      { authBaseUrl: DEFAULT_AUTH_BASE_URL, routerBaseUrl: DEFAULT_ROUTER_BASE_URL },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveRouterConfig: env wins over file and defaults", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zosma-rc-"));
  try {
    saveRouterConfig(dir, { authBaseUrl: "http://127.0.0.1:9000", routerBaseUrl: "http://127.0.0.1:9000/v1" });
    const cfg = resolveRouterConfig(dir, {
      ZOSMA_AUTH_BASE_URL: "http://127.0.0.1:7000",
      ZOSMA_ROUTER_BASE_URL: "http://127.0.0.1:7000/v1",
    });
    assert.deepEqual(cfg, { authBaseUrl: "http://127.0.0.1:7000", routerBaseUrl: "http://127.0.0.1:7000/v1" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("save + loadPersistedRouterConfig roundtrips", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zosma-rc-"));
  try {
    const saved = saveRouterConfig(dir, {
      authBaseUrl: "https://self.example.com",
      routerBaseUrl: "https://self.example.com/v1",
    });
    assert.deepEqual(loadPersistedRouterConfig(dir), saved);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadPersistedRouterConfig throws on corrupt JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "zosma-rc-"));
  try {
    await writeFile(join(dir, "zosma-router-config.json"), "{corrupt");
    assert.throws(() => loadPersistedRouterConfig(dir), /invalid JSON/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
