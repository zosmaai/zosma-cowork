import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const webRoot = fileURLToPath(new URL("../", import.meta.url));


async function sourceFiles(directory) {
  const root = join(webRoot, directory);
  const entries = await readdir(root, { recursive: true });
  return Promise.all(
    entries
      .filter((entry) => entry.endsWith(".ts") || entry.endsWith(".tsx"))
      .map(async (entry) => ({
        path: join(directory, entry),
        source: await readFile(join(root, entry), "utf8"),
      })),
  );
}

test("pi backend host is server-only and owns one hot-reload-stable instance", async () => {
  const source = await readFile(new URL("./pi-backend-host.ts", import.meta.url), "utf8");

  assert.match(source, /^import "server-only";/);
  assert.match(source, /globalThis\.__piBackend \?\?= createPiBackend\(/);
  assert.match(source, /process\.env\.NEXT_PUBLIC_PI_VERSION \?\? "unknown"/);
});

test("browser modules do not import the server-only backend host", async () => {
  for (const { path, source } of [
    ...await sourceFiles("components"),
    ...await sourceFiles("hooks"),
  ]) {
    assert.doesNotMatch(source, /pi-backend-host/, path);
  }
});
