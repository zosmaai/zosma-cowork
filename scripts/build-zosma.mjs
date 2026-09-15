#!/usr/bin/env node
import {
  chmodSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE_DIR = join(REPO_ROOT, "scripts", "zosma-src");
export const ARTIFACT_PATH = join(REPO_ROOT, "scripts", "zosma");

export const FRAGMENT_NAMES = [
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
];

function fail(message) {
  throw new Error(`installer assembly: ${message}`);
}

export function assembleFragments(sourceDir, fragmentNames = FRAGMENT_NAMES) {
  const seen = new Set();
  const fragments = [];
  for (const name of fragmentNames) {
    if (seen.has(name)) fail(`duplicate fragment: ${name}`);
    seen.add(name);
    const path = join(sourceDir, name);
    if (!existsSync(path)) fail(`missing fragment: ${name}`);
    const source = readFileSync(path, "utf8");
    if (!source.trim()) fail(`empty fragment: ${name}`);
    fragments.push(source.replace(/\n+$/u, ""));
  }
  return `${fragments.join("\n")}\n`;
}

export function validateArtifact(source) {
  if (!source.startsWith("#!/bin/sh\n")) fail("artifact must start with #!/bin/sh");
  const versionAssignments = source.match(/^ZOSMA_CLI_VERSION=v0\.0\.0-dev$/gmu) ?? [];
  if (versionAssignments.length !== 1) {
    fail("artifact must contain exactly one ZOSMA_CLI_VERSION assignment");
  }
  const finalInvocations = source.match(/^\s*main "[$]@"$/gmu) ?? [];
  if (finalInvocations.length !== 1 || !/\n\s+main "[$]@"\nfi\n$/u.test(source)) {
    fail("artifact must contain exactly one final main invocation");
  }
  return source;
}

export function buildArtifact({ sourceDir = SOURCE_DIR, artifactPath = ARTIFACT_PATH } = {}) {
  const source = validateArtifact(assembleFragments(sourceDir));
  writeFileSync(artifactPath, source, { mode: 0o755 });
  chmodSync(artifactPath, 0o755);
  return source;
}

export function checkArtifact({ sourceDir = SOURCE_DIR, artifactPath = ARTIFACT_PATH } = {}) {
  const expected = validateArtifact(assembleFragments(sourceDir));
  if (!existsSync(artifactPath)) fail(`generated artifact is missing: ${artifactPath}`);
  const actual = readFileSync(artifactPath, "utf8");
  if (actual !== expected) fail(`generated artifact is stale: ${artifactPath}`);
  return true;
}

function main(argv) {
  const check = argv.includes("--check");
  if (check) {
    checkArtifact();
    process.stdout.write(`${ARTIFACT_PATH} is up to date\n`);
    return;
  }
  buildArtifact();
  process.stdout.write(`${ARTIFACT_PATH}\n`);
}

const invokedDirectly = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
