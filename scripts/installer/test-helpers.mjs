#!/usr/bin/env node
// Isolated shell test harness for the zosma installer and CLI.
//
// Every test runs the POSIX scripts under a private temporary root with:
//   - a curated fake PATH containing only safe host utilities and mandatory
//     fail-closed stubs for hazardous commands (no /usr/bin:/bin fallback);
//   - a fake `rm` that refuses every target outside the harness root;
//   - instrumented stub logging of argv and a whitelisted env subset;
//   - generated fixture manifests, SHA256SUMS files, CLI candidates, and
//     local server archives;
//   - an optional guarded test TTY under ZOSMA_TEST_TTY (in/out files).
//
// Tests never contact a network endpoint, a real Docker daemon, a systemd
// user manager, a launchd domain, or a browser.

import { spawnSync, spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
export const ZOSMA = join(REPO_ROOT, "scripts", "zosma");
export const INSTALL_SH = join(REPO_ROOT, "install.sh");
export const SH = "/bin/sh";

export const VERSION_RE = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

// Utilities symlinked from the host into the curated fake PATH (no fallback).
const SAFE_UTILS = [
  "sh", "cat", "mv", "cp", "mkdir", "rmdir", "touch", "ln", "chmod", "tar",
  "mktemp", "sha256sum", "shasum", "sed", "grep", "head", "tail", "wc", "cut",
  "tr", "dd", "od", "printf", "echo", "sleep", "kill", "basename", "dirname",
  "readlink", "sort", "find", "date", "env", "id", "mkfifo", "ls", "ps", "gzip", "gunzip",
];

// Hazardous commands are mandatory stubs that never delegate to the host.
const HAZARDOUS = ["curl", "docker", "systemctl", "launchctl", "open", "xdg-open"];

// Probe commands are stubs that pass through to the real host binary unless a
// test writes a per-command plan file.
const OVERRIDABLE = ["getconf", "ldd", "sw_vers", "uname", "hostname", "git"];

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function randomHex(length) {
  const bytes = [...new Array(Math.ceil(length / 2))].map(() =>
    Math.floor(Math.random() * 256));
  return Buffer.from(bytes).toString("hex").slice(0, length);
}

export function digestRef(hex = "a".repeat(64)) {
  return `ghcr.io/zosmaai/zosma-cowork@sha256:${hex}`;
}

function quote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

const ENVLOG_GREP = [
  "^HOME=", "^XDG_DATA_HOME=", "^XDG_CONFIG_HOME=", "^XDG_STATE_HOME=",
  "^XDG_CACHE_HOME=", "^PI_CODING_AGENT_DIR=", "^PATH=", "^PWD=",
].map((p) => `-e ${quote(p)}`).join(" ");

function stubSource(name, root, { realPath, body }) {
  const cmdLog = quote(join(root, "logs", "cmd.log"));
  const plan = quote(join(root, "stubs", `${name}.sh`));
  const passThrough = realPath ? `exec ${quote(realPath)} "$@"` : "exit 0";
  const lines = [
    "#!/bin/sh",
    "# harness-generated stub: " + name,
    "{",
    "  printf '%s\\n' '% " + name + "'",
    '  for a in "$@"; do printf \'%s\\n\' "$a"; done',
    "  printf '%s\\n' '% end'",
    "} >> " + cmdLog,
    'if [ -n "$ZOSMA_ENVLOG_FILE" ]; then',
    "  {",
    "    env | grep " + ENVLOG_GREP + " | sort",
    '  } >> "$ZOSMA_ENVLOG_FILE"',
    "fi",
    "PLAN=" + plan,
    'if [ -f "$PLAN" ]; then',
    '  . "$PLAN"',
    "  exit $?",
    "fi",
    body ?? passThrough,
  ];
  return lines.join("\n") + "\n";
}

function curlFixtureBody(root, fixtureDir) {
  return [
    'url=""; out=""; prev=""'
    ,'for a in "$@"; do'
    ,'  if [ "$prev" = "-o" ]; then out="$a"; prev=""; continue; fi'
    ,'  case "$a" in'
    ,'    -o) prev="-o" ;;'
    ,'    -*) : ;;'
    ,'    *) url="$a" ;;'
    ,'  esac'
    ,'done'
    ,'emit() { if [ -n "$out" ]; then cat > "$out"; else cat; fi; }'
    ,'serve_basename() {'
    ,'  b=$(basename "$url")'
    ,'  f="$ZOSMA_FIXTURE_DIR/$b"'
    ,'  if [ -f "$f" ]; then'
    ,'    if [ -n "$out" ]; then cat "$f" > "$out"; else cat "$f"; fi'
    ,'    return 0'
    ,'  fi'
    ,'  printf "curl: fixture not found: %s\\n" "$b" >&2'
    ,'  return 1'
    ,'}'
    ,'case "$url" in'
    ,'  file://*)'
    ,"    p=$(printf '%s\\n' \"$url\" | sed 's|^file://||')"
    ,'    if [ -f "$p" ]; then cat "$p" | emit; exit 0; fi'
    ,'    ;;'
    ,'  https://github.com/zosmaai/zosma-cowork/releases/download/*)'
    ,'    serve_basename || exit 22'
    ,'    exit 0'
    ,'    ;;'
    ,'  https://install.zosma.ai/*)'
    ,'    serve_basename || exit 22'
    ,'    exit 0'
    ,'    ;;'
    ,'esac'
    ,"printf 'curl refused: %s\\n' \"$url\" >&2"
    ,'exit 22'
  ].join('\n') + '\n';
}

const RM_WRAPPER = (root) => `#!/bin/sh
# harness-generated fail-closed rm
for a in "$@"; do
  case "$a" in
    --) ;;
    -*) : ;;
    *)
      case "$a" in
        ${quote(join(root, "..", ""))}/*) : ;;
        *) printf 'rm refused: %s\\n' "$a" >&2; exit 127 ;;
      esac ;;
  esac
done
exec ${quote("/usr/bin/rm")} "$@"
`;

export class Harness {
  constructor() {
    this.root = mkdtempSync(join(tmpdir(), "zosma-install-test-"));
    this.home = join(this.root, "home");
    this.data = join(this.root, "data");
    this.config = join(this.root, "config");
    this.state = join(this.root, "state");
    this.cache = join(this.root, "cache");
    this.fakebin = join(this.root, "fakebin");
    this.stubs = join(this.root, "stubs");
    this.logs = join(this.root, "logs");
    this.fixtures = join(this.root, "fixtures");
    this.work = join(this.root, "work");
    this.ttyDir = join(this.root, "tty");
    this.tmpdir = join(this.root, "tmpdir");
    for (const dir of [
      this.home, join(this.home, ".local"), join(this.home, ".local", "bin"),
      join(this.home, ".local", "share"), join(this.home, ".config"),
      join(this.home, ".local", "state"), this.data, this.config, this.state,
      this.cache, this.fakebin, this.stubs, this.logs, this.fixtures, this.work,
      this.ttyDir, this.tmpdir,
    ]) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    this.stubLogPath = join(this.logs, "cmd.log");
    this.envLogPath = join(this.logs, "env.log");
    this.baseEnv = {
      HOME: this.home,
      XDG_DATA_HOME: this.data,
      XDG_CONFIG_HOME: this.config,
      XDG_STATE_HOME: this.state,
      XDG_CACHE_HOME: this.cache,
      PATH: this.fakebin,
      ZOSMA_TESTING: "1",
      ZOSMA_TEST_CURL_MODE: "fixtures",
      ZOSMA_FIXTURE_DIR: this.fixtures,
      ZOSMA_ENVLOG_FILE: this.envLogPath,
      LANG: "C",
      LC_ALL: "C",
      TERM: "dumb",
      TMPDIR: this.tmpdir,
    };
    this.buildFakebin();
  }

  buildFakebin() {
    const findReal = (name) => {
      for (const dir of ["/bin", "/usr/bin", "/usr/local/bin"]) {
        if (existsSync(join(dir, name))) return join(dir, name);
      }
      return null;
    };
    for (const name of SAFE_UTILS) {
      const real = findReal(name);
      if (real) symlinkSync(real, join(this.fakebin, name));
    }
    for (const name of HAZARDOUS) {
      const body = name === "curl" ? curlFixtureBody(this.root, this.fixtures) : "exit 1";
      this.writeFakebin(name, stubSource(name, this.root, { body }));
    }
    for (const name of OVERRIDABLE) {
      const real = findReal(name);
      this.writeFakebin(name, stubSource(name, this.root, { realPath: real }));
    }
    this.writeFakebin("rm", RM_WRAPPER(this.root).concat("\n"));
  }

  writeFakebin(name, content) {
    const path = join(this.fakebin, name);
    writeFileSync(path, content, { mode: 0o755 });
    return path;
  }

  write(relPath, content, { mode = 0o600 } = {}) {
    const path = join(this.root, relPath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, { mode });
    return path;
  }

  read(relPath) {
    return readFileSync(join(this.root, relPath), "utf8");
  }

  exists(relPath) {
    return existsSync(join(this.root, relPath));
  }

  remove(relPath) {
    rmSync(join(this.root, relPath), { recursive: true, force: true });
  }

  plan(name, script) {
    const path = join(this.stubs, `${name}.sh`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${script}\n`, { mode: 0o700 });
    return path;
  }

  unplan(name) {
    rmSync(join(this.stubs, `${name}.sh`), { force: true });
  }

  missingCommand(name) {
    rmSync(join(this.fakebin, name), { force: true });
  }

  // --- fixture generation -------------------------------------------------

  makeCLI(version = "v0.0.0-fixture", {
    machineVersion,
    machineExtra,
    scriptBody,
    machineExit = 0,
  } = {}) {
    const body = scriptBody ?? "exit 0";
    const effective = machineVersion ?? version;
    const script = [
      "#!/bin/sh",
      "set -eu",
      'if [ "$1" = "version" ] && [ "$2" = "--machine" ]; then',
      `  printf 'installer_schema=1\\nversion=%s\\n' "${effective}"`,
      ...(machineExtra ? [`  printf '%s\\n' ${quote(machineExtra)}`] : []),
      `  exit ${machineExit}`,
      "fi",
      body,
      "",
    ].join("\n");
    const path = join(this.fixtures, `zosma-${version}`);
    writeFileSync(path, script, { mode: 0o755 });
    return path;
  }

  makeManifest({ version = "v0.0.0-fixture", overrides = {} } = {}) {
    const cliName = `zosma-${version}`;
    const cliPath = join(this.fixtures, cliName);
    if (!existsSync(cliPath)) this.makeCLI(version);
    const cliDigest = sha256File(cliPath);
    const archives = {};
    for (const target of ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64"]) {
      const name = `zosma-cowork-server-${version}-${target}.tar.gz`;
      const path = join(this.fixtures, name);
      if (!existsSync(path)) {
        writeFileSync(path, `placeholder archive for ${target}\n`, { mode: 0o644 });
      }
      archives[target] = { name, path, digest: sha256File(path) };
    }
    const fields = {
      installer_schema: "1",
      version,
      sha256sums_url: `https://github.com/zosmaai/zosma-cowork/releases/download/${version}/SHA256SUMS`,
      cli_url: `https://github.com/zosmaai/zosma-cowork/releases/download/${version}/${cliName}`,
      cli_sha256: cliDigest,
      archive_linux_x64_url: `https://github.com/zosmaai/zosma-cowork/releases/download/${version}/${archives["linux-x64"].name}`,
      archive_linux_x64_sha256: archives["linux-x64"].digest,
      archive_linux_arm64_url: `https://github.com/zosmaai/zosma-cowork/releases/download/${version}/${archives["linux-arm64"].name}`,
      archive_linux_arm64_sha256: archives["linux-arm64"].digest,
      archive_darwin_x64_url: `https://github.com/zosmaai/zosma-cowork/releases/download/${version}/${archives["darwin-x64"].name}`,
      archive_darwin_x64_sha256: archives["darwin-x64"].digest,
      archive_darwin_arm64_url: `https://github.com/zosmaai/zosma-cowork/releases/download/${version}/${archives["darwin-arm64"].name}`,
      archive_darwin_arm64_sha256: archives["darwin-arm64"].digest,
      docker_image: digestRef(),
    };
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete fields[key];
      else fields[key] = value;
    }
    const manifest = `${Object.entries(fields).map(([k, v]) => `${k}=${v}`).join("\n")}\n`;
    const manifestPath = join(this.fixtures, "manifest.txt");
    writeFileSync(manifestPath, manifest, { mode: 0o600 });
    const sumsEntries = [
      `${cliDigest}  ${cliName}`,
      ...Object.values(archives).map((a) => `${a.digest}  ${a.name}`),
    ];
    writeFileSync(join(this.fixtures, "SHA256SUMS"), `${sumsEntries.join("\n")}\n`, { mode: 0o600 });
    return { path: manifestPath, cliName, cliPath, cliDigest, archives };
  }

  makeArchive({ version = "v0.0.0-fixture", target, overrides = {} } = {}) {
    const hostTarget = `${process.platform === "darwin" ? "darwin" : "linux"}-${process.arch === "arm64" ? "arm64" : "x64"}`;
    const realNode = target === hostTarget;
    const name = `zosma-cowork-server-${version}-${target}.tar.gz`;
    const stage = join(this.root, "tmp", `stage-${target}`);
    mkdirSync(stage, { recursive: true });
    const write = (rel, content, mode = 0o644) => {
      const p = join(stage, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content, { mode });
    };
    const nodeSource = overrides.nodeSource
      ?? (realNode ? process.execPath : join(this.fakebin, "sh"));
    const common = overrides.common ?? {
      "runtime/lib/node_modules/npm/bin/npm-cli.js": "placeholder npm-cli\n",
      "runtime/lib/node_modules/npm/bin/npx-cli.js": "placeholder npx-cli\n",
      "web/dist-server/server.js": "placeholder server\n",
      "web/dist-server/bin/pi-web.js": "placeholder pi-web\n",
      "daemon/src/index.ts": "placeholder index.ts\n",
      "daemon/bin/zosma-daemon.js": "placeholder zosma-daemon\n",
      "supervisor/healthcheck.mjs": "export default () => true;\n",
    };
    write("runtime/bin/node", readFileSync(nodeSource), 0o755);
    for (const [rel, content] of Object.entries(common)) write(rel, content);
    write("supervisor/run-server.mjs", overrides.supervisor ?? defaultSupervisorSource());
    write("VERSION", overrides.versionContent ?? `${version}\n`);
    if (overrides.extra) {
      for (const [rel, content] of Object.entries(overrides.extra)) write(rel, content);
    }
    for (const entry of overrides.symlinks ?? []) {
      const p = join(stage, entry.path);
      mkdirSync(dirname(p), { recursive: true });
      symlinkSync(entry.target, p);
    }
    const archivePath = join(this.fixtures, name);
    if (!existsSync(archivePath)) {
      execFileSync("tar", ["-czf", archivePath, "-C", stage, "."]);
      chmodSync(archivePath, 0o600);
    }
    return { name, path: archivePath, digest: sha256File(archivePath), stage };
  }

  // --- config/secrets fixtures --------------------------------------------

  writeConfig(fields, { corrupt = false } = {}) {
    const lines = ["CONFIG_SCHEMA=1"];
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      lines.push(`${k}=${v}`);
    }
    if (corrupt) lines.push("SURPRISE", "=broken");
    const path = join(this.config, "zosma-cowork", "config");
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, `${lines.join("\n")}\n`, { mode: 0o600 });
    return path;
  }

  writeSecrets(fields) {
    const lines = [];
    for (const [k, v] of Object.entries(fields)) lines.push(`${k}=${v}`);
    const path = join(this.config, "zosma-cowork", "secrets");
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, `${lines.join("\n")}\n`, { mode: 0o600 });
    return path;
  }

  // --- execution ----------------------------------------------------------

  env(overrides = {}, { tty } = {}) {
    const env = { ...this.baseEnv, PATH: this.fakebin };
    for (const [key, value] of Object.entries(overrides ?? {})) {
      if (value === null || value === undefined) delete env[key];
      else env[key] = value;
    }
    if (tty) {
      mkdirSync(this.ttyDir, { recursive: true });
      writeFileSync(join(this.ttyDir, "in"), tty.input ?? "", { mode: 0o600 });
      writeFileSync(join(this.ttyDir, "out"), "", { mode: 0o600 });
      env.ZOSMA_TEST_TTY = this.ttyDir;
    } else {
      delete env.ZOSMA_TEST_TTY;
    }
    return env;
  }

  runCLI(args, { env: overrides = {}, tty, cwd, input, timeoutMs } = {}) {
    const result = spawnSync(SH, [ZOSMA, ...args], {
      env: this.env(overrides, { tty }),
      encoding: "utf8",
      cwd: cwd ?? REPO_ROOT,
      input,
      timeout: timeoutMs,
    });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }

  runInstallSh(args, { env: overrides = {}, tty, cwd, input, timeoutMs } = {}) {
    const result = spawnSync(SH, [INSTALL_SH, ...args], {
      env: this.env(overrides, { tty }),
      encoding: "utf8",
      cwd: cwd ?? REPO_ROOT,
      input,
      timeout: timeoutMs,
    });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }

  spawnCLI(args, { env: overrides = {}, tty, cwd } = {}) {
    return spawn(SH, [ZOSMA, ...args], {
      env: this.env(overrides, { tty }),
      stdio: ["pipe", "pipe", "pipe"],
      cwd: cwd ?? REPO_ROOT,
    });
  }

  shSource(script, { env: overrides = {}, tty } = {}) {
    const body = [
      "set +e",
      '. "$ZM_SOURCE"',
      "set +e",
      script,
    ].join("\n");
    const result = spawnSync(SH, ["-c", body], {
      env: { ...this.env(overrides, { tty }), ZM_SOURCE: ZOSMA, ZOSMA_SOURCE_MODE: "1" },
      encoding: "utf8",
    });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }

  // --- observation --------------------------------------------------------

  cmdLog(name) {
    return this.cmdLogAll().filter((c) => c.name === name);
  }

  cmdLogAll() {
    if (!existsSync(this.stubLogPath)) return [];
    const calls = [];
    let current = null;
    for (const rawLine of readFileSync(this.stubLogPath, "utf8").split("\n")) {
      if (rawLine.startsWith("% ")) {
        const cmd = rawLine.slice(2);
        if (cmd === "end") {
          if (current) calls.push(current);
          current = null;
          continue;
        }
        current = { name: cmd, args: [] };
        continue;
      }
      if (current) current.args.push(rawLine);
    }
    return calls;
  }

  envLog() {
    if (!existsSync(this.envLogPath)) return "";
    return readFileSync(this.envLogPath, "utf8");
  }

  ttyOut() {
    return existsSync(join(this.ttyDir, "out"))
      ? readFileSync(join(this.ttyDir, "out"), "utf8")
      : "";
  }

  writeConfigFileAt(path, content, mode = 0o600) {
    writeFileSync(path, content, { mode });
  }

  cleanup() {
    rmSync(this.root, { recursive: true, force: true });
  }
}

export function defaultSupervisorSource() {
  // Real-node fixture supervisor: captures env/argv for assertions, signals
  // readiness, exits 0 on TERM/INT (clean shutdown) unless overridden.
  const envLine = 'Object.entries(process.env).sort()\n'
    + '    .map(([k, v]) => `${k}=${v}`).join("\\n") + "\\n";';
  return [
    "#!/usr/bin/env node",
    'import { mkdirSync, writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    "const capture = process.env.ZOSMA_FIXTURE_CAPTURE_DIR;",
    "if (capture) {",
    "  mkdirSync(capture, { recursive: true });",
    `  const env = ${envLine}`,
    '  writeFileSync(join(capture, "env"), env);',
    '  writeFileSync(join(capture, "argv"), JSON.stringify(process.argv) + "\\n");',
    "}",
    "if (process.env.ZOSMA_FIXTURE_EXIT) {",
    "  process.exit(Number(process.env.ZOSMA_FIXTURE_EXIT));",
    "}",
    'const delay = Number(process.env.ZOSMA_FIXTURE_READY_DELAY_MS ?? "0");',
    "setTimeout(() => {",
    '  if (capture) writeFileSync(join(capture, "ready"), "ready\\n");',
    "}, delay);",
    'process.on("SIGTERM", () => process.exit(0));',
    'process.on("SIGINT", () => process.exit(0));',
    'setInterval(() => {}, 1000);',
    "",
  ].join("\n");
}

export function makeHarness() {
  return new Harness();
}