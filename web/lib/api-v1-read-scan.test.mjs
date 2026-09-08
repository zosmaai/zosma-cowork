import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";

const webRoot = fileURLToPath(new URL("../", import.meta.url));

const BROWSER_FILES = [
  "components/AppShell.tsx",
  "components/SessionSidebar.tsx",
  "components/ChatWindow.tsx",
  "components/MessageView.tsx",
  "hooks/useAgentSession.ts",
];

// One pattern per *migrated read*. Mutations/streams still use legacy URLs and
// must NOT match: /api/sessions/${id}/auto-name, /export, PATCH/DELETE
// fetches, the EventSource /events URL, /bash-output, the /api/agent/new POST.
const LEGACY_READ_PATTERNS = [
  /fetch\(["'`]\/api\/sessions(?=["'`?])/,                              // session list
  /fetch\(["'`]\/api\/sessions\/\$\{encodeURIComponent\([^)]*\)\}\/?\?/, // session detail (any ?-query)
  /\/api\/sessions\/\$\{encodeURIComponent\([^)]*\)\}\/context\?/,        // context
  /\/api\/sessions\/\$\{encodeURIComponent\([^)]*\)\}\/entries\/\$\{encodeURIComponent\([^)]*\)\}\/thinking/, // thinking
  /fetch\(["'`]\/api\/agent\/running/,               // running snapshot
  /fetch\(\s*["'`]\/api\/agent\/\$\{encodeURIComponent\([^)]*\)\}\)(?!\/)/, // bare agent state GET
  /fetch\(["'`]\/api\/models(?=["'`?])/,             // model list
];

test("migrated browser reads never revert to legacy URLs", async () => {
  for (const file of BROWSER_FILES) {
    const source = await readFile(join(webRoot, file), "utf8");
    for (const pattern of LEGACY_READ_PATTERNS) {
      assert.doesNotMatch(source, pattern, `${file} ${pattern}`);
    }
  }
});

test("migrated browser reads are served by the v1 client", async () => {
  for (const file of BROWSER_FILES) {
    const source = await readFile(join(webRoot, file), "utf8");
    assert.match(source, /from ["'`]@\/lib\/api-v1-client["'`]/, file);
  }
  const clientSource = await readFile(join(webRoot, "lib", "api-v1-client.ts"), "utf8");
  assert.doesNotMatch(clientSource, /\/api\/(?!\/v1)\//); // no legacy path inside the v1 client
});
