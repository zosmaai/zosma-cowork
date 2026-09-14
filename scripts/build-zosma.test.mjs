import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assembleFragments,
  FRAGMENT_NAMES,
  validateArtifact,
} from "./build-zosma.mjs";

test("defines the complete ordered source fragment list", () => {
  assert.deepEqual(FRAGMENT_NAMES, [
    "00-preamble.sh",
    "10-output-validation.sh",
    "20-paths-config.sh",
    "30-manifest.sh",
    "40-files-generations.sh",
    "50-transactions.sh",
    "60-platform-services.sh",
    "65-terminal-platform.sh",
    "70-install-local.sh",
    "75-install-docker.sh",
    "80-lifecycle.sh",
    "90-update-uninstall.sh",
    "99-main.sh",
  ]);
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "zosma-assembler-test-"));
  return {
    root,
    write(name, content) {
      writeFileSync(join(root, name), content);
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("assembles fragments in the supplied order with one newline boundary", () => {
  const f = fixture();
  try {
    f.write("10-first.sh", "first\n");
    f.write("20-second.sh", "second\n");
    assert.equal(
      assembleFragments(f.root, ["10-first.sh", "20-second.sh"]),
      "first\nsecond\n",
    );
  } finally {
    f.cleanup();
  }
});

test("rejects missing, duplicate, and empty fragments", () => {
  const f = fixture();
  try {
    f.write("10-first.sh", "first\n");
    assert.throws(
      () => assembleFragments(f.root, ["10-first.sh", "missing.sh"]),
      /missing fragment: missing\.sh/,
    );
    assert.throws(
      () => assembleFragments(f.root, ["10-first.sh", "10-first.sh"]),
      /duplicate fragment: 10-first\.sh/,
    );
    f.write("20-empty.sh", "\n");
    assert.throws(
      () => assembleFragments(f.root, ["20-empty.sh"]),
      /empty fragment: 20-empty\.sh/,
    );
  } finally {
    f.cleanup();
  }
});

test("validates the standalone artifact contract", () => {
  const valid = [
    "#!/bin/sh\n",
    "ZOSMA_CLI_VERSION=v0.0.0-dev\n",
    "set -eu\n",
    "main() { :; }\n",
    "if :; then\n",
    "  :\n",
    "else\n",
    "  main \"$@\"\n",
    "fi\n",
  ].join("");
  assert.doesNotThrow(() => validateArtifact(valid));
  assert.throws(
    () => validateArtifact(valid.replace("ZOSMA_CLI_VERSION=v0.0.0-dev\n", "")),
    /exactly one ZOSMA_CLI_VERSION assignment/,
  );
  assert.throws(
    () => validateArtifact(valid.replace('  main \"$@\"\n', '  main \"$@\"\n  main \"$@\"\n')),
    /exactly one final main invocation/,
  );
});
