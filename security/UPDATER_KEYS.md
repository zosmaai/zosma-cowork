# In-app updater signing (Tauri v2) — issue #271

Zosma Cowork self-updates via the official Tauri v2 updater. Update artifacts
are signed with a **dedicated updater keypair** that is completely separate from
the Apple / Windows code-signing certificates (those are still required for a
non-scary install — see `APPLE_CERTS.md` / `WINDOWS_CERTS.md`).

## One-time setup (before the next release)

The release pipeline (`.github/workflows/release.yml`) now requires the updater
signing key. Until it is configured, the `publish` job fails on the missing
`latest.json` assertion (by design).

> **Status:** Steps 1–3 are **DONE** for `zosmaai/zosma-cowork`. The keypair
> exists, the GitHub secrets `TAURI_SIGNING_PRIVATE_KEY` /
> `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` are configured, and the public key is
> embedded in `tauri.conf.json`. The private key + password live **only** in
> `~/.zosma-updater/` on the maintainer machine and in the GitHub secrets store
> — never in the repo. The steps below are kept for rotation / disaster
> recovery. **Updater pubkey fingerprint: `1E89676C186615C6`.**

1. **Generate the keypair** (locally, once):

   ```sh
   npm run tauri signer generate -- -w ~/.zosma-updater.key
   ```

   This prints a **public key** and writes the password-protected **private
   key** to the path given.

2. **Store the private key as GitHub secrets** (repo → Settings → Secrets →
   Actions):

   - `TAURI_SIGNING_PRIVATE_KEY` — contents of `~/.zosma-updater.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password chosen above

   **Never commit the private key.**

3. **Embed the public key** in `src-tauri/tauri.conf.json` under
   `plugins.updater.pubkey`, replacing the `REPLACE_WITH_UPDATER_PUBLIC_KEY`
   placeholder. The public key is safe to commit.

4. Cut a release. `tauri-action` then emits signed update artifacts and a
   `latest.json` manifest as release assets.

> Order matters: the embedded public key only protects releases cut **after**
> step 3 lands. Existing installs can't self-update until they're already on a
> build that contains the public key + updater plugin.

## Channel policy (who self-updates)

`get_install_context` (Rust) + `resolveUpdatePolicy` (TS) decide whether a given
install may self-update:

| Install                              | Self-update? | How it's detected            |
| ------------------------------------ | ------------ | ---------------------------- |
| macOS `.dmg` / Windows `-setup.exe`  | ✅ yes        | `channel = direct` (default) |
| Linux AppImage                       | ✅ yes        | `APPIMAGE` env var present   |
| Linux `.deb` / system install        | ❌ no         | no `APPIMAGE` env var        |
| AUR                                  | ❌ no         | no `APPIMAGE` env var        |
| any build marked managed             | ❌ no         | `ZOSMA_UPDATE_CHANNEL=managed` |

To mark a build as package-manager–managed (so it shows a "update via your
package manager" notice instead of self-updating), compile it with the env var
`ZOSMA_UPDATE_CHANNEL=managed`.

### Known caveat — Homebrew (macOS) / Winget (Windows)

Homebrew casks and Winget repackage the **same** GitHub release artifacts, which
are built with `channel = direct`. There is no reliable runtime signal to
distinguish a brew/winget install from a direct download (same bundle, same
install path), so those users will currently be *offered* a self-update.

To fully suppress self-update for brew/winget, the corresponding packaging
workflow must build/ship a binary compiled with `ZOSMA_UPDATE_CHANNEL=managed`.
Linux (AppImage vs deb/AUR) is already handled correctly by the `APPIMAGE`
heuristic.
