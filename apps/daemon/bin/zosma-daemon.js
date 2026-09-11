#!/usr/bin/env node
// Thin launcher so `zosma-daemon` can run the TypeScript source directly under
// Node's type stripping (see package.json scripts / node engines).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const result = spawnSync(process.execPath, ["--experimental-strip-types", entry], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
