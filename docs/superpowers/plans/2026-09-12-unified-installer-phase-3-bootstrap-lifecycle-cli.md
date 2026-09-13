# Bootstrap Installer and `zosma` Lifecycle CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user install and manage either the self-contained local Cowork server or the digest-pinned production container through one audited bootstrap and one dependency-free POSIX `zosma` command.

**Architecture:** A small root `install.sh` performs only release selection, manifest/checksum verification, and atomic installation of the versioned CLI. The standalone `scripts/zosma` asset owns strict configuration parsing, local/Docker installation, user-service integration, authenticated health checks, lifecycle commands, transactional updates, rollback, and allowlisted uninstall. Node's built-in test runner executes the shell programs under temporary HOME/XDG roots with stubbed external commands; no test contacts a production endpoint or host service manager.

**Tech Stack:** POSIX `sh`, `curl`, `tar`, `mktemp`, `sha256sum`/`shasum`, standard Unix utilities, systemd user services, macOS launchd LaunchAgents, Docker Compose v2, Node.js built-in test runner, ShellCheck.

**Roadmap:** `docs/superpowers/roadmaps/2026-09-12-unified-installer-roadmap.md`

**Phase:** Phase 3: Bootstrap Installer and `zosma` Lifecycle CLI

---

## Phase boundary

This plan implements only Phase 3. It adds a locally testable bootstrap and lifecycle CLI, but does not publish either file, upload server assets, generate the release manifest in CI, add attestations, move `latest` or a stable channel, configure `install.zosma.ai`, change public installation documentation, or announce the installer. Keep both `.github/workflows/release.yml` and `.github/workflows/server-release.yml` unchanged. Keep the existing desktop release path, Phase 2 production Docker path, development Docker sandbox, and stale daemon service fixture unchanged; Phase 4 decides publication and cleanup.

Phase 3 starts from completed Phase 2 commit `d412e984a`. Use that commit for phase-scoped diff checks. Phase 3 tests use generated local fixture manifests, archives, CLI assets, and command stubs. The production URLs are constants but are never contacted by tests. An actual public end-to-end install remains a Phase 4 release gate.

No service-template companion assets are added. The release contract defines `scripts/zosma` as one standalone CLI asset, so it renders the small systemd, LaunchAgent, and Compose files itself. Docker tests compare the generated Compose semantics with `deploy/compose.yml.template` to prevent drift.

## Audited existing contracts

Implementation must consume these existing contracts rather than creating alternatives:

- Local archives are named `zosma-cowork-server-<version>-<platform>-<arch>.tar.gz` and contain `runtime/bin/node`, `web/dist-server/`, `daemon/`, `supervisor/run-server.mjs`, `supervisor/healthcheck.mjs`, and `VERSION`.
- The local supervisor requires `PORT`, `PI_WEB_HOSTNAME`, `PI_WEB_NO_OPEN=1`, `PI_CODING_AGENT_DIR`, `ZOSMA_DAEMON_DATA_DIR`, `ZOSMA_DAEMON_PORT`, and `ZOSMA_DAEMON_TOKEN`.
- Authenticated web health is `GET http://127.0.0.1:<port>/api/v1/health`; when LAN authentication is enabled, Basic username is `pi`.
- The production Compose template accepts `ZOSMA_IMAGE`, `ZOSMA_UID`, `ZOSMA_GID`, `ZOSMA_BIND_ADDRESS`, `ZOSMA_PORT`, `ZOSMA_WORKSPACE`, `ZOSMA_PI_STATE`, `ZOSMA_DAEMON_TOKEN`, `PI_WEB_PASSWORD`, and `PI_WEB_ALLOWED_HOSTS`.
- Generated Compose must continue to use the exact two mounts and contain no build section, mutable image tag, Docker socket, host network, privilege, added capability, device, or Tailscale process.
- Phase 2 records an exact multi-architecture image digest but intentionally does not generate or publish installer manifests.
- `scripts/zosma` contains one exact `ZOSMA_CLI_VERSION=v0.0.0-dev` assignment. Phase 4 will stamp that line when producing `zosma-<version>`; verified candidates must report the stamped manifest version.

## Fixed Phase 3 formats

### Release manifest

Use this line-oriented schema so Phase 4 has one exact producer contract:

```text
installer_schema=1
version=v1.2.3
sha256sums_url=https://github.com/zosmaai/zosma-cowork/releases/download/v1.2.3/SHA256SUMS
cli_url=https://github.com/zosmaai/zosma-cowork/releases/download/v1.2.3/zosma-v1.2.3
cli_sha256=<64 lowercase hex characters>
archive_linux_x64_url=https://github.com/zosmaai/zosma-cowork/releases/download/v1.2.3/zosma-cowork-server-v1.2.3-linux-x64.tar.gz
archive_linux_x64_sha256=<64 lowercase hex characters>
archive_linux_arm64_url=https://github.com/zosmaai/zosma-cowork/releases/download/v1.2.3/zosma-cowork-server-v1.2.3-linux-arm64.tar.gz
archive_linux_arm64_sha256=<64 lowercase hex characters>
archive_darwin_x64_url=https://github.com/zosmaai/zosma-cowork/releases/download/v1.2.3/zosma-cowork-server-v1.2.3-darwin-x64.tar.gz
archive_darwin_x64_sha256=<64 lowercase hex characters>
archive_darwin_arm64_url=https://github.com/zosmaai/zosma-cowork/releases/download/v1.2.3/zosma-cowork-server-v1.2.3-darwin-arm64.tar.gz
archive_darwin_arm64_sha256=<64 lowercase hex characters>
docker_image=ghcr.io/zosmaai/zosma-cowork@sha256:<64 lowercase hex characters>
```

Rules:

- Every key appears exactly once. Missing, duplicate, malformed, whitespace-padded, or unknown keys fail verification.
- Values are data, never shell. Neither script sources or evaluates a manifest.
- `version` is canonical `vMAJOR.MINOR.PATCH` with the already-supported optional prerelease suffix.
- All URLs are HTTPS. Only tests running with `ZOSMA_TESTING=1` may override the manifest URL and use fixture transport through a fake `curl`.
- `SHA256SUMS` must contain the same digest for the selected CLI/archive basename as the manifest, and the downloaded bytes must match both.
- Stable resolution uses `https://install.zosma.ai/releases/stable`; `--version vX.Y.Z` uses `https://github.com/zosmaai/zosma-cowork/releases/download/vX.Y.Z/install-manifest.txt`.

### Installed configuration

`$XDG_CONFIG_HOME/zosma-cowork/config` uses only:

```text
CONFIG_SCHEMA=1
MODE=local|docker
VERSION=v1.2.3
PORT=30141
BIND_ADDRESS=127.0.0.1|0.0.0.0
ALLOWED_HOST=<validated hostname or 127.0.0.1>
PI_DIR=<absolute local Pi directory or Docker state path>
WORKSPACE=<empty in local mode or validated absolute Docker workspace>
IMAGE=<empty in local mode or exact ghcr.io digest reference>
SERVICE_MANAGER=systemd|launchd|none
```

`$XDG_CONFIG_HOME/zosma-cowork/secrets` uses only:

```text
DAEMON_TOKEN=<generated lowercase hex>
WEB_PASSWORD=<empty for loopback or generated lowercase hex>
```

Both parsers split at the first `=`, assign only fixed keys through explicit `case` arms, validate every assigned value, ignore unknown config keys with a warning, reject unknown secret keys, and never use `source`, `.`, `eval`, command substitution, or dynamic variable names. Directories are mode `0700`; config, secrets, generated Compose, systemd unit, and LaunchAgent are mode `0600`.

### Installation layout

Resolve paths once per invocation without creating them:

```text
BIN_DIR=${HOME}/.local/bin
DATA_ROOT=${XDG_DATA_HOME:-$HOME/.local/share}/zosma-cowork
CONFIG_ROOT=${XDG_CONFIG_HOME:-$HOME/.config}/zosma-cowork
STATE_ROOT=${XDG_STATE_HOME:-$HOME/.local/state}/zosma-cowork
CLI_VERSIONS=$DATA_ROOT/cli/versions
CLI_CURRENT=$DATA_ROOT/cli/current
RUNTIME_VERSIONS=$DATA_ROOT/runtime/versions
RUNTIME_CURRENT=$DATA_ROOT/runtime/current
DOCKER_PI_STATE=$DATA_ROOT/docker/pi-agent
DOCKER_ROOT=$CONFIG_ROOT/docker
SYSTEMD_UNIT=${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/zosma-cowork.service
LAUNCH_AGENT=$HOME/Library/LaunchAgents/ai.zosma.cowork.plist
```

Local `PI_DIR` is the absolute value of `PI_CODING_AGENT_DIR`, when set, otherwise `$HOME/.pi/agent`. Never inspect, create, copy, migrate, or delete that local external path.

### Exit statuses

Use and test these stable command-level statuses:

- `0`: success
- `2`: invalid usage or malformed local configuration
- `3`: unsupported platform or missing prerequisite
- `4`: release download, manifest, checksum, digest, or archive verification failure
- `5`: runtime start, stop, health, or rollback failure
- `6`: explicit user cancellation
- `1`: unexpected internal failure only

### Test-only seam

When and only when `ZOSMA_TESTING=1`, the scripts may honor `ZOSMA_TEST_MANIFEST_URL`, `ZOSMA_TEST_TTY`, `ZOSMA_TEST_OS`, `ZOSMA_TEST_ARCH`, and `ZOSMA_TEST_LIBC`. Production execution ignores these variables. They exist only to make platform and TTY branches deterministic without a shell framework or privileged host changes.

---

### Task 1: Build the isolated shell harness and safe CLI foundation

**Files:**
- Create: `scripts/installer/test-helpers.mjs`
- Create: `scripts/installer/core.test.mjs`
- Create: `scripts/zosma`

- [ ] **Step 1: Create the temporary-home shell harness**

Add Node built-in helpers that:

- create isolated HOME, XDG data/config/state/cache, fixture, fake-bin, and command-log directories;
- prepend fake commands while retaining `/usr/bin:/bin` for ordinary POSIX tools;
- write executable command stubs without embedding credentials;
- invoke `/bin/sh` with captured stdout/stderr and an optional fixture TTY file;
- generate canonical manifests, `SHA256SUMS`, stamped CLI candidates, and minimum valid local archives on demand;
- clean every temporary root with `t.after`;
- never contact a network endpoint, real Docker daemon, systemd user manager, launchd domain, or browser.

Use placeholder random strings in all fixtures; never copy a real token, password, or credential into tests.

- [ ] **Step 2: Write failing CLI foundation tests**

Cover one behavior per test:

1. `version` prints the human-readable development version.
2. `version --machine` prints exactly `installer_schema=1` and `version=v0.0.0-dev` on separate lines.
3. Unknown commands/options return `2` and concise usage.
4. XDG variables select the fixed roots; unset variables use the documented fallbacks.
5. `x86_64`/`amd64` normalize to `x64`; `aarch64`/`arm64` normalize to `arm64`.
6. Linux glibc 2.35+ and macOS 13+ are accepted; musl, older glibc/macOS, Windows, and unsupported architectures return `3` before writes.
7. A hostile config value such as `$(touch sentinel)` remains literal and does not create the sentinel.
8. Duplicate/malformed known config fields fail; unknown config fields produce one warning and are ignored.
9. Secret files reject unknown or malformed fields without printing values.
10. `--dry-run` with an uninstalled command creates no data/config/state/bin path.

- [ ] **Step 3: Run the tests and verify the expected failure**

```bash
node --test scripts/installer/core.test.mjs
```

Expected: FAIL because `scripts/zosma` does not exist.

- [ ] **Step 4: Add the smallest POSIX CLI skeleton**

Implement in `scripts/zosma`:

- `#!/bin/sh`, `set -eu`, constants for schema/version/exit statuses, and a `main "$@"` call only at the final line;
- path resolution with no filesystem side effect;
- canonical version/port/hostname/absolute-path/platform/libc validators;
- fixed-key manifest/config/secret readers using `while IFS= read -r line` and `case`, never shell evaluation;
- `version`, `--help`, stable dispatch, and dry-run plumbing;
- portable stderr/error helpers and ANSI color only when stdout is a terminal and `TERM != dumb`;
- test overrides guarded by an explicit `ZOSMA_TESTING=1` check.

Do not add a generic shell framework. Keep functions private in the single file.

- [ ] **Step 5: Run syntax, core, and ShellCheck validation**

```bash
sh -n scripts/zosma
node --test scripts/installer/core.test.mjs
shellcheck -s sh scripts/zosma
```

Expected: syntax succeeds, all core tests pass, and ShellCheck emits no findings. If ShellCheck is unavailable locally, record that fact and run the pinned CI package installation in Task 10; do not weaken the lint command.

- [ ] **Step 6: Commit the CLI foundation**

```bash
git add scripts/installer/test-helpers.mjs scripts/installer/core.test.mjs scripts/zosma
git commit -m "feat: define zosma CLI contracts"
```

### Task 2: Implement the verified, truncated-pipe-safe bootstrap

**Files:**
- Create: `install.sh`
- Create: `scripts/installer/bootstrap.test.mjs`

- [ ] **Step 1: Write failing bootstrap trust tests**

Cover:

1. Missing `curl`, `uname`, `mktemp`, `tar`, or both supported SHA tools returns `3` before install paths exist.
2. Stable and canonical `--version` inputs request only their fixed manifest URL.
3. Malformed, duplicate, incomplete, unknown-key, non-HTTPS, or schema-mismatched manifests return `4`.
4. A manifest containing shell syntax is treated as inert data.
5. CLI digest mismatch, `SHA256SUMS` disagreement, missing checksum entry, invalid `sh -n`, or mismatched `version --machine` returns `4` without changing `current`.
6. A valid asset is installed at `cli/versions/<version>/zosma` with mode `0755`; `cli/current` and `$HOME/.local/bin/zosma` are symlinks to stable versioned locations.
7. Replacing an existing CLI uses a sibling temporary symlink plus `mv`, retaining the previous target on any injected failure.
8. `--dry-run` may fetch only the manifest and performs no CLI/checksum download or write.
9. Temporary downloads disappear on success, failure, `INT`, and `TERM`.
10. Every truncation before the final `main "$@"` line performs no write or command invocation; the complete script does run.
11. Original install arguments are forwarded unchanged to the verified CLI through `ZOSMA_INSTALL_MANIFEST`, without printing the manifest path or fixture credentials.
12. When an active CLI already exists, the bootstrap records its target before switching; cancellation or failed delegated install restores that target, while a failed fresh mode install with no prior CLI may retain the verified new CLI.

- [ ] **Step 2: Run the bootstrap tests and verify the expected failure**

```bash
node --test scripts/installer/bootstrap.test.mjs
```

Expected: FAIL because `install.sh` does not exist.

- [ ] **Step 3: Add the minimal bootstrap**

Implement only:

1. strict options and prerequisite/platform checks;
2. stable or exact manifest resolution;
3. strict fixed-key manifest parsing;
4. temporary download of manifest, `SHA256SUMS`, and `zosma-<version>` via `curl -fL --proto '=https' --tlsv1.2` in production;
5. agreement of manifest digest, checksum-list entry, and downloaded bytes;
6. `sh -n` plus exact candidate `version --machine` validation after checksum verification;
7. versioned CLI copy, capture of any prior `current` target, atomic `current` and launcher symlink replacement, and PATH guidance without editing a shell profile;
8. invocation of the verified CLI as a child with original arguments, `ZOSMA_INSTALL_MANIFEST` pointing to the already-verified temporary manifest, and the prior CLI target supplied as internal rollback context; restore that prior link when delegation fails, then clean up and propagate the child's status (do not `exec`, because that would bypass the bootstrap cleanup trap);
9. traps for temporary cleanup;
10. all function definitions before the sole final `main "$@"` invocation.

The bootstrap must not download/extract a server archive, call Docker, generate secrets/configuration, manage services, or duplicate lifecycle logic.

- [ ] **Step 4: Run bootstrap and combined trust checks**

```bash
sh -n install.sh
node --test scripts/installer/bootstrap.test.mjs scripts/installer/core.test.mjs
shellcheck -s sh install.sh scripts/zosma
```

Expected: all checks pass with no production network access.

- [ ] **Step 5: Commit the bootstrap**

```bash
git add install.sh scripts/installer/bootstrap.test.mjs
git commit -m "feat: add verified Cowork bootstrap"
```

### Task 3: Add interactive choices, validated configuration, and protected secrets

**Files:**
- Create: `scripts/installer/configuration.test.mjs`
- Modify: `scripts/zosma`

- [ ] **Step 1: Write failing configuration tests**

Cover:

1. No supplied mode reads the documented menu from the test TTY and accepts only `1`, `2`, or `3`.
2. No mode without a controlling TTY returns `2`; it never guesses in CI.
3. Non-interactive Docker requires `--workspace`; LAN additionally requires `--hostname`.
4. Port accepts only decimal `1..65535`; workspace must already exist, be a directory, and be absolute.
5. Hostnames reject schemes, ports, paths, whitespace, shell metacharacters, and empty labels.
6. `--mode` and positional mode agree; conflicting or repeated scalar options return `2`.
7. Secret generation reads `/dev/urandom` through standard tools and produces independent lowercase-hex daemon and LAN values.
8. Loopback stores an empty web password and `127.0.0.1`; LAN stores `0.0.0.0`, a non-empty password, and the allowed hostname.
9. Config/secrets and containing directories use `0600`/`0700`; no secret or six-character prefix appears in stdout, stderr, fake-command argv logs, or generated service command arguments.
10. Interactive LAN install writes the password once to the TTY only; non-interactive install reports only the secrets-file path.
11. Local mode captures an absolute custom `PI_CODING_AGENT_DIR` or the expanded `$HOME/.pi/agent` without reading or creating it.
12. `--dry-run` validates and prints a redacted plan without generating secrets or files.

- [ ] **Step 2: Run and observe the expected failures**

```bash
node --test scripts/installer/configuration.test.mjs
```

Expected: FAIL because install-option, TTY, config, and secret behavior is not implemented.

- [ ] **Step 3: Implement configuration staging**

Extend `scripts/zosma` with:

- the exact public install options from the design;
- controlling-TTY detection and all prompts through `/dev/tty` (the guarded test TTY only under `ZOSMA_TESTING=1`);
- strict mode/port/workspace/hostname validation before writes;
- secret generation from `/dev/urandom` using portable `od` and `tr`, with explicit prerequisite errors;
- staging files under same-filesystem sibling directories and mode enforcement independent of caller `umask`;
- redacted summaries and no secret-bearing command arguments;
- local Pi-directory resolution as string/path normalization only.

Do not persist configuration yet when later mode-specific validation fails. This task creates reusable staged config/secrets functions consumed by Tasks 4 and 6.

- [ ] **Step 4: Run configuration and earlier checks**

```bash
sh -n scripts/zosma
node --test scripts/installer/core.test.mjs scripts/installer/configuration.test.mjs
shellcheck -s sh scripts/zosma
```

Expected: all tests pass.

- [ ] **Step 5: Commit secure configuration**

```bash
git add scripts/zosma scripts/installer/configuration.test.mjs
git commit -m "feat: stage secure Cowork configuration"
```

### Task 4: Install local archives transactionally and generate user services

**Files:**
- Create: `scripts/installer/local-install.test.mjs`
- Modify: `scripts/zosma`

- [ ] **Step 1: Write failing local-install tests**

Use generated minimum archives and fake `curl`, `systemctl`, `launchctl`, and browser commands. Cover:

1. The selected platform tuple picks exactly its manifest archive URL/name/digest.
2. Manifest, `SHA256SUMS`, and downloaded archive must agree before extraction.
3. A corrupt archive, wrong `VERSION`, or missing required runtime entry returns `4` before activation.
4. A valid archive stages under `runtime/versions/.stage-*`, validates, then renames to `runtime/versions/<version>` and atomically updates `runtime/current`.
5. Linux with an active user manager installs a user unit invoking `$HOME/.local/bin/zosma serve --service`, with restart policy and captured absolute `PI_CODING_AGENT_DIR`.
6. macOS installs a valid `ai.zosma.cowork.plist` with stable CLI arguments, KeepAlive, log paths, and captured Pi directory; parse it with Node or Python plist support in the test, not regex alone.
7. Service output safely represents HOME/Pi/log paths containing spaces, quotes, ampersands, and XML characters without command injection.
8. WSL2 or Linux without an active user manager commits `SERVICE_MANAGER=none`, does not call a manager, and directs the user to `zosma serve`.
9. `--no-start` commits the statically validated installation as stopped and performs no health/browser command.
10. Default non-interactive install starts and health-checks but never opens a browser.
11. Default interactive install opens only after authenticated health succeeds.
12. Any failure before commit removes stage/config/secrets/service files and leaves no active mode/current link; a post-start health failure additionally stops the attempted service.
13. Pre-existing unrelated files and the resolved external local Pi directory remain byte-for-byte untouched on every path.

- [ ] **Step 2: Run and observe the expected failures**

```bash
node --test scripts/installer/local-install.test.mjs
```

Expected: FAIL because local archive installation and service rendering do not exist.

- [ ] **Step 3: Implement local installation**

Extend `scripts/zosma` to:

- resolve or consume the verified manifest, then download archive and checksum list;
- verify exact basename/digest agreement before `tar -xzf`;
- reject absolute or parent-traversing archive member names before extraction;
- validate the fixed Phase 1 runtime shape and exact `VERSION`;
- render minimal private systemd/LaunchAgent definitions directly from the standalone CLI, escaping each target format and invoking only the stable launcher;
- detect systemd user-manager/launchd/foreground fallback without root or `sudo`;
- activate config, secrets, service definition, mode marker, and `runtime/current` only after all static checks pass;
- start by default, use authenticated health, open only for an interactive successful install, and perform fresh-install cleanup on failure;
- leave the verified CLI installed when mode installation fails.

The systemd unit and LaunchAgent must not contain daemon/web secrets. `serve --service` reads the protected fixed-key files and exports the required runtime environment before executing the bundled Node supervisor.

- [ ] **Step 4: Validate generated definitions and transaction behavior**

```bash
sh -n scripts/zosma
node --test scripts/installer/local-install.test.mjs
node --test scripts/installer/*.test.mjs
shellcheck -s sh scripts/zosma
```

On Linux, additionally render the fixture unit into a temporary root and run `systemd-analyze verify` against it without installing it. Expected: all tests pass and no host service starts.

- [ ] **Step 5: Commit local installation**

```bash
git add scripts/zosma scripts/installer/local-install.test.mjs
git commit -m "feat: install local Cowork runtimes"
```

### Task 5: Implement local lifecycle, health, diagnostics, and access

**Files:**
- Create: `scripts/installer/local-lifecycle.test.mjs`
- Modify: `scripts/zosma`

- [ ] **Step 1: Write failing local lifecycle tests**

Cover each command and mode branch separately:

1. `serve` exports only validated config/secrets and `exec`s `runtime/current/runtime/bin/node runtime/current/supervisor/run-server.mjs` in foreground.
2. `serve --service` is internal-only and suppresses interactive/browser behavior.
3. `start`, `stop`, and `restart` map to the selected systemd user or launchd domain commands and wait for the expected health transition.
4. With `SERVICE_MANAGER=none`, `start` explains `zosma serve`; `stop`/`restart` refuse to kill a foreground process and mention Ctrl-C.
5. `status` reports installed mode/version, manager state, and authenticated application health with stable success/failure status.
6. Health credentials and Host header are supplied to `curl` through stdin/config, never argv; no secret or prefix reaches output/command logs.
7. Managed `logs` reads/follows only the installer state log paths; foreground mode explains that logs remain in the owning terminal.
8. `open` first requires successful health, then invokes `xdg-open` on Linux/WSL or `open` on macOS with the configured URL.
9. `doctor` checks platform, archive entries, config permissions, port/health, manager availability, optional Git, and explains degraded Git without failing core health.
10. `access` prints URL and LAN username but no password.
11. `access --show-password` requires TTY confirmation and writes the password only to the TTY; cancellation returns `6`; loopback reports that no password is configured.
12. Every lifecycle command fails safely on absent, malformed, or unsupported-schema configuration.

- [ ] **Step 2: Run and observe the expected failures**

```bash
node --test scripts/installer/local-lifecycle.test.mjs
```

Expected: FAIL because lifecycle dispatch still lacks these implementations.

- [ ] **Step 3: Implement the local lifecycle commands**

Add only small mode-dispatched functions. Use:

- manager commands without `sudo`: systemd install runs `daemon-reload` plus `enable` and optionally `start`, lifecycle uses `start`/`stop`/`restart`, and uninstall uses `disable --now`; launchd lifecycle uses `bootstrap gui/<uid> <plist>`, `bootout gui/<uid>/ai.zosma.cowork`, `kickstart -k`, and `print` with already-absent domains handled idempotently;
- bounded authenticated health polling;
- a temporary/stdin curl config for Basic auth and Host selection so secrets never enter argv;
- fixed log paths under `STATE_ROOT`;
- explicit foreground ownership rules rather than PID-file killing;
- platform-native browser commands only after health succeeds;
- read-only doctor checks, with Git optional for local mode.

Do not implement a generic process manager or background the supervisor directly.

- [ ] **Step 4: Run local lifecycle and full installer tests**

```bash
sh -n scripts/zosma
node --test scripts/installer/local-lifecycle.test.mjs
node --test scripts/installer/*.test.mjs
shellcheck -s sh scripts/zosma
```

Expected: all tests pass; fake command logs contain no fixture secret or prefix.

- [ ] **Step 5: Commit local lifecycle support**

```bash
git add scripts/zosma scripts/installer/local-lifecycle.test.mjs
git commit -m "feat: manage local Cowork lifecycle"
```

### Task 6: Install and manage digest-pinned Docker mode

**Files:**
- Create: `scripts/installer/docker-mode.test.mjs`
- Modify: `scripts/zosma`

- [ ] **Step 1: Write failing Docker-mode tests**

Cover:

1. Missing Docker or Compose v2 returns `3` before configuration writes.
2. Workspace validation happens before pull/generation; relative, missing, file, or newline-containing paths fail.
3. Only `ghcr.io/zosmaai/zosma-cowork@sha256:<64 lowercase hex>` is accepted; tags and other repositories fail.
4. `docker pull` targets the exact manifest digest and local `RepoDigests` must contain that exact reference before activation.
5. Generated Compose is mode `0600`, semantically matches `deploy/compose.yml.template`, uses host UID/GID, loopback by default, and has exactly workspace/Pi-state mounts.
6. Paths containing spaces, `#`, `$`, quotes, and ampersands survive config parsing and Compose interpolation without evaluation.
7. Lifecycle calls export fixed validated variables then invoke `docker compose -p zosma-cowork -f <private-file>`; no secret appears in argv/logs.
8. Default install runs `up -d`, waits for authenticated health, and never opens a browser non-interactively.
9. Interactive install opens only after health; `--no-start` performs no pull/up/health/browser call but still validates metadata and prerequisites.
10. Failed pull/digest/generation/start/health removes fresh mode files; a failed start also runs Compose down without deleting Pi state.
11. Docker `serve` returns `2` with guidance; `start`, `stop`, `restart`, `status`, `logs [--follow]`, `open`, `doctor`, and `access` map to Compose/shared behavior.
12. Doctor rejects forbidden generated policy (mutable tag, host network, privilege, socket, capabilities, devices, or extra mount).

- [ ] **Step 2: Run and observe the expected failures**

```bash
node --test scripts/installer/docker-mode.test.mjs
```

Expected: FAIL because Docker mode is not implemented.

- [ ] **Step 3: Implement Docker install and lifecycle**

Extend `scripts/zosma` to:

- require Docker Engine and `docker compose version`;
- validate the absolute existing workspace and exact image reference;
- use `id -u`/`id -g` on Linux and the current user IDs on Docker Desktop without promising host ownership outside Linux;
- pull and inspect the exact RepoDigest;
- write the canonical Phase 2 Compose template from the standalone CLI into the private Docker directory;
- export only parsed known values for Compose interpolation, so no `.env` file or secret-bearing argv is needed;
- use one fixed Compose project name and file path for all lifecycle commands;
- share authenticated health/access/open helpers with local mode;
- preserve dedicated Docker Pi state on failures and ordinary stop/down.

Do not add mutable tags, `docker run`, host networking, a socket, devices, capabilities, Tailscale, or more workspace mounts.

- [ ] **Step 4: Run Docker and complete installer tests**

```bash
sh -n scripts/zosma
node --test scripts/installer/docker-mode.test.mjs
node --test scripts/installer/*.test.mjs
pnpm test:docker
shellcheck -s sh scripts/zosma
```

Expected: all fixture and existing production Docker contract tests pass. Installer tests do not call the real Docker daemon.

- [ ] **Step 5: Commit Docker mode**

```bash
git add scripts/zosma scripts/installer/docker-mode.test.mjs
git commit -m "feat: manage digest-pinned Docker installs"
```

### Task 7: Add schema-compatible local updates and crash-safe paired rollback

**Files:**
- Create: `scripts/installer/local-update.test.mjs`
- Modify: `scripts/zosma`

- [ ] **Step 1: Write failing local-update tests**

Cover:

1. `update` resolves stable metadata; `update --version` resolves only the canonical exact manifest.
2. Unsupported schema, malformed manifest, checksum failure, invalid candidate syntax, or candidate machine-version mismatch leaves current CLI/runtime/service/config unchanged.
3. A valid update stages and validates both CLI and local archive before stopping the old service.
4. Activation records old/new targets in a private transaction journal, switches runtime and CLI links, updates config, then starts and health-checks the candidate.
5. Successful activation removes the journal, retains current and immediately previous CLI/runtime versions, and prunes only older installer-owned versions.
6. Candidate health failure restores both links/config, restarts and health-checks the previous runtime, and returns `5` while leaving the prior version usable.
7. Failure of rollback health returns `5` with both candidate and previous log locations; it never deletes either retained version.
8. Injected `INT`, `TERM`, or failure between the two link replacements triggers paired restoration.
9. A journal found at the next invocation is recovered before any command executes, covering process death between replacements.
10. The stable launcher always points to `cli/current/zosma` and is never version-rewritten during update.
11. Update output and fake command logs contain no secret material.

- [ ] **Step 2: Run and observe the expected failures**

```bash
node --test scripts/installer/local-update.test.mjs
```

Expected: FAIL because update is not implemented.

- [ ] **Step 3: Implement local update transactions**

Add:

- common verified manifest/asset staging reused from install/bootstrap behavior;
- candidate `sh -n` and exact `version --machine` compatibility checks;
- a fixed-key, mode `0600` transaction journal under `STATE_ROOT`;
- same-filesystem temporary symlinks plus `mv` for each link;
- traps and startup recovery that restore both old targets/config when the transaction is incomplete;
- stop/switch/start/health and paired rollback;
- post-success retention of exactly current plus immediate previous versions.

Two symlinks cannot be replaced by one filesystem operation. The journal and mandatory recovery make the pair one recoverable transaction; do not claim stronger atomicity.

- [ ] **Step 4: Run update, lifecycle, and full installer checks**

```bash
sh -n scripts/zosma
node --test scripts/installer/local-update.test.mjs
node --test scripts/installer/*.test.mjs
shellcheck -s sh scripts/zosma
```

Expected: all tests pass, including interruption recovery.

- [ ] **Step 5: Commit local updates**

```bash
git add scripts/zosma scripts/installer/local-update.test.mjs
git commit -m "feat: update local Cowork transactionally"
```

### Task 8: Add Docker update rollback and reinstall/mode rules

**Files:**
- Create: `scripts/installer/reinstall-docker-update.test.mjs`
- Modify: `scripts/zosma`

- [ ] **Step 1: Write failing mode/reinstall/update tests**

Cover:

1. Installing the other mode refuses before downloads/stops/writes and gives uninstall-without-purge guidance.
2. Same-mode same-version non-interactive install with `--yes` performs a verified reinstall; interactive mode offers reinstall/update/exit through TTY.
3. Cancellation returns `6` and changes nothing.
4. Docker update verifies candidate CLI and exact image RepoDigest before stopping/recreating the active container.
5. The journal records old/new CLI targets, version, and image digest; config/CLI switch as one recoverable transaction.
6. Candidate health failure restores previous image/config/CLI, recreates and health-checks the previous container, and returns `5`.
7. Interrupted Docker updates recover the journal before lifecycle dispatch.
8. Successful update retains current/previous CLI, records only the exact digest, and never invokes or stores `latest` or an exact-version tag.
9. Update rejects install-only options such as `--no-start`; every update starts and health-validates the candidate so rollback is decided in the same transaction.
10. A reinstall failure restores the prior healthy same-mode installation rather than applying fresh-install cleanup.

- [ ] **Step 2: Run and observe the expected failures**

```bash
node --test scripts/installer/reinstall-docker-update.test.mjs
```

Expected: FAIL because Docker updates and existing-install branches are incomplete.

- [ ] **Step 3: Implement existing-install and Docker update behavior**

Reuse the Task 7 transaction/recovery primitives. Distinguish fresh install from reinstall before staging. For Docker:

- pull/inspect candidate digest first;
- stop/recreate only after every static/asset check passes;
- journal previous CLI target, config version/image, and new values;
- restore exact prior digest/config/CLI and health on failure;
- never derive runtime configuration from a mutable tag.

Keep in-place mode switching unsupported; do not add data migration.

- [ ] **Step 4: Run all update and installer tests**

```bash
sh -n scripts/zosma
node --test scripts/installer/reinstall-docker-update.test.mjs
node --test scripts/installer/*.test.mjs
pnpm test:docker
shellcheck -s sh scripts/zosma
```

Expected: all tests pass.

- [ ] **Step 5: Commit Docker updates and reinstall rules**

```bash
git add scripts/zosma scripts/installer/reinstall-docker-update.test.mjs
git commit -m "feat: update and reinstall Cowork safely"
```

### Task 9: Implement ordinary uninstall, confirmed purge, and self-removal

**Files:**
- Create: `scripts/installer/uninstall.test.mjs`
- Modify: `scripts/zosma`

- [ ] **Step 1: Write failing uninstall tests**

Cover:

1. Ordinary local uninstall stops/unloads only its selected user service, removes generated definitions/config/secrets/logs/runtime/CLI/launcher, and never reads or deletes local `PI_DIR`.
2. Ordinary Docker uninstall runs Compose down without volume/data deletion, removes generated Docker/config/runtime CLI files, and preserves Docker Pi state.
3. `--purge-data` lists every additional path and requires an explicit TTY confirmation even with `--yes`.
4. Declined/no-TTY purge returns `6` without deletion; no command-line force bypass exists.
5. Confirmed purge removes only the fixed installer-owned Docker Pi-state path and empty installer parent directories.
6. Hostile config values cannot add a deletion target; workspace and local Pi directories always survive.
7. Symlinked installer-owned roots are unlinked, never traversed.
8. `--dry-run` prints the same redacted allowlist but performs no stop, deletion, or self-copy.
9. Uninstall copies the running script to a private temporary file and re-executes its final cleanup phase before deleting `cli/current` or the source version.
10. Failures stopping a service/container abort destructive cleanup and return `5`; missing already-stopped resources remain idempotent.
11. Repeated ordinary uninstall succeeds without broadening deletion scope.

- [ ] **Step 2: Run and observe the expected failures**

```bash
node --test scripts/installer/uninstall.test.mjs
```

Expected: FAIL because uninstall is not implemented.

- [ ] **Step 3: Implement allowlisted uninstall**

Add explicit, mode-specific cleanup lists built only from resolved installer roots—not parsed workspace/Pi paths. Stop first, then re-exec a verified private copy for self-removal. Use narrow deletion helpers that reject empty, `/`, `$HOME`, non-installer-prefix, and unexpected symlink traversal targets. Preserve Docker Pi state unless separately confirmed purge is active; preserve local external Pi data unconditionally.

Do not add a generic recursive-delete interface that accepts user/config input.

- [ ] **Step 4: Run uninstall and all shell tests**

All deletion tests must remain inside harness-owned temporary HOME/XDG roots.

```bash
sh -n scripts/zosma
node --test scripts/installer/uninstall.test.mjs
node --test scripts/installer/*.test.mjs
shellcheck -s sh scripts/zosma
```

Expected: all tests pass and sentinels outside installer-owned paths survive.

- [ ] **Step 5: Commit uninstall support**

```bash
git add scripts/zosma scripts/installer/uninstall.test.mjs
git commit -m "feat: uninstall Cowork with safe data ownership"
```

### Task 10: Add installer CI gates and run the complete Phase 3 verification

**Files:**
- Create: `scripts/installer/ci-contract.test.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Write failing script/CI contract tests**

Require:

- root `test:installer` runs only `scripts/installer/*.test.mjs`;
- root `lint:installer` runs `sh -n` and `shellcheck -s sh` for both production scripts;
- normal CI has an installer job on Ubuntu 22.04 and macOS 15;
- Ubuntu installs/runs Dash and ShellCheck, checks both scripts under `/bin/sh`, and runs all installer tests;
- macOS checks both scripts with its system `/bin/sh` and runs the same tests;
- no installer test contains a production endpoint invocation, real credential, `sudo`, host service mutation, real Docker mutation, or deletion outside temporary roots;
- `.github/workflows/release.yml` and `.github/workflows/server-release.yml` remain outside the Phase 3 diff.

- [ ] **Step 2: Run and observe the expected failure**

```bash
node --test scripts/installer/ci-contract.test.mjs
```

Expected: FAIL because package scripts and CI gates do not exist.

- [ ] **Step 3: Add root commands and the isolated CI job**

Add:

```json
"test:installer": "node --test 'scripts/installer/*.test.mjs'",
"lint:installer": "sh -n install.sh scripts/zosma && shellcheck -s sh install.sh scripts/zosma"
```

Add a normal-CI installer matrix using Node 24 on `ubuntu-22.04` and `macos-15`. Install ShellCheck through each runner's package manager only in this job, run syntax/lint, then `pnpm test:installer`. Do not download application release assets, start host user services, contact GHCR, or publish artifacts.

- [ ] **Step 4: Run the Phase 3 test matrix locally**

```bash
pnpm test:installer
sh -n install.sh scripts/zosma
shellcheck -s sh install.sh scripts/zosma
pnpm test:server
pnpm test:docker
pnpm -C apps/daemon test
pnpm -C apps/daemon typecheck
pnpm -C packages/protocol test
pnpm -C packages/protocol typecheck
pnpm -C apps/web test
pnpm -C apps/web typecheck
pnpm lint
pnpm typecheck
git diff --check
```

Expected: all available checks pass with pristine output. If local ShellCheck or Dash is unavailable, run the remaining checks, record the missing local tool, and require the new Ubuntu CI job to prove it before acceptance.

- [ ] **Step 5: Run focused manual fixture smokes**

Using only harness-generated local assets and fake external commands:

```bash
node --test --test-name-pattern='fresh local install' 'scripts/installer/*.test.mjs'
node --test --test-name-pattern='fresh Docker install' 'scripts/installer/*.test.mjs'
node --test --test-name-pattern='rolls back' 'scripts/installer/*.test.mjs'
node --test --test-name-pattern='ordinary uninstall' 'scripts/installer/*.test.mjs'
node --test --test-name-pattern='purge' 'scripts/installer/*.test.mjs'
```

Expected: local/Docker install, update rollback, ordinary uninstall, and purge contracts pass without contacting production or mutating the host.

- [ ] **Step 6: Verify the phase boundary**

```bash
git diff d412e984a..HEAD -- .github/workflows/release.yml .github/workflows/server-release.yml README.md docs/DISTRIBUTION.md apps/website
git grep -n 'zosma-cowork:latest\|install\.zosma\.ai | sh' -- ':!docs/superpowers/**' ':!install.sh'
git status --short
```

Expected: no release-workflow or public-documentation diff, no generated mutable runtime image reference, and only intended Phase 3 files are changed before the final commit.

- [ ] **Step 7: Commit CI coverage**

```bash
git add package.json .github/workflows/ci.yml scripts/installer/ci-contract.test.mjs
git commit -m "ci: verify Cowork installer lifecycle"
```

- [ ] **Step 8: Verify final history and clean worktree**

```bash
git status --short --branch
git log -10 --oneline
```

Expected: ten Phase 3 commits are present and the worktree is clean. Stop here. Do not implement Phase 4 publication, stable-channel promotion, domain configuration, or documentation.
