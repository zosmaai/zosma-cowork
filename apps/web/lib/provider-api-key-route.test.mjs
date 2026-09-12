import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("API key saves relay to the daemon login op", async () => {
  const source = await readFile(new URL("../app/api/auth/api-key/[provider]/route.ts", import.meta.url), "utf-8");

  // The API-key login (ModelRuntime + credential persistence) moved to the
  // daemon: the route relays to auth:api-key-login and busts the model cache.
  assert.doesNotMatch(source, /ModelRuntime|modelRuntime/);
  assert.doesNotMatch(source, /apiKeyAuth\.login\(/);
  assert.doesNotMatch(source, /storeProviderCredential/);
  assert.match(source, /piAuth\("api-key-login", \{ provider, apiKey: apiKey\.trim\(\) \}\)/);
  assert.match(source, /invalidateModelsCache\(\)/);
});