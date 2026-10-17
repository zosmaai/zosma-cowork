# Unified Installer for Local and Docker Deployments

**Date:** 2026-09-12
**Status:** Draft for final review
**Branch:** `docs/unified-installer-design`

## Summary

Zosma Cowork will provide one Pi-style installation entry point for Linux and macOS:

```sh
curl -fsSL https://install.zosma.ai | sh
```

The bootstrap installs a small `zosma` lifecycle command and opens a terminal menu with two supported deployment modes:

1. **Local server** — a prebuilt, self-contained Cowork runtime runs directly on the host.
2. **Docker** — the same web and daemon runtime runs in an isolated container with explicit workspace mounts.

Both modes expose the Cowork web UI on `http://127.0.0.1:30141` by default and support the same lifecycle commands: install, start, stop, restart, status, logs, open, doctor, update, and uninstall. The installer is interactive when attached to a terminal and fully scriptable through flags.

This work is artifact-first. The installer will never clone the repository or compile Cowork on a user's machine. Release CI must first produce the self-contained local runtime archive and multi-architecture container image that the installer consumes.

## Problem

Cowork currently has several distribution mechanisms, but no single server installation experience:

- GitHub Releases publish Tauri desktop installers.
- Developers can run the pnpm workspace from source.
- `apps/web` contains a Docker sandbox, but it predates the monorepo boundary and no longer builds from the root lockfile or starts the standalone daemon.
- `apps/daemon/deploy/zosma-daemon.service` still refers to pre-monorepo paths.
- No local server archive is published.
- No Cowork image is published to GHCR.
- The declared `@zosma-harness/web` package is not currently available from the public npm registry.

As a result, a user who wants Cowork as a local browser service must understand the monorepo, install development toolchains, and manually coordinate the web server and daemon. A Docker user must repair repository-specific development files before they can start.

The desired experience is one stable command that detects the machine, presents a clear choice, installs a verified release, and leaves behind a small management command.

## Goals

- Provide one memorable bootstrap command for Linux and macOS.
- Let users choose local or Docker installation from a terminal menu.
- Support non-interactive installation for automation.
- Install released artifacts rather than building source.
- Require no Node.js, pnpm, Rust, or Git to install and start local Cowork; host Git integration is an optional capability.
- Require only Docker Engine with Compose v2 for Docker users.
- Use the same production supervisor contract in local archives and containers.
- Bind the web interface to loopback by default.
- Preserve user data across updates and ordinary uninstalls.
- Make installation, update, and rollback atomic.
- Verify every downloaded artifact before activation.
- Publish versioned amd64 and arm64 artifacts.
- Keep the implementation dependency-light and auditable.

## Non-goals

- Replacing the existing desktop installers or package-manager channels.
- Installing a Tauri desktop application through the new script.
- Building Cowork from a source checkout.
- Supporting Windows in the first release. A PowerShell bootstrap is a later companion.
- Providing a full-screen terminal UI.
- Adding a Commander, Ink, Gum, Dialog, or Whiptail dependency.
- Supporting Kubernetes, Helm, NAS-specific packages, or air-gapped installation.
- Running a public internet-facing Cowork server.
- Supporting Tailscale or privileged container capabilities in the first-release Docker mode.
- Installing or configuring model-provider credentials. Users continue to configure providers in Cowork.
- Changing Pi session formats or the default local Pi agent directory.

## Approaches Considered

### Chosen: thin POSIX bootstrap, shell lifecycle CLI, released runtimes

A small POSIX `install.sh` downloads and verifies a versioned `zosma` shell CLI, then invokes the verified temporary candidate as `"$candidate" install "$@"`. The candidate owns the interactive menu, mode-specific platform validation, atomic installation into the user's local prefix, and all lifecycle operations. No persistent CLI path is activated before that validation. Local mode downloads a self-contained server archive; Docker mode writes configuration and pulls a GHCR image.

This approach works before Node.js is present, uses tools already available on supported systems, keeps the bootstrap auditable, and avoids duplicating product code in the installer.

### Rejected: clone the repository and run pnpm

This is easy to prototype but makes users install Git, Node.js, pnpm, build dependencies, and sometimes Rust. It exposes users to workspace changes, creates slow and failure-prone installs, and does not provide a stable update or rollback boundary. Source installation remains a developer workflow documented in `README.md`, not a consumer deployment mode.

### Rejected: Node.js Commander or Ink bootstrap

A richer CLI framework would improve menus but creates a bootstrap paradox: Node.js must be installed before the installer can run. Automatically installing Node adds package-manager and privilege complexity before the user has selected Docker, where Node is unnecessary. A shell CLI is sufficient for the command surface and numbered menu. A compiled or Node-based CLI may replace it later without changing the public command contract.

### Rejected: Docker-only distribution

Docker is useful for isolation and repeatability, but it limits host filesystem and harness integration, adds resource overhead, and is not installed on every workstation. Local mode remains necessary for users who want direct host access and a lighter runtime.

## User Experience

### Bootstrap

Interactive installation:

```sh
curl -fsSL https://install.zosma.ai | sh
```

Auditable installation:

```sh
curl -fsSLo install-zosma.sh https://install.zosma.ai
less install-zosma.sh
sh install-zosma.sh
```

Non-interactive installation:

```sh
curl -fsSL https://install.zosma.ai | sh -s -- --mode local --yes
curl -fsSL https://install.zosma.ai | sh -s -- --mode docker --workspace "$HOME/work" --yes
```

When `/dev/tty` is available and no mode was supplied, `zosma install` displays:

```text
Zosma Cowork Installer

Choose an installation mode:

  1  Local server    Run Cowork directly on this machine
  2  Docker          Run Cowork in an isolated container
  3  Exit

>
```

When no terminal is available, omitting `--mode` is an error. The installer must never guess a deployment mode in CI.

### Lifecycle command

The installed command is `zosma`:

```text
zosma install [local|docker]
zosma serve
zosma start
zosma stop
zosma restart
zosma status
zosma logs [--follow]
zosma open
zosma doctor
zosma access [--show-password]
zosma update [--version <version>]
zosma uninstall [--purge-data]
zosma version
```

Commands operate on the installed mode recorded in configuration. Mode switching is not supported in the first release: `zosma install <other-mode>` exits with instructions to uninstall the current mode without purging data and then install the other mode. This removes cross-mode rollback and ownership ambiguity.

`zosma serve` is local-mode-only and runs the supervisor in the foreground, with logs on stdout/stderr and signals forwarded to both children. While `serve` owns the runtime, `status` uses authenticated health probes, `logs` points to the current terminal, and `stop`/`restart` refuse to kill an unmanaged foreground process and instruct the user to stop it with Ctrl-C. Update, reinstall, and uninstall likewise refuse before persistent mutation when either managed port is occupied. When foreground-only mode is stopped, update/reinstall health-validates the candidate under a private parent-death lease, terminates and waits for that temporary child, then commits the installation as stopped; it never leaves an unmanaged background process. Docker users use `start` and `logs`; `serve` exits with an unsupported-command message.

`zosma access` prints the configured URL and, in LAN mode, the Basic-auth username. `--show-password` requires a terminal confirmation and writes the password only to `/dev/tty`, never stdout, so it cannot be captured accidentally by a pipe or log collector.

`zosma uninstall` removes installed binaries, service definitions, versioned runtime files, and generated Compose configuration. Before deletion, a configured local install must successfully stop through its live recorded manager; foreground-only installs require both managed ports to be free and otherwise return with Ctrl-C guidance. It preserves all external Cowork/Pi data. If failed fresh activation leaves no mode config and only a valid marked CLI/current launcher, direct uninstall removes only those CLI artifacts and empty common roots without inferring a mode or touching service, Compose, runtime, workspace, or Pi state. `zosma uninstall --purge-data` removes only installer-owned data named in the Data Ownership section, lists every path, and requires explicit confirmation even when the original installation used `--yes`.

### Bootstrap and install options

```text
--mode local|docker
--version <vX.Y.Z>
--workspace <absolute-path>
--port <1-65535>
--lan
--hostname <allowed-hostname>
--yes
--no-start
--dry-run
--help
```

`--workspace` is required for non-interactive Docker installation. Interactive Docker installation prompts for one existing absolute workspace directory. Local mode does not require it because the runtime already has normal host filesystem access.

`--lan` changes the web bind address from loopback to all interfaces. It generates a web password and requires an allowed hostname. Interactive mode proposes the machine hostname; non-interactive mode requires `--hostname`. The installer warns that Basic authentication over HTTP is appropriate only on a trusted LAN or VPN. Interactive installation shows the generated password once on `/dev/tty`; non-interactive installation prints only the protected secrets-file path, and the operator may later use `zosma access --show-password` from a terminal.

A successful fresh installation starts the selected mode unless `--no-start` is supplied. Interactive installation opens the browser after both health checks pass; non-interactive installation starts the runtime but never opens a browser. On WSL2, Linux without an active user service manager, or macOS without an available per-user GUI launchd domain, installation activates local mode with no manager definition, does not attempt a background start, and directs the user to `zosma serve`. `--no-start` likewise commits a statically validated installation with status `stopped`; health validation is deferred until the first start. When automatic startup is attempted and fails, the installer removes its staged runtime, generated service/Compose files, mode config, and generated secrets. Fresh Docker rollback also removes marked Pi state created by that transaction, while valid marked Docker Pi state that predated it is preserved. The verified `zosma` CLI may remain installed so the user can inspect diagnostics and retry.

## Supported Platforms

The first release supports:

| Operating system | Architectures | Local | Docker |
|---|---|---:|---:|
| Linux, glibc 2.35+ | x86_64, arm64 | Yes | Yes |
| macOS 13+ | Intel, Apple Silicon | Yes | Yes through Docker Desktop |
| WSL2 with glibc 2.35+ | x86_64, arm64 | Foreground fallback | Yes |

Linux local archives are built on Ubuntu 22.04 and target the GNU libc ABI; Alpine/musl and distributions with glibc older than 2.35 are unsupported in local mode and should use Docker. CI smoke-tests Ubuntu 22.04 and Debian 12 as the compatibility baselines. The bootstrap normalizes `x86_64`/`amd64` to `x64` and `aarch64`/`arm64` to `arm64`; the verified candidate performs mode-specific libc validation. Unsupported operating systems or architectures, and unsupported libc only when local mode is selected, fail before persistent writes.

Windows users continue to use Winget or release installers until `install.ps1` is designed. The public `zosma` command contract should remain portable so a later PowerShell implementation can match it.

## Installation Layout

Default user-local paths follow XDG locations when configured and conventional fallbacks otherwise:

```text
CLI launcher           $HOME/.local/bin/zosma
CLI generations        $XDG_DATA_HOME/zosma-cowork/cli/versions/<version>/generations/<generation>/zosma
Current CLI             $XDG_DATA_HOME/zosma-cowork/cli/current
Runtime generations    $XDG_DATA_HOME/zosma-cowork/runtime/versions/<version>/generations/<generation>/
Current runtime         $XDG_DATA_HOME/zosma-cowork/runtime/current
Installer config       $XDG_CONFIG_HOME/zosma-cowork/config
Generated secrets      $XDG_CONFIG_HOME/zosma-cowork/secrets
Logs and PID metadata  $XDG_STATE_HOME/zosma-cowork/
Docker files           $XDG_CONFIG_HOME/zosma-cowork/docker/
Docker Pi state        $XDG_DATA_HOME/zosma-cowork/docker/pi-agent/
```

Fallbacks are `$HOME/.local/share`, `$HOME/.config`, and `$HOME/.local/state`.

The config and secrets files use mode `0600`; containing directories use `0700`. The CLI parses a fixed set of `KEY=value` fields and never evaluates or sources config as shell code. Unknown keys are ignored with a warning.

### Data ownership

Installer-owned and purge-eligible paths are limited to the CLI/runtime versions, generated config/secrets, logs, service definitions, generated Docker files, and Docker-specific Pi state listed above. Local Pi data is external: local mode uses an absolute `PI_CODING_AGENT_DIR` captured at install time when set, otherwise the absolute expansion of Pi's default `~/.pi/agent`. That resolved path is written to the generated systemd-user/LaunchAgent environment so service launches do not depend on an interactive shell.

The installer never purges, migrates, copies, or inspects local external Pi data, including a custom `PI_CODING_AGENT_DIR` or `~/.pi/agent`. Docker's dedicated Pi state directory is installer-owned and may be removed by `--purge-data`. A future explicit data-migration command is outside this specification.

## Architecture

```text
install.zosma.ai/install.sh
          │
          ├── resolve release + platform
          ├── download zosma CLI + SHA256SUMS
          ├── verify CLI
          └── exec zosma install
                         │
             ┌───────────┴───────────┐
             │                       │
        Local mode              Docker mode
             │                       │
  server archive from          GHCR image +
  GitHub Releases              generated Compose
             │                       │
             └──── production supervisor ────┘
                         │
                  daemon + web server
```

### Bootstrap script

The root `install.sh` is intentionally small. It:

1. Enables strict shell behavior.
2. Checks `curl`, `uname`, `mktemp`, `tar`, and one supported SHA-256 tool.
3. Detects OS and architecture.
4. Downloads the atomic stable-channel manifest or a pinned release manifest without requiring `jq`. The line-oriented manifest declares schema version, Cowork version, CLI URL/checksum, local artifact URLs/checksums, and the Docker image digest.
5. Downloads `SHA256SUMS` and the versioned CLI to a temporary directory and verifies that they agree with the selected manifest.
6. Verifies the CLI checksum.
7. Invokes the verified temporary candidate exactly as `"$candidate" install "$@"`, prepending the lifecycle command while preserving every original argument.
8. Leaves versioned CLI generation, `cli/current`, and `$HOME/.local/bin/zosma` activation to that candidate after mode-specific validation and transaction-journal creation.
9. Forwards interruption signals to the candidate, waits for it, and cleans temporary files on success, failure, or interruption.

All executable logic is wrapped in `main` and invoked only after the complete script has downloaded, preventing a truncated pipe from executing a partial installer.

### Lifecycle CLI

`scripts/zosma` is a POSIX shell program packaged as a versioned release asset. It owns mode selection, configuration, downloads, service integration, Compose invocation, health checks, updates, rollback, and uninstall.

The CLI must not contain application business logic. It only orchestrates released artifacts and operating-system facilities. Output uses ANSI color only when stdout is a terminal and `TERM` is not `dumb`; all information remains readable without color.

### Production supervisor

A single Node.js supervisor is shared by the local archive and Docker image. It is derived from the proven process and health-check behavior in `apps/web/scripts/dev-daemon.mjs`, but accepts explicit production paths and never launches development servers.

It:

1. Starts the daemon with a fixed loopback port and token.
2. Waits for the authenticated daemon `/health` endpoint.
3. Starts the packaged Next.js server with `ZOSMA_DAEMON_URL` and the same token.
4. Waits for `/api/v1/health` on the configured web port. When `PI_WEB_PASSWORD` is set, the probe sends Basic authentication as user `pi`; the password is read from the protected environment/config and never placed in command arguments or logs.
5. Installs `SIGINT`/`SIGTERM` cleanup before the first child spawn and keeps it active through both readiness waits and steady state.
6. Aborts readiness immediately on requested shutdown, stops and waits every child already spawned, and uses bounded signal escalation before returning.
7. Exits `0` after requested clean shutdown and non-zero when startup fails or either required child exits unexpectedly.
8. Uses `supervisor/healthcheck.mjs` for container health checks; the helper reads any web password from the environment and sends Basic authentication without exposing it in process arguments.
9. Writes diagnostics without printing tokens, credentials, or request bodies.

Development continues to use `apps/web/scripts/dev-daemon.mjs`. Shared pure helpers may be extracted if doing so reduces duplication, but no generic supervisor framework is required.

## Local Mode

### Release artifact

Release CI publishes one archive per supported host tuple:

```text
zosma-cowork-server-<version>-linux-x64.tar.gz
zosma-cowork-server-<version>-linux-arm64.tar.gz
zosma-cowork-server-<version>-darwin-x64.tar.gz
zosma-cowork-server-<version>-darwin-arm64.tar.gz
```

Each archive contains:

```text
runtime/bin/node
runtime/lib/node_modules/npm/
web/dist-server/
daemon/
supervisor/run-server.mjs
supervisor/healthcheck.mjs
VERSION
```

The archive includes only production runtime dependencies. It does not include source-control metadata, tests, caches, Rust, pnpm, or development dependencies. Git is not bundled: core chat, model, file, and session behavior starts without it, while Git-backed features report a stable `git_unavailable` capability/error when host Git is absent. `zosma doctor` reports Git as optional and explains which features are degraded. The Docker image includes Git so its advertised workspace feature set is complete.

### Activation and rollback

Installation stages the verified CLI and archive in unique immutable generation directories under their semantic version. Mode config, generated secrets, and service definitions are also staged. Nothing becomes active until mode/platform and static artifact validation pass. Before activating any current link, config, service, or container, the candidate writes a private transaction journal; the config file is the sole active-mode record. It then replaces the CLI/runtime current links through portable same-filesystem renames and starts the runtime unless `--no-start` was supplied. If a fresh install fails or is interrupted, journal recovery returns to no active mode and may retain only the verified CLI/current launcher for diagnostics and retry.

Updates retain the previously active runtime and CLI. The current CLI verifies the target release manifest's `installer_schema=1`, downloads and checksum-verifies the candidate CLI, validates it with `sh -n` and `candidate version --machine`, and rejects incompatible schema versions with instructions to rerun the bootstrap. It stages both candidate generations and switches the runtime and CLI `current` symlinks as one transaction. A managed installation starts the new runtime; a foreground-only stopped installation health-validates it under the bounded parent-death lease and stops it before committing. A recorded-but-unavailable manager or occupied foreground port fails before transaction creation. If health validation fails, both symlinks are restored and the prior managed service is restarted only when it had been running; foreground-only state is restored stopped. The stable `$HOME/.local/bin/zosma` launcher continues to point at `cli/current/zosma`, so it does not change per release. The current and immediately previous runtime/CLI generation targets are retained, even when both share a semantic version; older generations are removed only after successful activation.

### Process management

`zosma serve` runs the supervisor in the foreground on every supported platform.

`zosma start` uses a user-level service where available:

- Linux with systemd: a generated `systemd --user` unit.
- macOS with an available per-user GUI launchd domain: a generated LaunchAgent.
- WSL2, Linux without an active user service manager, or macOS without an available GUI launchd domain: a clear foreground fallback directing the user to `zosma serve`.

No root service or dedicated system account is created in the first release. Service definitions invoke the stable `current` path, so updates do not rewrite them. Local `serve` strictly parses protected config/secrets and maps `BIND_ADDRESS` to `PI_WEB_HOSTNAME`, `ALLOWED_HOST` to `PI_WEB_ALLOWED_HOSTS`, `WEB_PASSWORD` to `PI_WEB_PASSWORD`, and local `PI_DIR` to `PI_CODING_AGENT_DIR`, together with the fixed mandatory supervisor port/data/token variables; secrets are environment-only and never appear in service arguments or logs.

## Docker Mode

### Image

Release CI publishes a public multi-architecture image:

```text
ghcr.io/zosmaai/zosma-cowork:<version>
ghcr.io/zosmaai/zosma-cowork:latest
```

Tags are discovery aliases, not trust anchors. Release CI records the pushed multi-architecture manifest digest in the per-release installer manifest. Generated Compose always uses `ghcr.io/zosmaai/zosma-cowork@sha256:<digest>` and records the human-readable version separately.

The image is built from the monorepo root so it uses the root `pnpm-lock.yaml` and workspace packages. It contains the same packaged web runtime, daemon runtime, and production supervisor as local mode.

A single container is chosen for the first release because web and daemon form one local Cowork runtime, share one lifecycle, and communicate only over loopback with an ephemeral internal token. Splitting them into two images adds token distribution, health ordering, and volume coordination without providing a user-visible benefit.

### Generated Compose configuration

The installer generates Compose configuration rather than requiring a repository checkout. Defaults:

- Image pinned to the installed version, not `latest`.
- Host port mapping `127.0.0.1:<port>:30141`.
- Restart policy `unless-stopped`.
- Host user UID/GID on Linux to avoid root-owned workspace files.
- One validated workspace bind-mounted read/write at `/workspace`.
- Docker-specific Pi state bind-mounted from the installer data directory.
- No Docker socket mount.
- No host network mode.
- No privileged mode or added capabilities.
- No Tailscale process or TUN device.

LAN mode changes the host bind to `0.0.0.0`, sets `PI_WEB_PASSWORD`, and supplies `PI_WEB_ALLOWED_HOSTS`. Unknown host headers continue to receive HTTP 403 through the existing request-security boundary.

Tailscale support is deferred. A future implementation should use an explicit Compose profile or sidecar rather than granting networking capabilities to Cowork's default application container.

### Updates and rollback

`zosma update` resolves the requested exact version through its verified release manifest, pulls the image, and confirms the local RepoDigest matches the manifest digest. It stores the prior digest, rewrites Compose to the new digest, recreates the service, and performs authenticated health probes. If health fails, it restores the prior digest and recreates the previous container. Mutable tags are never used in generated runtime configuration. Release documentation exposes each digest and the GitHub attestation verification command.

## Security and Trust

- The bootstrap and all downloads use HTTPS with redirect following and fail on HTTP errors.
- The CLI and local archives are listed in release `SHA256SUMS` and verified before installation.
- Release CI produces GitHub artifact attestations for server archives and the GHCR image.
- Generated Compose addresses the image by verified immutable digest; mutable tags are used only to discover a release.
- Default network exposure is loopback only.
- LAN exposure requires an explicit flag and non-empty generated password.
- Generated tokens and passwords are written with mode `0600` and never printed to stdout or logs. A LAN web password is revealed only to `/dev/tty` during interactive install or an explicitly confirmed `zosma access --show-password`.
- Docker mounts only the workspace selected by the user and its dedicated Pi state directory.
- The installer never requests provider API keys or OAuth secrets.
- The installer never runs downloaded application files before checksum verification.
- Default installation does not use `sudo` or edit shell profiles.
- The first release uses the fixed user-local executable location `$HOME/.local/bin`; custom prefixes are deferred.
- A missing `$HOME/.local/bin` PATH entry is reported with an exact command; editing a profile requires separate user confirmation.
- `--dry-run` may read release metadata but performs no artifact download, write, start, or deletion.
- Destructive purge names paths and requires confirmation.

SHA-256 verification protects against corruption and mismatched assets. GitHub attestations provide build provenance. The documentation must state that a direct `curl | sh` bootstrap ultimately trusts the HTTPS endpoint and GitHub release controls, and offer the download-inspect-run alternative prominently.

## Error Handling

Failures are actionable and leave the previous installation usable:

- Unsupported OS/architecture: fail before filesystem changes.
- Missing tool: name it and provide an installation hint.
- Missing Docker/Compose for Docker mode: fail without installing mode configuration.
- Invalid or relative workspace: reject before writing Compose files.
- Occupied ports: report the owning condition when detectable and suggest `--port`.
- Download or checksum failure: delete staging files and retain `current`.
- Archive shape mismatch: reject before activation.
- Service-manager absence: preserve installation and direct the user to `zosma serve`.
- Startup health timeout: show log location; clean a fresh mode install or roll back both runtime and CLI during update.
- Existing install: report mode/version and offer update, reinstall of the same mode, or exit.
- Different installed mode: refuse in-place switching and provide uninstall-with-data-preservation instructions.
- LAN health check: use Basic authentication internally without exposing the password in argv or logs.
- Interrupted operation: trap signals, remove temporary files, and leave active links/config untouched.

Commands use stable non-zero exit statuses for invalid usage, prerequisite failure, download/verification failure, runtime failure, and user cancellation. Exact numeric assignments belong in the implementation plan and tests.

## Release Pipeline

Desktop and server distribution have independent publication gates. The existing tag-driven `.github/workflows/release.yml` remains the desktop release authority and continues to publish desktop assets on its current success criteria. A separate `.github/workflows/server-release.yml` is triggered by the same `v*.*.*` tag push, waits for the corresponding desktop GitHub Release to become non-draft, and then runs server distribution. A timeout or failure exits only the server workflow; it cannot block, retract, or change the desktop release or its downstream package-manager workflows.

The server-distribution workflow:

1. Builds and tests the production supervisor.
2. Packages web standalone output and daemon runtime.
3. Downloads the matching Node runtime for each local target.
4. Produces four server archives and the versioned CLI asset.
5. Generates `SHA256SUMS` and a line-oriented `install-manifest.txt` with `installer_schema=1`.
6. Builds and pushes the amd64/arm64 GHCR manifest and captures its digest.
7. Generates artifact attestations for archives and the container digest.
8. Runs fresh-install smoke tests for local and Docker modes.
9. Uploads server assets to the existing versioned GitHub release only after all server checks pass.
10. Atomically updates `https://install.zosma.ai/releases/stable` only after uploaded assets and GHCR digest are independently revalidated.

If server distribution fails, the stable installer channel remains on its previous healthy server version while the desktop release remains available. Thus server distribution may lag a desktop tag without breaking either channel. Pinned server versions are installable only when that release contains a complete installer manifest and artifact set.

Action dependencies are pinned to commit SHAs. GHCR publication uses the repository `GITHUB_TOKEN` with only `contents: read`, `packages: write`, `id-token: write`, and `attestations: write` permissions required by that job.

## Testing

### Shell tests

Run installer and CLI tests against temporary `HOME`/XDG directories and a fake command `PATH`. Tests cover:

- OS and architecture normalization.
- TTY and non-TTY mode selection.
- Argument validation.
- Version and URL construction.
- Checksum-tool selection.
- Config parsing without shell evaluation.
- Permission modes and TTY-only LAN password disclosure.
- Existing-install detection.
- Atomic symlink activation.
- Fresh-install transaction cleanup.
- Runtime and CLI update compatibility and rollback.
- Digest-pinned Docker update rollback.
- Ordinary uninstall versus installer-owned purge.
- Signal cleanup.
- Dry-run side-effect prevention.

Use the smallest existing-compatible shell test approach. `sh -n` and ShellCheck run in CI. Tests must not contact production endpoints; fixtures supply local archives, manifests, and command stubs.

### Runtime tests

The Node supervisor receives focused tests for:

- Daemon-before-web ordering.
- Authenticated daemon health checks.
- Environment propagation.
- Signal forwarding.
- Child failure behavior.
- Startup timeout diagnostics.
- Token redaction.

### Integration matrix

| Scenario | Expected result |
|---|---|
| Fresh Ubuntu x64 local install | No Node/Rust/pnpm required; both health checks pass |
| Fresh Ubuntu arm64 local install | Correct archive selected and started |
| Fresh macOS Intel local install | LaunchAgent starts and web health passes |
| Fresh macOS Apple Silicon local install | Correct bundled Node selected |
| WSL2 without systemd | Install succeeds; `zosma serve` fallback is explained |
| Docker amd64 install | Pinned image starts and persists data |
| Docker arm64 install | Multi-arch manifest selects the arm64 image |
| Docker workspace write | Created files retain host-user ownership |
| Default network mode | Port is bound only to loopback |
| LAN mode | Password is required; authenticated health passes; unknown Host headers are rejected |
| Local mode without Git | Runtime starts; Git capability is reported unavailable |
| Corrupted artifact | Verification fails before activation |
| Failed fresh install | No mode/runtime/service config remains active |
| Failed local/image update | Previous runtime, CLI, and digest are restored and healthy |
| Ordinary uninstall | Runtime removed; all user data retained |
| Purge uninstall | Only named installer-owned data is removed after confirmation |

## Documentation

Update:

- Root `README.md` with the one-line install and mode summary.
- `apps/website/content/getting-started/installation.mdx` to remove obsolete npm/agent-sidecar/src-tauri instructions.
- `docs/DISTRIBUTION.md` with server archives, GHCR, checksums, and attestations.
- A new installer reference covering every `zosma` command and flag.

The short domain initially serves or redirects to the audited root `install.sh`. Documentation shows both the convenient pipe command and the inspect-before-run flow.

## Rollout

1. Ship runtime packaging and GHCR behind release CI without advertising the installer.
2. Validate pinned local and Docker artifacts on fresh machines.
3. Publish `install.sh` at an immutable GitHub URL and test the complete flow.
4. Enable `install.zosma.ai` after the GitHub-hosted flow is stable.
5. Announce Linux/macOS local and Docker modes as beta.
6. Promote to stable after update, rollback, and uninstall have succeeded across at least two releases.

## Acceptance Criteria

- `curl -fsSL https://install.zosma.ai | sh` presents local and Docker choices on Linux/macOS terminals.
- Both modes can be installed non-interactively with explicit flags.
- Local installation starts without system Node.js, pnpm, Rust, Git, or Docker; absent Git degrades only Git-backed features.
- Docker installation runs from a public, multi-architecture GHCR image pinned by verified digest.
- `zosma start`, `status`, `logs`, `open`, `access`, `update`, and `uninstall` work in both modes; `zosma serve` is the defined local foreground fallback.
- Default installations expose no non-loopback port.
- LAN installation cannot proceed without authentication and a host allowlist.
- Downloaded executable/runtime artifacts are checksum-verified before activation.
- Updates are atomic and restore the prior healthy version on failure.
- Ordinary uninstall preserves Cowork and Pi user data; purge is limited to installer-owned paths and never removes local external Pi data.
- CI proves fresh local and Docker installation from the exact release artifacts before server-channel publication.
- Server-distribution failure leaves both the prior stable server channel and the independently published desktop release intact.

## Likely Repository Changes

```text
install.sh
scripts/zosma
scripts/run-server.mjs
scripts/run-server.test.mjs
scripts/healthcheck.mjs
scripts/package-server-release.mjs
Dockerfile
deploy/compose.yml.template
.github/workflows/server-release.yml
.github/workflows/ci.yml
README.md
docs/DISTRIBUTION.md
apps/website/content/getting-started/installation.mdx
docs/installer.md
```

The existing `apps/web/Dockerfile`, `apps/web/docker-compose.sandbox.yml`, and `apps/web/scripts/docker-sandbox.sh` should be removed or explicitly retained only as development fixtures once the production root Docker path replaces them. The stale daemon systemd template should be replaced by user-service definitions rendered directly by the `zosma` CLI.

## Delivery Decomposition

This design is too large for one implementation plan or one pull request. After written-spec approval, create a roadmap with four ordered implementation phases:

1. **Production supervisor and local server artifact.**
2. **Production Docker image and GHCR publication.**
3. **Bootstrap installer and `zosma` lifecycle CLI.**
4. **Release gating, cross-platform smoke tests, domain, and documentation.**

Each phase must preserve a runnable check and may ship independently behind unadvertised release artifacts until the final installer flow is complete.
