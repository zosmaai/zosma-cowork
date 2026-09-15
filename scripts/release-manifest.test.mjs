import assert from "node:assert/strict";
import test from "node:test";
import {
  createInstallManifest,
  createSha256Sums,
  stampCli,
} from "./release-manifest.mjs";

const VERSION = "v1.2.3-e2e.7";
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const IMAGE = `ghcr.io/zosmaai/zosma-cowork@sha256:${DIGEST_A}`;

function releaseAssets() {
  const base = `https://github.com/zosmaai/zosma-cowork/releases/download/${VERSION}`;
  return {
    cli: { url: `${base}/zosma-${VERSION}`, digest: DIGEST_A },
    archives: {
      "linux-x64": { url: `${base}/zosma-cowork-server-${VERSION}-linux-x64.tar.gz`, digest: DIGEST_B },
      "linux-arm64": { url: `${base}/zosma-cowork-server-${VERSION}-linux-arm64.tar.gz`, digest: DIGEST_A },
      "darwin-x64": { url: `${base}/zosma-cowork-server-${VERSION}-darwin-x64.tar.gz`, digest: DIGEST_B },
      "darwin-arm64": { url: `${base}/zosma-cowork-server-${VERSION}-darwin-arm64.tar.gz`, digest: DIGEST_A },
    },
    dockerImage: IMAGE,
    sumsUrl: `${base}/SHA256SUMS`,
  };
}

test("stamps exactly one development CLI version assignment", () => {
  const source = "#!/bin/sh\nZOSMA_CLI_VERSION=v0.0.0-dev\nmain \"$@\"\n";
  assert.equal(
    stampCli(source, VERSION),
    `#!/bin/sh\nZOSMA_CLI_VERSION=${VERSION}\nmain \"$@\"\n`,
  );
  assert.throws(() => stampCli(source.replace("ZOSMA_CLI_VERSION=v0.0.0-dev", ""), VERSION), /exactly one/);
  assert.throws(() => stampCli(`${source}ZOSMA_CLI_VERSION=v0.0.0-dev\n`, VERSION), /exactly one/);
});

test("creates deterministic checksum lines and rejects duplicate names", () => {
  assert.equal(
    createSha256Sums([
      { name: "zosma-v1.2.3", digest: DIGEST_A },
      { name: "server.tar.gz", digest: DIGEST_B },
    ]),
    `${DIGEST_A}  zosma-v1.2.3\n${DIGEST_B}  server.tar.gz\n`,
  );
  assert.throws(
    () => createSha256Sums([{ name: "same", digest: DIGEST_A }, { name: "same", digest: DIGEST_B }]),
    /duplicate checksum filename/,
  );
  assert.throws(() => createSha256Sums([{ name: "bad", digest: "not-a-digest" }]), /invalid SHA-256 digest/);
});

test("creates the canonical fixed-order install manifest", () => {
  const assets = releaseAssets();
  assert.equal(
    createInstallManifest({ version: VERSION, ...assets }),
    [
      "installer_schema=1",
      `version=${VERSION}`,
      `sha256sums_url=${assets.sumsUrl}`,
      `cli_url=${assets.cli.url}`,
      `cli_sha256=${DIGEST_A}`,
      ...["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64"].flatMap((target) => [
        `archive_${target}_url=${assets.archives[target].url}`,
        `archive_${target}_sha256=${assets.archives[target].digest}`,
      ]),
      `docker_image=${IMAGE}`,
      "",
    ].join("\n"),
  );
});

test("rejects incomplete, insecure, mismatched, and malformed release assets", () => {
  const assets = releaseAssets();
  assert.throws(() => createInstallManifest({ version: VERSION, ...assets, dockerImage: "latest" }), /Docker image digest/);
  assert.throws(() => createInstallManifest({ version: VERSION, ...assets, sumsUrl: "http://example.test/SHA256SUMS" }), /HTTPS/);
  assert.throws(() => createInstallManifest({ version: VERSION, ...assets, cli: { ...assets.cli, url: `${assets.cli.url}-wrong` } }), /CLI URL basename/);
  const incomplete = { ...assets, archives: { ...assets.archives } };
  delete incomplete.archives["darwin-arm64"];
  assert.throws(() => createInstallManifest({ version: VERSION, ...incomplete }), /archive target/);
});
