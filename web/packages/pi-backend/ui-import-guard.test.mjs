import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ZOS-83: no-UI-import guard for agent-runtime code.
//
// The transport-neutral /api/v1 boundary must never import web-UI modules
// (components, app, @/ui, etc.). A stray import silently couples the backend
// to the UI host. This scan is the durable protection until the monorepo split:
// it walks pi-backend source + v1 route source and fails (reporting file:line)
// if any import targets a UI module, so the CI `test` check catches the
// regression instead of silent coupling.
const ROOT = process.cwd();
const SCAN_DIRS = ["packages/pi-backend", "app/api/v1"];
const UI_DIRS = new Set([
  "components", "ui", "widgets", "app", "web", "screens", "pages", "hooks",
]);
const UI_PKGS = new Set(["react", "react-dom", "lucide-react"]);

function collect(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

// Flag a module specifier only when it targets a UI module. Transport-neutral
// SDK deps (@earendil-works/*), node:, and the ../../lib/* helpers (file-access,
// project-trust, npx, skills-service, etc.) are explicitly allowed.
function isUiImport(spec) {
  if (spec.startsWith("@earendil-works/")) return false; // transport-neutral SDK
  if (spec.startsWith("node:")) return false;
  if (spec.startsWith("/") && !spec.startsWith("@")) return false; // absolute
  if (spec === "react" || spec === "react-dom" || spec === "lucide-react") return true;
  if (/\.tsx$/.test(spec)) return true;
  const segments = spec.split("/").filter(Boolean);
  return segments.some((s) => UI_DIRS.has(s));
}

const fromRe = /\bfrom\s+['"]([^'"]+)['"]/g;

test("pi-backend + v1 route source never imports a UI module", () => {
  const violations = [];
  for (const dir of SCAN_DIRS) {
    for (const file of collect(join(ROOT, dir))) {
      const src = readFileSync(file, "utf8");
      fromRe.lastIndex = 0;
      let m;
      while ((m = fromRe.exec(src)) !== null) {
        const spec = m[1];
        if (isUiImport(spec)) {
          const line = src.slice(0, m.index).split("\n").length;
          violations.push(`${file}:${line}  import from "${spec}"`);
        }
      }
    }
  }
  assert.equal(violations.length, 0, `UI import guard found ${violations.length} violation(s):\n${violations.join("\n")}`);
});
