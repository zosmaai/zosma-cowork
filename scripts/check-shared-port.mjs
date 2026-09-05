#!/usr/bin/env node
// CI guard: the port contract between the shell and the web UI.
// SHARED_PORT (src-tauri/src/lib.rs) and the `next` scripts (web/package.json)
// must agree on one port. Fails the build if they diverge.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const libRs = readFileSync(join(root, "src-tauri/src/lib.rs"), "utf8");
const pkg = JSON.parse(readFileSync(join(root, "web/package.json"), "utf8"));

const m = libRs.match(/SHARED_PORT:\s*u16\s*=\s*(\d+)/);
if (!m) {
  console.error("SHARED_PORT not found in src-tauri/src/lib.rs");
  process.exit(1);
}
const port = m[1];

const offenders = Object.entries(pkg.scripts ?? {}).filter(
  ([name, script]) => typeof script === "string" && /(^|\s)-p\s+(\d+)/.test(script)
    && !new RegExp(`(^|\\s)-p\\s+${port}(\\s|$)`).test(script),
);

if (offenders.length > 0) {
  for (const [name, script] of offenders) {
    console.error(`web script "${name}" uses a different port: ${script}`);
  }
  console.error(`expected all scripts to use port ${port} (SHARED_PORT)`);
  process.exit(1);
}

console.log(`port contract OK: ${port}`);