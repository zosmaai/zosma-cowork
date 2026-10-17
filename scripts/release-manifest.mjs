const TARGETS = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64"];
const VERSION_RE = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const DIGEST_RE = /^[a-f0-9]{64}$/;
const DEV_ASSIGNMENT = "ZOSMA_CLI_VERSION=v0.0.0-dev";

export { TARGETS };

function fail(message) {
  throw new Error(`release manifest: ${message}`);
}

function assertVersion(version) {
  if (!VERSION_RE.test(version)) fail("version must be a v-prefixed semantic version");
}

function assertDigest(digest, label) {
  if (!DIGEST_RE.test(digest)) fail(`invalid SHA-256 digest for ${label}`);
}

function assertHttpsUrl(url, label) {
  try {
    if (new URL(url).protocol !== "https:") throw new Error();
  } catch {
    fail(`${label} URL must use HTTPS`);
  }
}

function assertAssetUrl(url, expectedBasename, label) {
  assertHttpsUrl(url, label);
  if (new URL(url).pathname.split("/").at(-1) !== expectedBasename) {
    fail(`${label} URL basename must be ${expectedBasename}`);
  }
}

export function stampCli(source, version) {
  assertVersion(version);
  const matches = source.match(/^ZOSMA_CLI_VERSION=v0\.0\.0-dev$/gmu) ?? [];
  if (matches.length !== 1) fail("CLI must contain exactly one development version assignment");
  return source.replace(DEV_ASSIGNMENT, `ZOSMA_CLI_VERSION=${version}`);
}

export function createSha256Sums(entries) {
  const seen = new Set();
  return entries.map(({ name, digest }) => {
    if (!name || /[\r\n\s]/u.test(name)) fail(`invalid checksum filename: ${name}`);
    if (seen.has(name)) fail(`duplicate checksum filename: ${name}`);
    seen.add(name);
    assertDigest(digest, name);
    return `${digest}  ${name}`;
  }).join("\n") + "\n";
}

export function createInstallManifest({
  version,
  sumsUrl,
  cli,
  archives,
  dockerImage,
}) {
  assertVersion(version);
  assertAssetUrl(sumsUrl, "SHA256SUMS", "SHA256SUMS");
  if (!cli || typeof cli !== "object") fail("CLI asset is required");
  assertAssetUrl(cli.url, `zosma-${version}`, "CLI");
  assertDigest(cli.digest, "CLI");
  if (!archives || typeof archives !== "object") fail("archive targets are required");

  const lines = [
    "installer_schema=1",
    `version=${version}`,
    `sha256sums_url=${sumsUrl}`,
    `cli_url=${cli.url}`,
    `cli_sha256=${cli.digest}`,
  ];
  for (const target of TARGETS) {
    const archive = archives[target];
    if (!archive || typeof archive !== "object") fail(`archive target is missing: ${target}`);
    const expectedName = `zosma-cowork-server-${version}-${target}.tar.gz`;
    assertAssetUrl(archive.url, expectedName, `archive ${target}`);
    assertDigest(archive.digest, `archive ${target}`);
    lines.push(`archive_${target}_url=${archive.url}`);
    lines.push(`archive_${target}_sha256=${archive.digest}`);
  }
  if (typeof dockerImage !== "string") fail("Docker image digest is required");
  const imageDigest = dockerImage.replace("ghcr.io/zosmaai/zosma-cowork@sha256:", "");
  if (!dockerImage.startsWith("ghcr.io/zosmaai/zosma-cowork@sha256:") || !DIGEST_RE.test(imageDigest)) {
    fail("Docker image digest must be a pinned GHCR SHA-256 reference");
  }
  lines.push(`docker_image=${dockerImage}`);
  return `${lines.join("\n")}\n`;
}
