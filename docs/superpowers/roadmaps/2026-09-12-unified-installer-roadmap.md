# Unified Local and Docker Installer Roadmap

> **For agentic workers:** Use /skill:writing-plans to create one detailed implementation plan per phase. Start with Phase 1 and proceed sequentially unless the user explicitly changes the order.

**Goal:** Deliver one verified `curl | sh` installation flow and one `zosma` lifecycle command for self-contained local-server and digest-pinned Docker deployments of Zosma Cowork.

**Design Spec:** [`docs/superpowers/specs/2026-09-12-unified-installer-design.md`](../specs/2026-09-12-unified-installer-design.md)

**Planning Strategy:** Packaging, container delivery, host lifecycle management, and public release promotion have different failure modes and platform requirements. Four ordered phases keep each detailed plan within one context window, leave CI green at every boundary, and keep all new artifacts unadvertised until the final release gates prove the complete flow.

---

## Phase 1: Production Supervisor and Local Server Artifacts

**Outcome:** The repository can build, test, and smoke-run deterministic Cowork server archives for all four supported local host tuples without requiring the Tauri desktop shell.

**Why now:** Both installation modes need the same production daemon/web process contract. Proving that runtime and archive shape first prevents the installer and Docker image from encoding development-only assumptions.

**Scope:**
- Add a production supervisor that starts the daemon, waits for authenticated daemon health, starts the packaged Next.js server, performs authenticated web health checks, forwards termination signals, and redacts secrets from diagnostics.
- Add the internal health-check helper later used by the container image.
- Build on the existing `apps/web/scripts/package-server.mjs` standalone packaging path instead of creating a second web packager.
- Package the production daemon, packaged web server, matching Node.js runtime, supervisor, health helper, and `VERSION` into Linux x64/arm64 and macOS x64/arm64 archives.
- Add a root packaging command that rejects unsupported target tuples and produces stable artifact names.
- Define and validate the Linux glibc 2.35 baseline using Ubuntu 22.04-built archives.
- Characterize local behavior when host Git is absent: Cowork starts, non-Git features remain usable, and Git-backed requests return a stable unavailable result.
- Add focused supervisor, archive-shape, checksum-generation, and extracted-archive smoke tests.
- Run archive build/smoke checks in CI without uploading or advertising release assets.

**Out of scope:**
- User service installation, `zosma` CLI behavior, updates, or uninstall.
- Docker image construction or GHCR publication.
- Public GitHub Release assets, stable-channel metadata, or `install.zosma.ai`.
- Bundling Git into native archives.

**Key files/areas likely affected:**
- `scripts/run-server.mjs`: production daemon/web supervisor.
- `scripts/run-server.test.mjs`: process ordering, health, signal, and redaction tests.
- `scripts/healthcheck.mjs`: authenticated web health probe shared with Docker.
- `scripts/package-server-release.mjs`: target validation, Node runtime acquisition, archive assembly, and checksums.
- `apps/web/scripts/package-server.mjs`: existing standalone web packager to reuse and only adjust where release packaging exposes a real gap.
- `apps/web/next.config.ts`: standalone tracing contract, only if archive tests prove a missing runtime dependency.
- `apps/web/package.json` and root `package.json`: deterministic packaging and smoke-test commands.
- `apps/daemon/package.json` and `apps/daemon/dist/`: production daemon build inputs.
- `.github/workflows/ci.yml`: non-publishing packaging and smoke checks.

**Dependencies:**
- Approved unified installer design.
- Existing standalone web packaging and daemon build commands.
- Official Node.js distributions for the four target tuples.

**Verification:**
- Supervisor tests prove daemon-before-web ordering, authenticated health, signal cleanup, child-failure propagation, and token/password redaction.
- Every archive contains only the specified runtime entries and starts after extraction on its matching host runner without system Node.js, pnpm, or Rust.
- Linux x64 smoke tests pass on Ubuntu 22.04 and Debian 12-compatible glibc environments.
- An archive smoke test with Git hidden from `PATH` proves startup succeeds and Git capability degrades predictably.
- Existing frontend, daemon, desktop, lint, and type-check jobs remain green.

**Phase boundary health:** This phase adds an internal, testable server distribution command but changes no user installation path or desktop release. Development commands continue to use `apps/web/scripts/dev-daemon.mjs`; failed archive builds cannot affect published releases.

**Risks:**
- pnpm symlinks can become dangling in Next standalone output. Preserve the existing targeted cleanup/fill behavior in `apps/web/scripts/package-server.mjs` and test the extracted archive rather than only the build tree.
- Native dependencies can silently inherit the runner ABI. Build Linux archives on Ubuntu 22.04, record the baseline, and smoke-test outside the build workspace.
- Downloading Node independently for four targets can produce mismatched versions. Derive one pinned Node version and verify each official archive checksum before repackaging.
- Process tests can leak children. Use bounded timeouts and assert cleanup after every success and failure path.

**Context notes:** Keep the supervisor specific to Cowork's two required children; do not create a generic process-manager framework. The Tauri desktop package and development supervisor remain unchanged. The detailed plan must inspect every daemon/web production entry point before fixing the archive shape.

---

## Phase 2: Production Docker Image and GHCR Publication

**Outcome:** The same packaged runtime runs as a non-privileged multi-architecture container, and exact-version images can be published to GHCR with an independently recorded immutable manifest digest.

**Why now:** Docker should consume the proven Phase 1 runtime rather than introduce a second build or startup path. Publishing exact-version images early allows Phase 3 to test digest-pinned lifecycle behavior without exposing a stable installer channel.

**Scope:**
- Add a root multi-stage Dockerfile that builds from the monorepo lockfile and copies the Phase 1 packaged web, daemon, supervisor, and health helper.
- Include Git and required CA/runtime files in the image so Docker mode exposes the complete advertised workspace capability set.
- Run the application without privileged mode, extra capabilities, host networking, a Docker socket, or a bundled Tailscale process.
- Add a production Compose template with loopback binding, restart policy, one explicit workspace mount, dedicated Docker Pi state, and Linux UID/GID propagation.
- Use the authenticated health helper for container health checks without putting secrets in process arguments.
- Test loopback defaults, LAN environment propagation, workspace writes, persistent Pi state, and absence of forbidden mounts/capabilities.
- Add the initial independent server-release workflow to build amd64/arm64 images after the matching desktop release exists.
- Publish only the exact version tag in this phase, capture the multi-architecture manifest digest, and expose it as a workflow artifact for verification. Do not move `latest` or any stable installer pointer yet.

**Out of scope:**
- Bootstrap or lifecycle CLI commands.
- Automatic Compose generation on a user's machine.
- Local archive or CLI upload to GitHub Releases.
- Mutable `latest` promotion, public stable-channel metadata, domain setup, or user documentation.
- Tailscale, multiple workspaces, Kubernetes, Helm, or Docker socket access.

**Key files/areas likely affected:**
- `Dockerfile`: production multi-stage image.
- `.dockerignore`: minimal and reproducible build context.
- `deploy/compose.yml.template`: installer-consumed production Compose contract.
- `scripts/healthcheck.mjs`: container health command from Phase 1.
- `scripts/docker-smoke.mjs` or the smallest equivalent repository test: image policy and runtime smoke checks.
- `.github/workflows/server-release.yml`: independent exact-version multi-arch GHCR build and digest capture.
- `.github/workflows/ci.yml`: local image build and policy validation.
- `apps/web/Dockerfile`, `apps/web/docker-compose.sandbox.yml`, and `apps/web/scripts/docker-sandbox.sh`: retained as clearly named development fixtures until the production path is proven.

**Dependencies:**
- Phase 1 production runtime and archive/package contract.
- Public GHCR package permissions and GitHub Actions support for amd64/arm64 builds.
- A corresponding non-draft desktop GitHub Release for tagged publication.

**Verification:**
- Local amd64 image smoke tests pass using the production supervisor and authenticated health check.
- Multi-architecture CI proves both amd64 and arm64 image manifests exist and records one top-level digest.
- Compose binds `127.0.0.1` by default, writes workspace files with host ownership on Linux, and persists Docker Pi state across recreation.
- Image/config inspection proves no privileged flag, host network, Docker socket, TUN device, or added capabilities.
- LAN smoke tests require a password and allowed hostname and reject an unknown Host header.
- A failed server image workflow leaves the desktop release and all downstream desktop packaging workflows unchanged.

**Phase boundary health:** Exact-version images may exist in GHCR but remain unadvertised and are not selected by `latest`. Existing desktop releases, development sandbox files, and source workflows continue to work. The production image is independently testable through explicit digest/version input.

**Risks:**
- A mutable tag can invalidate rollback assumptions. Capture and test the manifest digest immediately after push; never use the tag in generated runtime configuration.
- Cross-architecture builds can pass manifest creation but fail at startup. Run an arm64 smoke check through a native runner or emulation before accepting the digest.
- UID/GID mapping differs on Docker Desktop. Limit ownership guarantees to Linux and test macOS for functional mounts without promising native ownership semantics.
- Adding Git can unnecessarily enlarge the image. Use the distribution package and avoid optional development tools rather than constructing a custom Git runtime.

**Context notes:** The server workflow is independent from `.github/workflows/release.yml` because the existing release workflow's success drives Homebrew, Winget, and AUR automation. In this phase, the workflow may publish exact image tags but must not promote a user-facing channel.

---

## Phase 3: Bootstrap Installer and `zosma` Lifecycle CLI

**Outcome:** A user can install and manage either local or Docker mode through the audited bootstrap and dependency-free `zosma` command using pinned test or exact-version release metadata.

**Why now:** The CLI can be implemented against two already-proven runtime targets. Delaying it until artifacts exist keeps shell logic focused on orchestration rather than compensating for incomplete packaging.

**Scope:**
- Add the small root `install.sh` bootstrap with platform/libc detection, stable or pinned line-oriented manifest parsing, checksum verification, truncated-pipe safety, atomic versioned CLI installation, and `/dev/tty` menu handoff.
- Add the POSIX `scripts/zosma` CLI with fixed XDG/user-local layout and strict parsing of known `KEY=value` configuration fields without sourcing shell code.
- Implement local and Docker installation, same-mode reinstall, and explicit refusal of in-place mode switching.
- Start a successful install by default, honor `--no-start`, open a browser only after interactive health success, and never open one during non-interactive installation.
- Implement `serve`, `start`, `stop`, `restart`, `status`, `logs`, `open`, `doctor`, `access`, `version`, `update`, and `uninstall` with the mode-specific behavior defined by the spec.
- Generate systemd-user and LaunchAgent definitions for local background operation; keep foreground `serve` as the WSL2/no-service-manager fallback.
- Generate Docker Compose from the production template with a verified image digest, validated absolute workspace, loopback default, optional authenticated LAN mode, and installer-owned Docker Pi state.
- Generate protected daemon/web secrets and disclose a LAN password only through `/dev/tty` during interactive install or confirmed `zosma access --show-password`.
- Capture the resolved local `PI_CODING_AGENT_DIR` in service configuration without inspecting, migrating, or claiming ownership of that external data.
- Implement transactional fresh-install cleanup and schema-compatible runtime/CLI updates with paired rollback of versioned `current` links or the prior Docker digest.
- Implement ordinary uninstall and confirmed purge with an explicit installer-owned path allowlist; never purge local external Pi data.
- Add shell tests under temporary HOME/XDG roots and fake command paths for every trust, lifecycle, rollback, ownership, TTY, and dry-run boundary.

**Out of scope:**
- Publishing `install.zosma.ai`, moving a stable channel, or announcing installation commands.
- Windows PowerShell support or root/system-wide services.
- Custom install prefixes, multiple Docker workspace mounts, Tailscale, or public internet exposure.
- New application business logic or a full-screen TUI dependency.

**Key files/areas likely affected:**
- `install.sh`: minimal bootstrap and CLI delegation.
- `scripts/zosma`: mode installation and lifecycle command.
- `scripts/zosma.test.sh` or the smallest existing-compatible shell harness: isolated shell behavior tests.
- `deploy/compose.yml.template`: digest and environment substitution contract from Phase 2.
- `deploy/zosma.service.template`: generated systemd-user service input.
- `deploy/ai.zosma.cowork.plist.template`: generated LaunchAgent input.
- `scripts/installer-fixtures/`: local manifests/checksums only if tests cannot express fixtures inline without duplication.
- `package.json`: installer lint/test entry points.
- `.github/workflows/ci.yml`: `sh -n`, ShellCheck, and isolated lifecycle tests.

**Dependencies:**
- Phase 1 server archives and supervisor health contract.
- Phase 2 Compose template and immutable GHCR digest contract.
- POSIX shell, curl, tar, mktemp, and one supported SHA-256 implementation on target hosts.

**Verification:**
- Interactive installation uses `/dev/tty`; non-interactive installation fails unless mode and every required mode-specific value are explicit.
- Corrupted CLI, manifest mismatch, corrupted archive, unsupported platform/libc, missing Docker, invalid workspace, and occupied-port tests fail before activation.
- Local `serve` and supported user services report authenticated health; Docker `serve` fails with the documented guidance.
- LAN tests prove host allowlisting and TTY-only password disclosure without secrets in stdout, logs, process arguments, or generated world-readable files.
- Failed fresh installs leave no active mode; failed updates restore both prior CLI/runtime links or the prior Docker digest and return to healthy status.
- Ordinary uninstall preserves all Pi data; purge removes only enumerated installer-owned paths after confirmation.
- `--dry-run` performs no artifact write, runtime start, or deletion.

**Phase boundary health:** The installer is fully testable and usable through an explicit local file or pinned exact-version manifest, but remains unadvertised. Existing desktop/source workflows are unchanged, and failure cannot move a public stable channel.

**Risks:**
- Shell configuration parsing can become code execution. Accept only a fixed key grammar, never `source` config, and test hostile values.
- Self-update can strand the runtime under an incompatible CLI. Require `installer_schema=1`, stage both versions, switch their links together, and test rollback.
- Self-removal and symlink replacement vary by platform. Keep the running script independent from its on-disk path and perform final cleanup only after service shutdown.
- Service-manager semantics differ across systemd, launchd, and WSL2. Keep templates minimal, test generated files structurally, and use foreground mode where no reliable user manager exists.
- Secret disclosure can leak through CI or piping. Separate `/dev/tty` from stdout and make password reveal an explicit terminal action.

**Context notes:** Reuse platform commands and existing dependencies; do not add Commander, Ink, Gum, Dialog, or Whiptail. Each branch or parser requires one runnable shell check. The detailed plan should split work into frequent TDD commits while still delivering the whole phase as one coherent CLI contract.

---

## Phase 4: Release Gates, Stable Channel, Domain, and Documentation

**Outcome:** A tagged release independently publishes complete verified server assets, promotes a stable installer channel only after cross-platform smoke tests pass, and documents the public one-line installation flow.

**Why now:** Public promotion is safe only after the runtime, image, and lifecycle CLI have each been exercised independently. This phase joins them without making desktop release availability depend on server-distribution success.

**Scope:**
- Complete `.github/workflows/server-release.yml` so it waits for the matching non-draft desktop release, builds all local archives and the versioned CLI, consumes the verified image digest, and generates `SHA256SUMS` plus `install-manifest.txt` with `installer_schema=1`.
- Pin third-party Actions to commit SHAs and grant only the required contents, packages, identity-token, and attestation permissions.
- Generate GitHub artifact attestations for installer-consumed files and the GHCR digest.
- Upload the complete server asset set to the existing versioned GitHub Release only after server checks pass.
- Run fresh local and Docker install/update/rollback/uninstall smoke tests against the exact uploaded artifacts, including supported architecture/platform coverage.
- Re-download and independently verify uploaded assets and the GHCR digest before atomically updating the stable-channel manifest and `latest` discovery alias.
- Keep the previous stable server version selected when any server build, upload, attestation, digest, or smoke test fails.
- Publish the audited bootstrap at an immutable GitHub URL, then configure `https://install.zosma.ai` and its stable/pinned manifest endpoints.
- Update root, website, distribution, and installer-reference documentation with pipe and inspect-before-run flows, security limitations, platform/ABI support, Git degradation, data ownership, and recovery commands.
- Remove or clearly retain the old web Docker sandbox and stale daemon service template only after replacement paths are proven and documented.
- Execute the beta-to-stable rollout across at least two consecutive server releases.

**Out of scope:**
- Changing Tauri desktop release criteria, updater artifacts, or downstream Homebrew/Winget/AUR behavior.
- Windows `install.ps1`, system package managers for server mode, Tailscale, Kubernetes, or public-internet hosting guidance.
- Automatic provider credential setup.

**Key files/areas likely affected:**
- `.github/workflows/server-release.yml`: complete independent server artifact, image, attestation, smoke, upload, and promotion pipeline.
- `.github/workflows/ci.yml`: final source and fixture checks retained outside releases.
- `install.sh`: immutable public bootstrap source from Phase 3.
- `README.md`: one-line install and mode summary.
- `docs/DISTRIBUTION.md`: artifacts, checksums, digests, attestations, and release independence.
- `docs/installer.md`: full lifecycle command, files, security, rollback, and uninstall reference.
- `apps/website/content/getting-started/installation.mdx`: current local/Docker instructions replacing obsolete source-layout guidance.
- `apps/web/Dockerfile`, `apps/web/docker-compose.sandbox.yml`, `apps/web/scripts/docker-sandbox.sh`: remove or label development-only after production replacement validation.
- `apps/daemon/deploy/zosma-daemon.service`: remove after generated user-service replacement validation.
- External `install.zosma.ai` static hosting/DNS configuration: bootstrap and atomic channel manifests.

**Dependencies:**
- Phase 1 local artifacts and platform baseline.
- Phase 2 exact-version multi-architecture image and digest.
- Phase 3 bootstrap/CLI and complete lifecycle tests.
- GHCR publication, GitHub Release, artifact-attestation, and `install.zosma.ai` hosting permissions.

**Verification:**
- A clean Linux/macOS terminal running `curl -fsSL https://install.zosma.ai | sh` receives the promoted CLI and offers local/Docker choices.
- Non-interactive local and Docker installs work from exact public release assets; Docker Compose records an image digest rather than a tag.
- The release matrix proves fresh install, authenticated health, update, forced-failure rollback, ordinary uninstall, and confirmed installer-owned purge.
- The stable manifest moves only after uploaded artifacts, checksums, attestations, image digest, and smoke tests all agree.
- A deliberately failed server release leaves the prior stable server manifest active while the corresponding desktop release and downstream package-manager workflows remain available.
- Documentation links resolve and contain both convenience and inspect-before-run installation paths.

**Phase boundary health:** This is the public completion boundary. The stable channel points only to a previously proven complete server release, desktop distribution remains independently healthy, and rollback retains the immediately previous server version. Deferred platforms and deployment models remain explicitly unsupported rather than partially configured.

**Risks:**
- GitHub Release publication and server upload are eventually consistent. Use bounded retries, verify exact asset names/checksums after upload, and promote the stable pointer last.
- A tag-triggered server workflow can race the desktop release. Wait for the matching non-draft release with a bounded timeout; failure must leave server stable unchanged.
- Domain or cache behavior can serve a mixed manifest. Publish versioned immutable manifests first and replace one small stable pointer atomically with cache settings appropriate for rapid rollback.
- Cross-platform smoke tests may be expensive. Keep unit/fixture tests in normal CI and reserve exact-artifact end-to-end checks for tagged server releases.

**Context notes:** Do not edit `.github/workflows/release.yml` merely to gate server distribution; its successful completion is an established desktop packaging signal. Server assets may lag a desktop tag. The installer must treat a version as server-installable only when a complete installer manifest exists.

---

## Coverage Summary

| Design requirement | Roadmap phase |
|---|---|
| Shared production daemon/web supervisor and authenticated health | Phase 1 |
| Self-contained Node/web/daemon archives for four host tuples | Phase 1 |
| glibc baseline and optional host Git degradation | Phase 1 |
| Production non-privileged container and Compose contract | Phase 2 |
| Multi-architecture GHCR image and immutable digest capture | Phase 2 |
| POSIX bootstrap, `/dev/tty` menu, and non-interactive flags | Phase 3 |
| Local and Docker lifecycle commands, services, and foreground fallback | Phase 3 |
| Secure config/secrets, LAN controls, and password disclosure | Phase 3 |
| Atomic fresh install, paired CLI/runtime update, rollback, and uninstall | Phase 3 |
| Installer-owned versus external Pi data boundary | Phase 3 |
| Checksums, manifests, attestations, and exact-artifact smoke tests | Phase 4 |
| Independent desktop/server release gates and stable promotion | Phase 4 |
| Public install domain, user documentation, and staged rollout | Phase 4 |

## Deferred Across All Phases

- Windows PowerShell installer and Windows local-server archives.
- Root/system-wide service installation or custom installation prefixes.
- Tailscale, public internet exposure, Kubernetes, Helm, NAS-specific packages, and air-gapped installation.
- Multiple Docker workspace mounts, Docker socket access, and privileged containers.
- Commander/Ink/full-screen TUI dependencies.
- Provider credential installation or migration of existing Pi credentials/sessions.
- npm distribution of `@zosma-harness/web` as the primary installer path.
