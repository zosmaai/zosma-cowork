import assert from "node:assert/strict";
import test from "node:test";
import { createV1Jiti } from "../../app/api/v1/test-helper.mjs";

// jiti loads the sibling .ts module (bare extensionless import won't resolve
// under --experimental-strip-types).
const jiti = createV1Jiti();
const svc = await jiti.import(new URL("./skills.ts", import.meta.url).href);
const { parseSearchOutput, parseInstallCount, formatInstalls } = svc;

test("parseSearchOutput parses package+installs lines and follows url lines", () => {
  const raw = [
    "acme/a 12.3K installs",
    "└ https://skills.sh/acme/a",
    "acme/b 8 installs",
    "└ https://skills.sh/acme/b",
    "noise — not a match",
  ].join("\n");
  const results = parseSearchOutput(raw);
  assert.equal(results.length, 2);
  assert.deepEqual(results[0], {
    package: "acme/a",
    installs: "12.3K installs",
    url: "https://skills.sh/acme/a",
  });
  assert.deepEqual(results[1], {
    package: "acme/b",
    installs: "8 installs",
    url: "https://skills.sh/acme/b",
  });
});

test("parseSearchOutput strips ANSI before matching", () => {
  const raw = "acme/c \x1b[32m5 installs\x1b[0m\n";
  assert.deepEqual(parseSearchOutput(raw), [
    { package: "acme/c", installs: "5 installs", url: "" },
  ]);
});

test("parseInstallCount decodes KMB install suffixes", () => {
  assert.equal(parseInstallCount("1 installs"), 1);
  assert.equal(parseInstallCount("1.5K installs"), 1500);
  assert.equal(parseInstallCount("2.0M installs"), 2_000_000);
  assert.equal(parseInstallCount("3B installs"), 3_000_000_000);
});

test("formatInstalls rounds to the human scale", () => {
  assert.equal(formatInstalls(0), "");
  assert.equal(formatInstalls(1), "1 install");
  assert.equal(formatInstalls(1500), "1.5K installs");
  assert.equal(formatInstalls(1_000_000), "1M installs");
});
