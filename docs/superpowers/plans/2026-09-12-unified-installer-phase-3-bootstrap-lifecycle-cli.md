# Bootstrap Installer and `zosma` Lifecycle CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user install and manage either the self-contained local Cowork server or the digest-pinned production container through one audited bootstrap and one dependency-free POSIX `zosma` command.

**Architecture:** A small root `install.sh` performs release selection, manifest/checksum verification, and exact delegation as `"$candidate" install "$@"` to the verified temporary CLI candidate. That candidate validates mode/platform before persistent activation, then the standalone `scripts/zosma` asset owns its generation activation together with local/Docker installation, strict configuration parsing, user-service integration, authenticated health checks, lifecycle commands, crash recovery, rollback, and allowlisted uninstall. Node's built-in test runner executes the shell programs under temporary HOME/XDG roots with stubbed external commands; no test contacts a production endpoint or host service manager.

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

- Local archives are named `zosma-cowork-server-<version>-<platform>-<arch>.tar.gz`. Installer fixtures and validation use the exact `scripts/package-server-release.mjs` required-entry contract:

  ```text
  runtime/bin/node
  runtime/lib/node_modules/npm/bin/npm-cli.js
  runtime/lib/node_modules/npm/bin/npx-cli.js
  web/dist-server/server.js
  web/dist-server/bin/pi-web.js
  daemon/src/index.ts
  daemon/bin/zosma-daemon.js
  supervisor/run-server.mjs
  supervisor/healthcheck.mjs
  VERSION
  ```
- The local supervisor requires `PORT`, `PI_WEB_HOSTNAME`, `PI_WEB_NO_OPEN=1`, `PI_CODING_AGENT_DIR`, `ZOSMA_DAEMON_DATA_DIR`, `ZOSMA_DAEMON_PORT`, and `ZOSMA_DAEMON_TOKEN`. Phase 3 preserves that contract while moving signal-driven cleanup before the first spawn so startup interruption cannot orphan children.
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
- Each manifest URL basename must equal its fixed release asset name. `SHA256SUMS` accepts only `64hex + whitespace + optional "*" + exact basename`; the selected basename must appear exactly once. Missing, duplicate, conflicting, or malformed selected entries fail. Hash the fixed temporary download path directly and require the actual bytes, manifest digest, and checksum-list digest to agree.
- Every production request uses `curl -fL --proto '=https' --proto-redir '=https' --tlsv1.2`; redirects may not change protocol. Downloads also use bounded connection and transfer times.
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

Both parsers split at the first `=`, assign only fixed keys through explicit `case` arms, validate every assigned value, ignore unknown config keys with a warning, reject unknown secret keys, and never use `source`, `.`, `eval`, command substitution, or dynamic variable names. Every required known key must appear exactly once. Directories are mode `0700`; config, secrets, generated Compose, systemd unit, and LaunchAgent are mode `0600`.

Validate the complete record before lifecycle or deletion:

| Invariant | Local | Docker |
|---|---|---|
| `HOME` | Non-empty absolute path | Non-empty absolute path |
| XDG bases | Absolute when set; ignore a relative value with a warning and use the fallback | Same |
| CR/LF | Reject in every persisted value | Same |
| `MODE` | `local` | `docker` |
| `VERSION` / `PORT` | Canonical version; decimal `1..65535` | Same |
| Bind/auth | Loopback requires host `127.0.0.1` and empty web password; LAN requires `0.0.0.0`, valid host, and generated password | Same |
| `PI_DIR` | Absolute resolved external path | Exactly the installer-owned absolute Docker Pi-state path |
| `WORKSPACE` / `IMAGE` | Both empty | Existing absolute workspace and exact approved GHCR digest |
| `SERVICE_MANAGER` | Static only: `systemd` on Linux with the expected marked unit/link, `launchd` on macOS with the expected marked plist, otherwise `none` | Always `none` |
| Secrets | Daemon token is 64 lowercase hex characters; web password follows bind invariant | Same |

The marker filename is exactly `.zosma-cowork-owned`; its sole line is `ZOSMA_COWORK_INSTALLER_SCHEMA=1`. Require that private regular file in every installer-owned path that exists. Common CLI activation marks `DATA_ROOT`, `CONFIG_ROOT`, `STATE_ROOT`, `DATA_ROOT/cli`, `CLI_VERSIONS`, and each CLI version directory/generation. Local mode additionally marks `DATA_ROOT/runtime`, `RUNTIME_VERSIONS`, and each runtime version directory/generation when local runtime artifacts exist. Docker mode additionally marks `DOCKER_ROOT` and `DOCKER_PI_STATE` when Docker config/state exists. Active transactions mark `STATE_ROOT/transaction` and every stage/snapshot directory. A mode must not create unused roots for the other mode. Generated systemd, plist, and Compose files carry `ZOSMA_COWORK_INSTALLER_SCHEMA=1` as a format-safe comment. The config file is the sole active-mode record; do not create a second mode marker. Existing fixed paths are mutable only when they are absent or have the exact marker/expected target. A regular `$HOME/.local/bin/zosma`, unmarked service/plist/Compose file, out-of-root `current` link, or symlinked installer root is a collision and must be refused.

### Recovery-only CLI state

A missing config with an expected launcher to a marked in-root CLI generation is a valid recovery-only CLI state, not an active mode. `install` may retry normally. Direct `uninstall` in this state removes only the marked CLI generations/version directories, `cli/current`, stable launcher, and empty marked common roots; it does not infer a mode and never touches a service definition, Compose file, runtime tree, workspace, local Pi path, or existing Docker Pi state. Repeating that direct uninstall returns `0`. Missing config with unexpected or unmarked CLI artifacts remains a collision and is refused without mutation.

### Installation layout

Resolve paths once per invocation without creating them:

```text
BIN_DIR=${HOME}/.local/bin
DATA_ROOT=${XDG_DATA_HOME:-$HOME/.local/share}/zosma-cowork
CONFIG_ROOT=${XDG_CONFIG_HOME:-$HOME/.config}/zosma-cowork
STATE_ROOT=${XDG_STATE_HOME:-$HOME/.local/state}/zosma-cowork
TRANSACTION_ROOT=$STATE_ROOT/transaction
TRANSACTION_JOURNAL=$TRANSACTION_ROOT/journal
CLI_VERSIONS=$DATA_ROOT/cli/versions
CLI_GENERATIONS=$CLI_VERSIONS/<version>/generations
CLI_CURRENT=$DATA_ROOT/cli/current
RUNTIME_VERSIONS=$DATA_ROOT/runtime/versions
RUNTIME_GENERATIONS=$RUNTIME_VERSIONS/<version>/generations
RUNTIME_CURRENT=$DATA_ROOT/runtime/current
DOCKER_PI_STATE=$DATA_ROOT/docker/pi-agent
DOCKER_ROOT=$CONFIG_ROOT/docker
SYSTEMD_UNIT=${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/zosma-cowork.service
LAUNCH_AGENT=$HOME/Library/LaunchAgents/ai.zosma.cowork.plist
```

Each verified install/reinstall creates a unique immutable generation under its semantic version, including same-version reinstalls. A sibling `.stage-*` directory is renamed to a unique `generation-*` directory only after validation; `current` selects the generation directory. The stable launcher continues to select `cli/current/zosma`. Retention follows generation targets, not version names, so current and immediately previous may share the same semantic version.

Local `PI_DIR` is the absolute value of `PI_CODING_AGENT_DIR`, when set, otherwise `$HOME/.pi/agent`. Never inspect, create, copy, migrate, or delete that local external path. Resolve existing HOME/XDG bases physically, refuse installer roots/current links that are symlinks outside their expected generation roots, and never treat a user-supplied path as installer-owned.

### Exit statuses

Use and test these stable command-level statuses:

- `0`: success
- `2`: invalid usage or malformed local configuration
- `3`: unsupported platform or missing prerequisite
- `4`: release download, manifest, checksum, digest, or archive verification failure
- `5`: runtime start, stop, health, or rollback failure
- `6`: explicit user cancellation
- `1`: unexpected internal failure only

Lifecycle meanings are fixed:

| Command/state | Exit |
|---|---:|
| `version`, valid `access`, healthy `status`, successful lifecycle/install/update/uninstall | `0` |
| `status` stopped or unhealthy | `5` |
| `doctor` valid-but-stopped or optional-Git-degraded | `0` with warning |
| `doctor` malformed/insecure installation | `2` |
| `doctor` required runtime/prerequisite missing | `3` |
| `start`/`stop`/`restart`/`status`/required uninstall with a recorded-but-unavailable manager | `5` |
| `update`/reinstall/uninstall with an occupied foreground-only managed port | `5` |
| `start`/`restart`/`open`/`update` health failure, unexpected `serve` exit, or failed rollback | `5` |
| Idempotent stop of an already stopped managed mode | `0` |
| Unsupported command/flag/mode combination | `2` |
| Declined menu/reinstall/purge confirmation | `6` |

Define `INTERACTIVE=1` only when a controlling TTY is available and `--yes` is absent. An explicit mode on a TTY remains interactive. `--yes` suppresses all ordinary prompts, browser opening, and one-time password display even when a TTY exists. Without a TTY, install requires `--yes`, explicit mode, and all mode-required values. Purge always requires a TTY confirmation and ignores `--yes` for that confirmation.

### Dry-run scopes

The two entry points intentionally have different dry-run depth:

- `install.sh --dry-run` validates prerequisites, OS/architecture, release selection, and the manifest, then reports the prospective version/CLI asset. It does not download checksums or CLI/runtime assets and cannot validate CLI-owned mode/workspace/hostname choices.
- An installed or directly invoked `zosma install --dry-run` validates the complete mode request, including local libc or Docker workspace/LAN requirements, while performing no asset download, secret generation, write, start, browser call, or deletion.

Both help outputs state that distinction. Do not duplicate lifecycle option validation in the bootstrap.

### Production platform probes

Do not implement production detection through test-result overrides:

- OS and architecture: parse `uname -s` and `uname -m`; normalize only the documented Linux/macOS tuples.
- Linux libc for **local mode only**: first parse `getconf GNU_LIBC_VERSION`; if unavailable, parse `ldd --version`. Accept GNU libc `>=2.35`; reject musl, unknown libc, or older GNU libc for local mode while still allowing Docker selection on supported Linux architectures.
- macOS: parse `sw_vers -productVersion` and require major version `>=13` for either mode.
- WSL2: detect `microsoft` case-insensitively in `/proc/sys/kernel/osrelease` or `uname -r`.
- systemd user manager: installation-time selection and each lifecycle operation check `systemctl --user show-environment`; this liveness result is not config validity. A custom unit outside the manager's current search path is made visible with `systemctl --user link <absolute-unit>` before `daemon-reload`/`enable`. A later-unavailable recorded manager leaves config valid but makes `start`/`stop`/`restart`/`status`/required uninstall return `5`; `doctor` reports the runtime-manager failure as `5`. A fresh Linux install with no manager records `none` and remains a valid foreground installation.
- launchd user manager: installation-time selection and each lifecycle operation first check domain liveness with `launchctl print gui/$(id -u)`. Only after that succeeds may `launchctl print gui/$(id -u)/ai.zosma.cowork` determine loaded/running service state. A live domain with an absent or stopped service is valid-but-stopped. A later-unavailable domain for recorded `launchd` leaves config valid but makes manager-required lifecycle operations and `doctor` return `5`. A fresh macOS local install with no GUI domain records `none`, installs no plist, and directs the user to foreground `zosma serve`.

Tests stub the commands and their real output shapes. Ubuntu/macOS CI also exercises native detection without stubbing the result.

### Foreground-only mutation safety

A local installation with `SERVICE_MANAGER=none` has no ownership-safe external stop operation. Before journal creation, self-copy, link/config mutation, or deletion, `update`, reinstall, and uninstall probe both the configured web port and fixed daemon port with the bundled Node probe. If either port is occupied—even when authenticated health fails—the command returns `5` with Ctrl-C guidance and changes nothing. Do not guess process ownership or kill by discovered PID. For stopped foreground update/reinstall, require POSIX `mkfifo`; if unavailable, return `3` before journal creation or mutation.

When both ports are free, update/reinstall records `OLD_WAS_RUNNING=0`, switches the validated candidate transactionally, and health-validates it as a temporary transaction-owned child. This child is not a persistent background manager: create a private FIFO in `STAGE_ROOT` and open it read/write in the parent before forking. The wrapper first opens its own read-only descriptor while the inherited read/write descriptor still prevents an open race, then closes the inherited descriptor, starts `serve --service`, and blocks on its read-only descriptor. The parent closes the lease after health success/failure; EOF makes the wrapper send `TERM`, wait 13 seconds—longer than `serve`'s 11-second bound—then send `KILL` only to its own still-running `serve` child and observe exit for at most 2 additional seconds. Every external command launched by the parent closes the lease descriptor. If the updater dies, its descriptor closes and the wrapper tears down the candidate. Remove the FIFO and wrapper state before `committed`; persist `candidate_started` after successful health, stop/wait the validation child, then persist `committed`, leaving the installation stopped. A death before `committed` releases the child and recovery restores the prior stopped generation/config. Tests kill the updater after each persisted phase and prove both ports become free without recovery killing an arbitrary PID.

For recorded `systemd` or `launchd`, update and reinstall require the recorded manager to be live before journal creation or other mutation; unavailable managers return `5`. Uninstall likewise completes its required manager stop before self-copy or deletion. These checks are separate from static config validity.

### Portable link replacement

Do not call `mv temporary-link parent/current`: when `current` points to a directory, implementations may treat it as the destination directory, and GNU `mv -T` is unavailable on macOS. For each `current` or launcher replacement:

1. create a temporary sibling directory under the destination's parent;
2. create inside it a symlink whose basename is exactly the final basename (`current` or `zosma`);
3. call `mv -f "$temporary_directory/$basename" "$destination_parent/"`, making the computed target exactly `$destination_parent/$basename` without passing the existing link as the destination operand;
4. remove the now-empty temporary directory.

Use the journal for crash recovery around the rename. Fresh local/Docker and update tests use the actual host `mv` (linked into the curated PATH), and the full test suite runs this replacement on native Linux and macOS.

### Atomic regular-file replacement

Journal/config writes do not use the symlink recipe. To replace the journal:

1. create a private temporary sibling directory under `TRANSACTION_ROOT`;
2. write a regular file named `journal` there with mode `0600`;
3. close the file after the complete fixed-key record is written;
4. call `mv -f "$temporary_directory/journal" "$TRANSACTION_ROOT/"`;
5. remove the empty temporary directory.

Use the same regular-file-to-parent pattern with the corresponding final basename for config snapshots. Tests assert the result is a regular non-symlink file with complete content and mode `0600` after every phase.

### Activation transaction journal

Write the journal atomically as mode `0600` at the exact path `TRANSACTION_JOURNAL=$STATE_ROOT/transaction/journal` with exactly these keys:

```text
TRANSACTION_SCHEMA=1
INSTALL_KIND=fresh|update|reinstall
MODE=local|docker
PHASE=prepared|old_stopped|runtime_switched|cli_switched|config_switched|candidate_started|committed
KEEP_VERIFIED_CLI=0|1
OLD_WAS_RUNNING=0|1
OLD_CLI_TARGET=<installer-owned generation or empty for fresh>
NEW_CLI_TARGET=<installer-owned generation>
OLD_RUNTIME_TARGET=<installer-owned generation or empty for fresh/Docker>
NEW_RUNTIME_TARGET=<installer-owned generation or empty for Docker>
OLD_CONFIG_BACKUP=<installer-owned transaction path or empty for fresh>
STAGE_ROOT=<installer-owned transaction stage>
DOCKER_STATE_PREEXISTED=0|1
OLD_IMAGE=<exact digest or empty for fresh/local>
NEW_IMAGE=<exact digest or empty for local>
```

`OLD_CONFIG_BACKUP` is a private marked snapshot directory containing the prior config, secrets, and generated service or Compose definition—not a user-supplied path. `STAGE_ROOT` contains fresh/candidate generated files and, for Docker, enough Compose state to run candidate `down` during recovery. Validate every journal field and target root before acting. Persist each phase using the atomic regular-file replacement recipe; the portable symlink recipe applies only to `current` and launcher links.

The journal covers fresh install, update, and reinstall. Local transitions are `prepared -> old_stopped -> runtime_switched -> cli_switched -> config_switched -> candidate_started -> committed`; Docker omits `runtime_switched`; it publishes candidate config at `config_switched`, performs Compose up and health, records `candidate_started` after successful health, then records `committed`. Recovery from Docker `config_switched` runs candidate `down` idempotently because Compose may have started before death. `--no-start` transitions from `config_switched` directly to `committed`. Fresh transactions still persist `old_stopped` to record that no old runtime was active, use empty old targets/config/image, `OLD_WAS_RUNNING=0`, and `KEEP_VERIFIED_CLI=1`. Before creating Docker Pi state, record whether the fixed path already exists as valid marked installer state in `DOCKER_STATE_PREEXISTED`; local transactions require `0`. Recovery stops/down the candidate if it may have started, removes runtime/config/secrets/service/Compose activation, leaves no active config record, and, among artifacts created by this transaction, may retain only the verified CLI generation/current launcher. Fresh-Docker rollback removes the fixed marked Pi-state root only when this transaction created it (`DOCKER_STATE_PREEXISTED=0`); previously existing marked state (`1`) is preserved byte-for-byte. Existing transactions restore old links/config/image and restart the old mode only when `OLD_WAS_RUNNING=1`. Any phase before `committed` conservatively restores the corresponding prior complete state; a surviving `committed` journal keeps the candidate and finishes retention/cleanup. Recover before every command dispatch. Tests inject process death after every persisted phase for fresh local, fresh Docker, update, and reinstall, including after candidate health but before `committed` and after `committed` but before journal removal.

### TDD execution rule

Within every numbered test list below, add one behavior (or the smallest inseparable behavior pair), run it to the expected failure, implement only enough to pass, and rerun before adding the next behavior. The listed task commit is the aggregation boundary, not permission to batch all tests before one implementation pass.

### Test-only seam

When and only when `ZOSMA_TESTING=1`, the scripts may honor `ZOSMA_TEST_MANIFEST_URL` and `ZOSMA_TEST_TTY`. Production execution ignores these variables. Platform/libc/manager tests must stub the production commands and outputs instead of bypassing their parsers.

---

### Task 1: Build the isolated shell harness and safe CLI foundation

**Files:**
- Create: `scripts/installer/test-helpers.mjs`
- Create: `scripts/installer/core.test.mjs`
- Create: `scripts/zosma`

- [ ] **Step 1: Create the temporary-home shell harness**

Add Node built-in helpers that:

- create isolated HOME, XDG data/config/state/cache, fixture, fake-bin, and command-log directories;
- set `PATH` to one curated fake-bin only: symlink explicitly enumerated safe utilities from the host, including POSIX `mkfifo` for foreground validation leases, install mandatory fail-closed/logging stubs for `curl`, `docker`, `systemctl`, `launchctl`, `open`, and `xdg-open`, and provide no fallback `/usr/bin:/bin` search;
- wrap `rm` so it rejects every target outside the harness root before delegating to the captured absolute host binary; tests fail if any hazardous command resolves outside fake-bin;
- write executable command stubs without embedding credentials;
- invoke the shell through its captured absolute `/bin/sh` path with captured stdout/stderr and an optional fixture TTY file;
- generate canonical manifests, `SHA256SUMS`, stamped CLI candidates, and minimum valid local archives on demand;
- clean every temporary root with `t.after`;
- never contact a network endpoint, real Docker daemon, systemd user manager, launchd domain, or browser.

Use placeholder random strings in all fixtures; never copy a real token, password, or credential into tests.

- [ ] **Step 2: Write failing CLI foundation tests**

Cover one behavior per test:

1. `version` prints the human-readable development version.
2. `version --machine` prints exactly `installer_schema=1` and `version=v0.0.0-dev` on separate lines.
3. Unknown commands/options return `2` and concise usage.
4. Absolute XDG variables select the fixed roots; unset or relative XDG values use documented fallbacks, with relative values warned and never used as deletion roots.
5. Empty/relative HOME and CR/LF in any persisted path fail before writes.
6. A hostile config value such as `$(touch sentinel)` remains literal and does not create the sentinel.
7. Every required key appears once; duplicate/malformed known fields and cross-mode invariant violations fail. Unknown config fields produce one warning and are ignored; unknown secret fields fail without printing values.
8. Source contains exactly one `ZOSMA_CLI_VERSION=v0.0.0-dev` assignment for Phase 4 stamping.

- [ ] **Step 3: Run the tests and verify the expected failure**

```bash
node --test scripts/installer/core.test.mjs
```

Expected: FAIL because `scripts/zosma` does not exist.

- [ ] **Step 4: Add the smallest POSIX CLI skeleton**

Implement in `scripts/zosma`:

- `#!/bin/sh`, `set -eu`, constants for schema/version/exit statuses, and a `main "$@"` call only at the final line;
- path resolution with no filesystem side effect;
- canonical version, absolute HOME/XDG path, and fixed config/secret invariant validators required by the foundation tests;
- fixed-key manifest/config/secret readers using `while IFS= read -r line` and `case`, never shell evaluation;
- `version`, `--help`, and stable dispatch;
- portable stderr/error helpers and ANSI color only when stdout is a terminal and `TERM != dumb`;
- a `ZOSMA_TESTING=1` source mode used only to call pure path/parser helpers without invoking `main`; production execution always reaches the sole final dispatch.

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
2. Bootstrap checks only OS/architecture and does not globally reject Linux libc; explicit local, explicit Docker, and no-mode flows all delegate unchanged to the verified temporary candidate, which applies mode-specific libc validation before persistent writes.
3. Stable and canonical `--version` inputs request only their fixed manifest URL.
4. Malformed, duplicate, incomplete, unknown-key, non-HTTPS, or schema-mismatched manifests return `4`.
5. A manifest containing shell syntax is treated as inert data.
6. Fake curl requires `--proto '=https' --proto-redir '=https'`, TLS 1.2, redirect following, and bounded time options on every request; an HTTPS-to-HTTP redirect is refused.
7. CLI digest mismatch, checksum-list disagreement, duplicate/conflicting selected entries, malformed selected grammar, wrong URL basename, invalid `sh -n`, or mismatched `version --machine` returns `4` without changing `current`.
8. A valid CLI remains in the bootstrap temporary directory and is invoked directly; bootstrap creates no CLI generation, `current`, launcher, or ownership marker before candidate mode/platform validation.
9. A fresh no-mode fixture candidate that selects unsupported local exits `3` with no persistent install roots/current/launcher, while selecting Docker can proceed to candidate-owned activation.
10. Bootstrap `--dry-run` validates only release selection/manifest, reports the prospective CLI, clearly says full mode validation requires `zosma install --dry-run`, and performs no checksum/CLI/runtime download or write.
11. Temporary downloads disappear on success, failure, `INT`, and `TERM`.
12. Every truncation before the final `main "$@"` line performs no write or command invocation; the complete script does run.
13. The candidate argv is exactly `candidate`, `install`, then every original argument in order and unchanged; the verified manifest is supplied through `ZOSMA_INSTALL_MANIFEST` without printing its path or fixture credentials.
14. With an existing installation, bootstrap invokes the verified temporary candidate directly while leaving `cli/current` unchanged; the candidate creates its generation and journal. Child failure/cancellation or process death before journal creation leaves the prior CLI/runtime active.
15. Bootstrap forwards `INT`/`TERM` to its delegated child, waits for it, cleans temporary files, and preserves the old pair.

- [ ] **Step 2: Run the bootstrap tests and verify the expected failure**

```bash
node --test scripts/installer/bootstrap.test.mjs
```

Expected: FAIL because `install.sh` does not exist.

- [ ] **Step 3: Add the minimal bootstrap**

Implement only:

1. strict bootstrap options, prerequisite checks, and OS/architecture detection only; mode-specific libc/workspace/hostname validation belongs exclusively to the temporary CLI candidate;
2. stable or exact manifest resolution;
3. strict fixed-key manifest parsing;
4. temporary download of manifest, `SHA256SUMS`, and `zosma-<version>` via `curl -fL --proto '=https' --proto-redir '=https' --tlsv1.2 --connect-timeout 10 --max-time 300` in production;
5. exact URL basename and unambiguous checksum grammar plus agreement of manifest digest, checksum-list entry, and downloaded bytes;
6. `sh -n` plus exact candidate `version --machine` validation after checksum verification;
7. exact invocation `"$candidate" install "$@"` with verified manifest context, behaviorally tested for the prepended command and unchanged original argv; bootstrap performs no persistent activation itself;
8. fresh-install handoff in which the candidate selects and validates mode/platform before creating ownership markers or generations, then journals CLI/runtime/config activation and may retain the verified CLI on later mode-install failure;
9. existing-install handoff in which the temporary candidate creates its immutable generation and Phase 3 transaction journal before switching CLI/runtime/config while `cli/current` remains old;
10. traps that forward `INT`/`TERM` to the delegated child, wait, preserve the prior active pair, and clean temporary files;
11. all function definitions before the sole final `main "$@"` invocation.

Bootstrap `--dry-run` exits immediately after strict manifest validation and prospective CLI reporting; it does not download `SHA256SUMS` or the CLI and does not claim mode validation. The bootstrap must not download/extract a server archive, call Docker, generate secrets/configuration, manage services, or duplicate lifecycle logic.

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

### Task 3: Validate interactive and non-interactive install requests

**Files:**
- Create: `scripts/installer/configuration.test.mjs`
- Create: `scripts/installer/native-platform.test.mjs`
- Modify: `scripts/zosma`

- [ ] **Step 1: Write failing configuration tests**

Cover:

1. No supplied mode reads the documented menu from the test TTY and accepts only `1`, `2`, or `3`; cancellation returns `6`.
2. No mode without a controlling TTY returns `2`; it never guesses in CI.
3. `--yes` defines non-interactive behavior even with a TTY. No-TTY install requires `--yes`, explicit mode, and every required value; explicit mode without `--yes` remains interactive when a TTY exists.
4. Non-interactive Docker requires `--workspace`; LAN additionally requires `--hostname`.
5. Port accepts only decimal `1..65535`; workspace must already exist, be a directory, be absolute, and contain no CR/LF.
6. Hostnames reject schemes, ports, paths, whitespace, shell metacharacters, CR/LF, and empty labels.
7. `--mode` and positional mode agree; conflicting or repeated scalar options and install-only options on other commands return `2`.
8. Stubbed production probes allow musl/old-glibc users to choose Docker but reject local mode; an interactive musl host can reach and choose the Docker menu entry.
9. Local dry-run resolves a custom absolute `PI_CODING_AGENT_DIR` or `$HOME/.pi/agent` without reading or creating it.
10. Direct/installed `zosma install --dry-run` performs the full CLI-owned manifest/mode/local-libc/workspace/hostname validation, prints a redacted plan, and performs no artifact download, secret generation, path creation, start, browser call, or deletion.
11. `native-platform.test.mjs`, enabled by `ZOSMA_NATIVE_PROBE=1`, uses actual runner `uname` plus libc or `sw_vers` output through curated safe command links and verifies the detected local tuple through dry-run output.

- [ ] **Step 2: Run and observe the expected failures**

```bash
node --test scripts/installer/configuration.test.mjs
```

Expected: FAIL because install-option, TTY, production-probe, and dry-run behavior is not implemented.

- [ ] **Step 3: Implement install request validation**

Extend `scripts/zosma` with:

- the exact public install options from the design;
- the fixed `INTERACTIVE`/`--yes` semantics;
- controlling-TTY detection and all prompts through `/dev/tty` (the guarded test TTY only under `ZOSMA_TESTING=1`);
- strict mode/port/workspace/hostname validation before writes;
- the real platform/libc/WSL probes defined above, with libc validation deferred until local mode is selected;
- redacted dry-run summaries and local Pi-directory resolution as string/path normalization only.

Do not generate or persist secrets/configuration in this task. Task 3 reaches green through the real `install --dry-run` behavior; final storage, permissions, and disclosure tests begin with complete local and Docker install transactions in Tasks 4 and 6.

- [ ] **Step 4: Run configuration and earlier checks**

```bash
sh -n scripts/zosma
node --test scripts/installer/core.test.mjs scripts/installer/configuration.test.mjs
ZOSMA_NATIVE_PROBE=1 node --test scripts/installer/native-platform.test.mjs
shellcheck -s sh scripts/zosma
```

Expected: all tests pass.

- [ ] **Step 5: Commit install request validation**

```bash
git add scripts/zosma scripts/installer/configuration.test.mjs scripts/installer/native-platform.test.mjs
git commit -m "feat: validate Cowork install requests"
```

### Task 4: Install local archives transactionally and generate user services

**Files:**
- Create: `scripts/installer/local-install.test.mjs`
- Modify: `scripts/run-server.mjs`
- Modify: `scripts/run-server.test.mjs`
- Modify: `scripts/zosma`

- [ ] **Step 1: Write failing local-install and supervisor shutdown tests**

Use generated archives with the exact Phase 1 shape and fail-closed fake `curl`, `systemctl`, `launchctl`, and browser commands. Cover:

1. The selected platform tuple picks exactly its manifest archive URL/name/digest. Direct and no-mode bootstrap-to-candidate local selection on musl/old glibc returns `3` before any persistent root/current/launcher; the equivalent Docker menu path is completed in Task 6.
2. Manifest, unambiguous `SHA256SUMS`, and downloaded archive must agree before extraction.
3. Required entries exactly match `assertRuntimeTree`: bundled node/npm/npx, web `server.js`/`bin/pi-web.js`, daemon `src/index.ts`/`bin/zosma-daemon.js`, both supervisor files, and `VERSION`.
4. Corrupt archives, wrong `VERSION`, absent/non-regular required entries, absolute/parent-traversing members, dangling symlinks, or extracted symlinks escaping the stage return `4` before activation.
5. A valid fresh archive stages beside its destination, validates, renames to one immutable generation, and updates `runtime/current` through the portable replacement recipe.
6. Secret generation reads `/dev/urandom` through curated utilities and produces independent fixed-length lowercase-hex values. Loopback stores an empty web password; LAN stores a non-empty one.
7. Config/secrets and containing directories use `0600`/`0700`; no secret or six-character prefix appears in output, fake-command argv logs, or generated service arguments.
8. Interactive LAN install writes the password once to TTY only; `--yes`/non-interactive install reports only the secrets-file path.
9. Linux with an active user manager renders a marked private user unit invoking `$HOME/.local/bin/zosma serve --service`, captures HOME plus resolved XDG data/config/state bases and `PI_CODING_AGENT_DIR`, uses `systemctl --user link` when the custom-XDG unit is outside the running manager's load path, then reloads/enables it.
10. macOS with a live `gui/<uid>` domain renders a marked `ai.zosma.cowork.plist` with stable CLI arguments, KeepAlive, log paths, HOME/XDG/Pi environment, and installer ownership marker; domain liveness is probed before any service-specific query.
11. Service output safely represents spaces, `%`, backslashes, quotes, ampersands, and XML characters; CR/LF is rejected. Native macOS fixtures pass `plutil -lint`. Linux fixtures create an executable fake stable launcher at the rendered `ExecStart` path and pass `systemd-analyze --user verify`.
12. Existing unmarked unit/plist collisions, launcher regular files, unexpected `current` targets, or symlinked installer roots are refused without overwrite.
13. WSL2 or Linux without an active systemd user manager, and macOS without a live `gui/<uid>` launchd domain, commit `SERVICE_MANAGER=none`, install no manager definition, and direct the user to `zosma serve`.
14. Before local activation, the staged bundled Node probes both web and fixed daemon ports; an occupied web port suggests `--port`, while an occupied fixed daemon port explains that the conflicting listener must be stopped; either leaves no active mode.
15. `--no-start` commits the statically verified installation as stopped and performs no health/browser command.
16. Default non-interactive install starts and health-checks but never opens a browser; interactive install opens only after health succeeds.
17. Any ordinary failure before commit removes stage/config/secrets/marked service files and leaves no active config/runtime; a post-start health failure stops the attempted service. Pre-existing unrelated files and external local Pi data remain byte-for-byte untouched.
18. Process death after every fresh-local persisted journal phase recovers on the next invocation to no active config/runtime/service; `KEEP_VERIFIED_CLI=1` may retain only the verified CLI generation/current/launcher.
19. Minimal `serve` and `serve --service` exist before any generated manager can start them. They launch `runtime/current/runtime/bin/node runtime/current/supervisor/run-server.mjs` as the foreground child, forward `INT`/`TERM`, wait, return `0` for clean shutdown, and map every non-zero supervisor exit to `5`; service mode suppresses interactive/browser behavior.
20. The spawned supervisor receives every mandatory fixed variable and the exact persisted-to-runtime mappings: `PORT` unchanged, `BIND_ADDRESS` to `PI_WEB_HOSTNAME`, `ALLOWED_HOST` to `PI_WEB_ALLOWED_HOSTS`, `WEB_PASSWORD` to `PI_WEB_PASSWORD`, local `PI_DIR` to `PI_CODING_AGENT_DIR`, plus `PI_WEB_NO_OPEN=1`, fixed validated `ZOSMA_DAEMON_DATA_DIR`, `ZOSMA_DAEMON_PORT`, and `ZOSMA_DAEMON_TOKEN`. Secrets appear in neither output nor supervisor argv.
21. Separate behavior tests deliver `SIGINT` and `SIGTERM` through the direct-run signal seam while daemon readiness is blocked and while web readiness is blocked. The supervisor aborts the wait immediately, spawns no later child, signals every already-spawned child, waits for their exits, and completes requested shutdown with status `0`.
22. The direct runner installs both signal handlers before calling the startup routine, removes them after completion, distinguishes requested shutdown (`0`) from startup failure (`1`), and remains testable through injected process/signal functions rather than source inspection.
23. A child that ignores the first signal is escalated only after the supervisor grace period and is still waited after `SIGKILL`. Injected short deadlines prove the supervisor finishes within its inner bound, `serve` allows a larger bound before escalating its owned supervisor, and the Task 7 lease wrapper's bound is larger again.

- [ ] **Step 2: Run and observe the expected failures**

```bash
node --test scripts/run-server.test.mjs scripts/installer/local-install.test.mjs
```

Expected: FAIL because local archive/service installation does not exist and the supervisor does not yet clean up children when signaled during startup.

- [ ] **Step 3: Harden startup shutdown, then implement local installation**

First harden `scripts/run-server.mjs` without changing its public runtime/environment contract:

- install direct-mode `SIGINT`/`SIGTERM` handling before awaiting startup or spawning the first child;
- pass a shutdown signal into `startSupervisor`/readiness waits so requested shutdown aborts polling/sleep immediately, prevents later child spawn, invokes the same idempotent `stop`, waits every spawned child, and resolves as clean status `0` rather than startup failure;
- remove direct-mode handlers after completion and retain status `1` for genuine startup errors;
- stop children in parallel, allow at most 5 seconds after `SIGINT`/`SIGTERM`, send `SIGKILL` only to still-running owned children, then observe exit for at most 2 additional seconds before completing cleanup.

Then extend `scripts/zosma` to:

- resolve or consume the verified manifest, then download archive and checksum list;
- verify exact basename and unambiguous three-way digest agreement before `tar -xzf`;
- reject absolute or parent-traversing archive members before extraction, validate the exact Phase 1 required-entry list, require `runtime/bin/node` itself to be a non-symlink regular executable, then use that verified bundled Node runtime to ensure all other required entries resolve to regular files and every extracted symlink stays within the generation root;
- after mode/platform validation, create the candidate's protected CLI generation, config/secrets, and unique immutable runtime generation;
- probe both local ports with the staged bundled Node before activation;
- persist a `fresh`/`prepared` transaction before any CLI/runtime/config/service link or file becomes active, advance every phase around activation/start/health, and use the portable link-replacement recipe;
- render marked private systemd/LaunchAgent definitions directly from the standalone CLI, safely escaping HOME/XDG/Pi/log paths and invoking only the stable launcher;
- refuse unowned collisions and unexpected roots/links; link a custom-XDG systemd unit into the active user manager before reload/enable;
- detect systemd with `systemctl --user show-environment` and launchd domain liveness with `launchctl print gui/$(id -u)`, selecting foreground fallback without root or `sudo` when either user manager is unavailable;
- activate config (the sole mode record), secrets, marked service definition, `cli/current`, stable launcher, and `runtime/current` only after all static checks pass, then report missing PATH without editing profiles;
- start by default, use authenticated health, open only for an interactive successful install, and perform fresh-install cleanup on failure;
- leave the verified CLI installed when mode installation fails;
- implement minimal `serve`/`serve --service` before starting any generated service: strictly parse config/secrets, export `PORT`, `PI_WEB_HOSTNAME=$BIND_ADDRESS`, `PI_WEB_ALLOWED_HOSTS=$ALLOWED_HOST`, `PI_WEB_PASSWORD=$WEB_PASSWORD`, `PI_CODING_AGENT_DIR=$PI_DIR`, `PI_WEB_NO_OPEN=1`, and the validated daemon data/port/token variables, then remain the signal-forwarding parent of the bundled Node supervisor and map non-zero child exits to `5`. After forwarding shutdown, `serve` waits up to 9 seconds so the supervisor's 7-second child cleanup can finish, then sends `SIGKILL` only to its still-running owned supervisor and observes exit for at most 2 more seconds; its total bound is 11 seconds.

The systemd unit and LaunchAgent must not contain daemon/web secrets. `serve --service` reads the protected fixed-key files and exports the required runtime environment before executing the bundled Node supervisor.

- [ ] **Step 4: Validate generated definitions and transaction behavior**

```bash
sh -n scripts/zosma
node --test scripts/run-server.test.mjs
node --test scripts/installer/local-install.test.mjs
node --test scripts/installer/*.test.mjs
pnpm test:server
shellcheck -s sh scripts/zosma
```

On Linux, additionally create the executable fake launcher referenced by `ExecStart`, render the fixture unit into a temporary root, and run `systemd-analyze --user verify` against it without installing it. On macOS, run native `plutil -lint` against the rendered fixture plist. Expected: all tests pass and no host service starts.

- [ ] **Step 5: Commit local installation**

```bash
git add scripts/run-server.mjs scripts/run-server.test.mjs scripts/zosma scripts/installer/local-install.test.mjs
git commit -m "feat: install local Cowork runtimes"
```

### Task 5: Implement local lifecycle, health, diagnostics, and access

**Files:**
- Create: `scripts/installer/local-lifecycle.test.mjs`
- Modify: `scripts/zosma`

- [ ] **Step 1: Write failing local lifecycle tests**

Cover each command and mode branch separately:

1. Every systemd manager-dependent operation probes `systemctl --user show-environment` before its service command; a stopped service under a live manager remains distinguishable from an unavailable manager.
2. Every launchd manager-dependent operation first probes `launchctl print gui/<uid>`, then queries `gui/<uid>/ai.zosma.cowork`; a live domain with an absent/stopped service is valid-but-stopped, while an unavailable recorded domain makes the operation and `doctor` return `5`.
3. `start`, `stop`, and `restart` map to the selected systemd user or launchd domain commands, preserve captured HOME/XDG/Pi values under a clean manager environment, and wait for the expected health transition.
4. With `SERVICE_MANAGER=none`, `start` explains `zosma serve`; `stop`/`restart` refuse to kill a foreground process and mention Ctrl-C.
5. `status` reports installed mode/version, manager state, and authenticated application health: healthy returns `0`, stopped/unhealthy returns `5`; `doctor` follows the fixed table above.
6. Health credentials and Host header are supplied through a mode-`0600` temporary curl config, never argv. Every request has connect/total limits plus a portable watchdog; a fake curl that blocks until killed causes bounded exit `5`, cleanup, and update rollback where applicable, with no secret/prefix in output, argv logs, or leftover files.
7. Managed `logs` reads/follows only the installer state log paths; foreground mode explains that logs remain in the owning terminal.
8. `open` first requires successful health, then invokes `xdg-open` on Linux/WSL or `open` on macOS with the configured URL.
9. `doctor` checks platform, archive entries, config permissions, port/health, manager availability, optional Git, and explains degraded Git without failing core health.
10. `access` prints URL and LAN username but no password.
11. `access --show-password` requires TTY confirmation and writes the password only to the TTY; cancellation returns `6`; loopback reports that no password is configured.
12. Configured-mode lifecycle commands fail safely on absent, malformed, or unsupported-schema configuration; `version` remains config-independent, and Task 9 defines the no-config uninstall recovery path.
13. A marked static `SERVICE_MANAGER=systemd|launchd` config remains valid when that manager later becomes unavailable: manager-dependent commands and `doctor` return `5`, not malformed-config `2`; a valid `none` fallback remains usable for `serve`.

- [ ] **Step 2: Run and observe the expected failures**

```bash
node --test scripts/installer/local-lifecycle.test.mjs
```

Expected: FAIL because lifecycle dispatch still lacks these implementations.

- [ ] **Step 3: Implement the local lifecycle commands**

Add only small mode-dispatched functions. Use:

- manager commands without `sudo`: systemd install runs `daemon-reload` plus `enable` and optionally `start`, lifecycle uses `start`/`stop`/`restart`, and uninstall uses `disable --now`; launchd first probes the user domain, then uses `bootstrap gui/<uid> <plist>`, `bootout gui/<uid>/ai.zosma.cowork`, `kickstart -k`, and service-specific `print`, with an absent service under a live domain handled idempotently but an unavailable recorded domain reported as runtime failure;
- bounded authenticated health polling with per-request `--connect-timeout`/`--max-time`, an overall deadline, and a POSIX background-process watchdog so even a stalled curl is killed;
- a mode-`0600` temporary curl config for Basic auth and Host selection so secrets never enter argv, removed on every signal/outcome;
- fixed log paths under `STATE_ROOT`;
- explicit foreground ownership rules rather than PID-file killing; `serve` remains the signal-forwarding parent of the supervisor and maps its non-zero status to `5`;
- platform-native browser commands only after health succeeds;
- static config validation independent of current manager liveness, plus operation-time manager checks and read-only doctor checks with Git optional for local mode.

Do not implement a generic process manager or persistently background the supervisor. The Task 7 FIFO-leased validation child is the sole bounded temporary exception and must be stopped and waited before command return.

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
- Create: `scripts/installer/generated-compose.test.mjs`
- Modify: `scripts/zosma`

- [ ] **Step 1: Write failing Docker-mode tests**

Cover:

1. Missing Docker or Compose v2 returns `3` before configuration writes; a full no-mode bootstrap-to-candidate flow on musl/old glibc can select Docker and complete without local-libc rejection.
2. Workspace validation happens before pull/generation; relative, missing, file, or newline-containing paths fail.
3. Only `ghcr.io/zosmaai/zosma-cowork@sha256:<64 lowercase hex>` is accepted; tags and other repositories fail.
4. `docker pull` targets the exact manifest digest and local `RepoDigests` must contain that exact reference before activation, including `--no-start` installs.
5. Generated Compose/config/secrets use the fixed private modes and ownership marker, semantically match `deploy/compose.yml.template`, use host UID/GID and loopback by default, and have exactly workspace/Pi-state mounts.
6. Paths containing spaces, `#`, `$`, `${...}`, quotes, ampersands, and backslashes survive config parsing and Compose interpolation without evaluation; CR/LF is rejected.
7. Lifecycle calls export fixed validated variables then invoke `docker compose -p zosma-cowork -f <private-file>`; no secret appears in argv/logs.
8. Default install publishes config and persists `config_switched` before `up -d`, waits for authenticated health, then persists `candidate_started` and `committed`; captured phase/command order proves no alternative ordering. It never opens a browser non-interactively.
9. Interactive install opens only after health. `--no-start` still pulls and inspects the exact digest and commits generated configuration, but omits Compose up, health, and browser actions.
10. Failed pull/digest/generation/start/health or occupied host port removes fresh mode files and leaves no active mode. A failed Compose bind/start runs candidate down, removes fixed marked Docker Pi state created by that fresh transaction, and preserves byte-for-byte any valid marked Docker Pi state that pre-existed it.
11. Unmarked generated-file collisions, regular launcher/unexpected current links, or symlinked installer roots are refused without overwrite.
12. Docker `serve` returns `2` with guidance; `start`, `stop`, `restart`, `status`, `logs [--follow]`, `open`, `doctor`, and `access` map to Compose/shared behavior.
13. Doctor rejects forbidden generated policy (mutable tag, host network, privilege, socket, capabilities, devices, or extra mount).
14. On Ubuntu, `generated-compose.test.mjs` completes a fixture `--no-start` install with fake pull/inspect, then invokes the captured real Docker CLI outside the shell harness to parse both emitted Compose and `deploy/compose.yml.template`. Their canonical JSON models match under identical values and preserve every special path case.
15. Process death after every fresh-Docker journal phase—including after staged Compose `up`—recovers on the next invocation by running candidate `down`, removing active config/Compose/secrets and newly created marked Docker Pi state, and optionally retaining only the verified CLI. A separate fixture starts with valid marked Docker Pi state, records `DOCKER_STATE_PREEXISTED=1`, and proves recovery preserves it byte-for-byte.

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
- pull and inspect the exact RepoDigest before committing both started and `--no-start` installs;
- validate any existing fixed Docker Pi-state root before mutation, record `DOCKER_STATE_PREEXISTED`, then create the dedicated marked path only when absent and remove it on fresh rollback only when this transaction created it;
- after mode/prerequisite validation, create the candidate CLI generation and a fresh transaction stage containing protected secrets/config plus the marked canonical Phase 2 Compose template, refusing unowned collisions/roots;
- export only parsed and cross-field-validated values for Compose interpolation, so no `.env` file or secret-bearing argv is needed;
- use one fixed Compose project name and file path for all lifecycle commands;
- share authenticated health/access/open helpers with local mode;
- persist the `fresh` journal, switch CLI and then generated config/Compose, and record `config_switched` before invoking Compose; run `up`/health, record `candidate_started`, then record `committed`. Here config publication is an activation phase, while `committed` is the transaction decision after health. Install the stable launcher through the portable recipe and emit PATH guidance without editing profiles. Recovery uses journaled staged Compose to run down after death.

Do not add mutable tags, `docker run`, host networking, a socket, devices, capabilities, Tailscale, or more workspace mounts.

- [ ] **Step 4: Run Docker and complete installer tests**

```bash
sh -n scripts/zosma
node --test scripts/installer/docker-mode.test.mjs
node --test scripts/installer/*.test.mjs
pnpm test:docker
shellcheck -s sh scripts/zosma
```

Then, when real Docker Compose is available, run:

```bash
ZOSMA_REAL_COMPOSE=1 node --test scripts/installer/generated-compose.test.mjs
```

Expected: fixture tests do not call the real daemon; the opt-in test uses only real `docker compose config` parsing (no pull/up) and proves the installer-emitted model matches the Phase 2 template. All existing production Docker contract tests pass.

- [ ] **Step 5: Commit Docker mode**

```bash
git add scripts/zosma scripts/installer/docker-mode.test.mjs scripts/installer/generated-compose.test.mjs
git commit -m "feat: manage digest-pinned Docker installs"
```

### Task 7: Add schema-compatible local updates and crash-safe paired rollback

**Files:**
- Create: `scripts/installer/local-update.test.mjs`
- Modify: `scripts/installer/test-helpers.mjs`
- Modify: `scripts/zosma`

- [ ] **Step 1: Write failing local-update tests**

Cover:

1. `update` resolves stable metadata; `update --version` resolves only the canonical exact manifest.
2. Unsupported schema, malformed manifest, checksum failure, invalid candidate syntax, or candidate machine-version mismatch leaves current CLI/runtime/service/config unchanged.
3. A valid update stages and validates both CLI and local archive before stopping the old service.
4. Activation writes the exact journal schema and `prepared` phase before stopping anything, then atomically persists every defined phase while switching generation links/config and starting/health-checking the candidate.
5. Successful activation persists `committed` before cleanup, removes the journal, retains current and immediately previous generation targets (even when versions match), and prunes only older marked installer generations.
6. Candidate health failure restores both links/config and returns `5` while leaving the prior generation usable. If the prior managed runtime was running it is restarted and health-checked; a prior `SERVICE_MANAGER=none` installation remains stopped.
7. Failure of required managed rollback health returns `5` with both candidate and previous log locations; it never deletes either retained generation.
8. Injected `INT`, `TERM`, failure, or process death after every persisted non-committed phase triggers or later performs conservative paired restoration; a blocked health curl is killed and rollback begins within the overall deadline.
9. A journal found before command dispatch validates every target/backup path, restores the prior complete pair for non-committed phases, and finalizes the candidate for `committed`; malicious/out-of-root journal values are rejected without filesystem mutation.
10. The stable launcher always points to `cli/current/zosma` and is never version-rewritten during update.
11. Update output and fake command logs contain no secret material.
12. Generation switching uses the portable same-name move recipe with the actual host `mv`; native Linux and macOS runs prove an existing directory-target symlink is replaced rather than receiving a nested link.
13. A `SERVICE_MANAGER=none` update with either managed port occupied returns `5` before journal creation or mutation, preserves every file byte-for-byte, and prints Ctrl-C guidance; authenticated healthy and occupied-but-unhealthy fixtures are separate cases.
14. With both ports free, a `SERVICE_MANAGER=none` update validates the candidate under the private FIFO lease, records health, terminates/waits the child before `committed`, and leaves the successful installation stopped with no FIFO, wrapper, or process residue.
15. `INT`, `TERM`, ordinary failure, and forced updater death at every persisted phase—including immediately after wrapper fork—close the lease, terminate the validation child within the deadline, free both ports, and restore the prior stopped pair without killing an unrelated PID. Production `run-server.mjs` is exercised with fixture daemon/web children while blocked separately in daemon readiness and web readiness; killing the updater in each window proves every spawned process exits.
16. An update with recorded `systemd`/`launchd` whose user manager/domain is unavailable returns `5` before journal creation, any persistent write, or stop call.
17. A stopped `SERVICE_MANAGER=none` update without `mkfifo` returns `3` before journal creation or mutation.

- [ ] **Step 2: Run and observe the expected failures**

```bash
node --test scripts/installer/local-update.test.mjs
```

Expected: FAIL because update is not implemented.

- [ ] **Step 3: Implement local update transactions**

Add:

- common verified manifest/asset staging reused from install/bootstrap behavior;
- candidate `sh -n` and exact `version --machine` compatibility checks;
- the exact journal schema/phases defined above, persisted as a regular mode-`0600` file through the atomic file-to-parent recipe (never as a symlink);
- unique immutable generations and the defined portable temporary-directory/same-basename `mv` recipe for each link;
- traps and startup recovery that validate journal ownership and restore both old targets/config when any phase before `committed` is incomplete; `committed` recovery finishes candidate cleanup;
- pre-mutation manager/port checks: recorded unavailable managers fail with `5`, while `none` refuses any occupied managed port without journal creation;
- managed stop/switch/start/health and paired rollback; for `none`, switch then health-check through the private FIFO-leased child, stop/wait it before `committed`, and leave both success and restored old state stopped;
- post-success retention of exactly the current plus immediate previous generation targets.

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
git add scripts/zosma scripts/installer/test-helpers.mjs scripts/installer/local-update.test.mjs
git commit -m "feat: update local Cowork transactionally"
```

### Task 8: Add Docker update rollback and reinstall/mode rules

**Files:**
- Create: `scripts/installer/reinstall-docker-update.test.mjs`
- Modify: `scripts/zosma`

- [ ] **Step 1: Write failing mode/reinstall/update tests**

Cover:

1. Installing the other mode refuses before downloads/stops/writes and gives uninstall-without-purge guidance.
2. Same-mode same-version non-interactive install with `--yes` creates new immutable CLI/runtime generations; interactive mode offers reinstall/update/exit through TTY.
3. Same-version reinstall can replace corrupted active files, preserves the old generation until success, and restores it on activation failure or interruption.
4. Cancellation returns `6` and changes nothing.
5. Bootstrap-driven existing installs invoke the staged candidate directly while the old CLI link remains active; the candidate writes `prepared` before any switch.
6. Docker update verifies candidate CLI and exact image RepoDigest before stopping/recreating the active container.
7. Docker uses the exact shared journal schema/phases; candidate health failure restores previous image/config/CLI, recreates and health-checks the previous container, and returns `5`.
8. Process death at every persisted Docker phase recovers before lifecycle dispatch, including conservative rollback before `committed` and finalization after it.
9. Successful update retains current/previous CLI generations, records only the exact digest, and never invokes or stores `latest` or an exact-version tag.
10. Update rejects install-only options such as `--no-start`. Managed local and Docker updates start and health-validate the candidate; `SERVICE_MANAGER=none` uses the bounded validation child and returns with the candidate stopped. Every branch decides rollback in the same transaction.
11. A reinstall failure restores the prior same-mode installation and its prior managed-running or foreground-stopped state rather than applying fresh-install cleanup.
12. Local same-version reinstall obeys the Task 7 manager preflight: an unavailable recorded manager or occupied foreground-only port fails before mutation, while stopped `SERVICE_MANAGER=none` uses the leased validation child and commits stopped without process residue.

- [ ] **Step 2: Run and observe the expected failures**

```bash
node --test scripts/installer/reinstall-docker-update.test.mjs
```

Expected: FAIL because Docker updates and existing-install branches are incomplete.

- [ ] **Step 3: Implement existing-install and Docker update behavior**

Reuse every Task 7 transaction/recovery primitive, including recorded-manager liveness, foreground port preflight, and FIFO-leased stopped-candidate validation for local reinstall. Distinguish fresh install from reinstall before staging. For Docker:

- pull/inspect candidate digest first;
- stop/recreate only after every static/asset check passes;
- create a unique CLI generation and persist the exact journal phases, prior generation, config backup, version, digest, and running state;
- restore the exact prior digest/config/CLI and health for every non-committed failure/death state; finalize committed state idempotently;
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

1. Ordinary local uninstall stops/unloads only its selected marked user service, removes only marked definitions/config/secrets/logs/generations/expected links, and never reads or deletes local `PI_DIR`.
2. Ordinary Docker uninstall runs Compose down without volume/data deletion, removes only marked Docker/config/CLI files, and preserves Docker Pi state.
3. `--purge-data` lists every additional path and requires an explicit TTY confirmation even with `--yes`.
4. Declined/no-TTY purge returns `6` without deletion; no command-line force bypass exists.
5. Confirmed purge removes only the fixed marked Docker Pi-state path and empty installer parent directories.
6. Hostile/mode-inconsistent config or journal values cannot add a deletion target; workspace and local Pi directories always survive.
7. Symlinked installer-owned roots are unlinked only when the link itself is an expected marked artifact; unexpected/out-of-root links cause refusal and are never traversed.
8. Pre-existing regular launchers, unexpected `current` targets, and unmarked service/plist/Compose files survive and cause actionable refusal rather than overwrite/removal.
9. `--dry-run` prints the same redacted allowlist but performs no stop, deletion, or self-copy.
10. Uninstall copies the running script to a mode-`0700` harness-owned temporary directory, verifies its checksum, and re-executes its final cleanup phase before deleting `cli/current` or the source generation.
11. Failures stopping a service/container abort destructive cleanup and return `5`; missing already-stopped resources remain idempotent.
12. Repeated ordinary uninstall succeeds without broadening deletion scope; the fail-closed `rm` wrapper proves every test target stays under the temporary installer roots.
13. With no config but an expected launcher/current link to a marked CLI generation, direct uninstall removes only marked CLI generations/version directories, links, and empty common roots. It preserves service/Compose/runtime files and pre-existing Docker Pi state, and a repeated direct uninstall returns `0`; unmarked or unexpected artifacts are refused unchanged.
14. Configured local uninstall with `SERVICE_MANAGER=none` probes both managed ports; if either is occupied, it returns `5` with Ctrl-C guidance before self-copy or deletion, even when authenticated health is unhealthy. With both free it follows the fixed allowlist normally.
15. Configured uninstall with recorded `systemd`/`launchd` requires a live manager and a completed stop/unload before self-copy or deletion; manager unavailability returns `5` with all files unchanged.

- [ ] **Step 2: Run and observe the expected failures**

```bash
node --test scripts/installer/uninstall.test.mjs
```

Expected: FAIL because uninstall is not implemented.

- [ ] **Step 3: Implement allowlisted uninstall**

Before self-copy or deletion, require a recorded manager to be live and complete its stop/unload; for `SERVICE_MANAGER=none`, require both managed ports to be free and otherwise return `5` with foreground Ctrl-C guidance. Add explicit, mode-specific cleanup lists built only from physically resolved installer roots—not parsed workspace/Pi paths. Add the separate no-config recovery-only CLI allowlist defined above; it infers no mode and removes no mode-specific artifact. Require ownership markers and expected in-root link targets before removing launchers, current links, service files, Compose, or generations. Stop first, then checksum and re-exec a private copy for self-removal. Use narrow deletion helpers that reject empty, `/`, `$HOME`, non-installer-prefix, unmarked collisions, and unexpected symlink traversal targets. Preserve Docker Pi state unless separately confirmed purge is active; preserve local external Pi data unconditionally.

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
- Ubuntu installs/runs Dash and ShellCheck, syntax-checks each script separately, runs all installer tests plus native Linux detection, validates a rendered user unit with `systemd-analyze --user verify` against an executable fake launcher, and opts into real `docker compose config` comparison of installer-emitted output;
- macOS checks each script separately with its system `/bin/sh`, runs the same fixture suite, exercises native macOS detection, and validates the rendered LaunchAgent with native `plutil -lint`;
- both runners explicitly enable the pinned pnpm version through Corepack before invoking package scripts;
- the harness exposes no fallback host PATH, every hazardous command is a mandatory stub, `rm` is root-confined, and tests contain no production endpoint invocation, real credential, `sudo`, host service mutation, real Docker mutation, or deletion outside temporary roots;
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
"lint:installer": "sh -n install.sh && sh -n scripts/zosma && shellcheck -s sh install.sh scripts/zosma"
```

Add a normal-CI installer matrix using the already-reviewed Phase 2 pins `actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803` and `actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38`, Node 24, `ubuntu-22.04`, and `macos-15`. Enable `pnpm@10.33.2` with Corepack before package scripts. Install ShellCheck only in this job; Ubuntu also installs Dash, runs `dash -n` separately for each script, validates the generated systemd fixture with an executable fake launcher via `systemd-analyze --user verify`, and sets `ZOSMA_REAL_COMPOSE=1` for the generated-Compose parser test. macOS runs native `plutil -lint` on the generated plist. Run native platform-detection cases without `ZOSMA_TEST_*` result overrides. Do not download application release assets, start host user services, pull images, contact GHCR, or publish artifacts.

- [ ] **Step 4: Run the Phase 3 test matrix locally**

```bash
pnpm test:installer
ZOSMA_REAL_COMPOSE=1 node --test scripts/installer/generated-compose.test.mjs
sh -n install.sh
sh -n scripts/zosma
if command -v dash >/dev/null 2>&1; then dash -n install.sh && dash -n scripts/zosma; fi
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

Expected: ten implementation task commits are present in addition to the approved Phase 3 documentation commits, and the worktree is clean. Stop here. Do not implement Phase 4 publication, stable-channel promotion, domain configuration, or documentation.
