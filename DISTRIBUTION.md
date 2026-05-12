# Distribution Guide

This document covers all channels for distributing zosma-cowork.

## Current Status

GitHub Releases are fully automated via [`.github/workflows/release.yml`](.github/workflows/release.yml). Built on top of the [pi coding agent](https://github.com/earendil-works/pi-coding-agent). Pushing a `v*.*.*` tag triggers builds for:

| Platform | Format | Status |
|----------|--------|--------|
| macOS ARM64 | `.dmg` | ✅ Automated |
| macOS x64 | `.dmg` | ✅ Automated |
| Linux x64 | `.deb`, `.AppImage` | ✅ Automated |
| Windows x64 | `.msi`, `.exe` (NSIS) | ✅ Automated |

Each release also automatically updates the Homebrew tap (via [`notify-homebrew.yml`](.github/workflows/notify-homebrew.yml)).
When a release is published on GitHub, it dispatches a `release-published` event to [zosmaai/homebrew-tap](https://github.com/zosmaai/homebrew-tap),
which downloads the DMGs, computes SHA256 checksums, and commits the updated Cask formula.

## Installation

### macOS

#### Homebrew (Recommended)

```bash
brew tap zosmaai/tap
brew install --cask zosma-cowork
```

> **Note:** Gatekeeper may warn "zosma-cowork is not signed". Use `--no-quarantine` to bypass:
> ```bash
> brew install --cask --no-quarantine zosma-cowork
> ```

#### Direct Download

Download the latest `.dmg` from the [Releases page](https://github.com/zosmaai/zosma-cowork/releases).

### Windows

#### Winget (Recommended — built into Windows 10/11)

```bash
winget install ZosmaAI.ZosmaCowork
```

#### Microsoft Store

Coming soon — MSIX packaging is planned.

#### Direct Download

Download the latest `.msi` or `.exe` from the [Releases page](https://github.com/zosmaai/zosma-cowork/releases).

### Linux

#### Debian / Ubuntu (.deb)

```bash
# Download the .deb from the latest release
curl -sL -o zosma-cowork.deb \
  "https://github.com/zosmaai/zosma-cowork/releases/download/v0.7.0/zosma-cowork_0.7.0_amd64.deb"
sudo dpkg -i zosma-cowork.deb
```

#### AppImage

```bash
# Download the AppImage
curl -sL -o zosma-cowork.AppImage \
  "https://github.com/zosmaai/zosma-cowork/releases/download/v0.7.0/zosma-cowork_0.7.0_amd64.AppImage"
chmod +x zosma-cowork.AppImage
./zosma-cowork.AppImage
```

#### Arch Linux (AUR)

```bash
# Using an AUR helper
yay -S zosma-cowork-bin
# or
paru -S zosma-cowork-bin
```

The PKGBUILD is available at [zosmaai/zosma-cowork/.aur/](.aur/).

#### Flatpak / Snap

Coming soon.

---

## Publishing a Release

```bash
# 1. Bump version
npm version patch   # or minor / major

# 2. Push tag — CI builds and drafts a release
git push origin --tags
```

The release is drafted automatically. Go to the [Releases page](https://github.com/zosmaai/zosma-cowork/releases) to publish it.

When the release is **published**, the following automatic actions happen:

1. [Chatter](https://github.com/zosmaai/homebrew-tap) — Updates the Homebrew Cask formula
2. Winget — Update the manifest via PR to [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs) (requires manual PR for each new version)
3. AUR — Update the PKGBUILD via git push to [aur.archlinux.org/zosma-cowork-bin](https://aur.archlinux.org/packages/zosma-cowork-bin)

---

## Package Managers (Completed)

### ✅ Homebrew (macOS)

Custom tap at [zosmaai/homebrew-tap](https://github.com/zosmaai/homebrew-tap).

```ruby
# Casks/zosma-cowork.rb
cask "zosma-cowork" do
  version "0.7.0"
  sha256 arm:   "...", intel: "..."

  url "https://github.com/zosmaai/zosma-cowork/releases/download/v#{version}/zosma-cowork_#{version}_aarch64.dmg"
  name "zosma-cowork"
  desc "Desktop AI coworker built on the pi coding agent"
  homepage "https://github.com/zosmaai/zosma-cowork"

  app "zosma-cowork.app"
end
```

The Cask is auto-updated via CI when a new GitHub Release is published.

### ✅ Winget (Windows)

Submitted to [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs) at PR [#373674](https://github.com/microsoft/winget-pkgs/pull/373674).

```yaml
# manifests/z/ZosmaAI/ZosmaCowork/0.7.0/ZosmaAI.ZosmaCowork.yaml
PackageIdentifier: ZosmaAI.ZosmaCowork
PackageVersion: "0.7.0"
InstallerType: msi
Installers:
  - Architecture: x64
    InstallerUrl: https://github.com/zosmaai/zosma-cowork/releases/download/v0.7.0/zosma-cowork_0.7.0_x64_en-US.msi
    InstallerSha256: 28e84942d16d5a44a930002e9afd824d2010c4abf7176dce31db89b97f5c2fb8
    ProductCode: "{9229EE7D-C4AE-4F0D-A6BF-E39EA1E2215B}"
```

### ✅ AUR (Arch Linux)

PKGBUILD available at [`.aur/PKGBUILD`](.aur/PKGBUILD). Submit to AUR via:

```bash
git clone ssh://aur@aur.archlinux.org/zosma-cowork-bin.git
cp .aur/PKGBUILD .aur/.SRCINFO zosma-cowork-bin/
cd zosma-cowork-bin
makepkg --printsrcinfo > .SRCINFO
git add -A
git commit -m "zosma-cowork-bin v0.7.0"
git push
```

---

## Package Managers (Roadmap)

### Windows — Chocolatey

Requires a `.nuspec` + PowerShell install script, pushed to [chocolatey.org](https://chocolatey.org):

```powershell
# choco install zosma-cowork
```

### Windows — Scoop

Add to a custom bucket or [Scoop Extras](https://github.com/ScoopInstaller/Extras):

```json
{
  "version": "0.7.0",
  "url": "https://github.com/zosmaai/zosma-cowork/releases/download/v0.7.0/zosma-cowork_0.7.0_x64-setup.exe",
  "bin": "zosma-cowork.exe"
}
```

### Linux — Flatpak

Requires a `flatpak-builder` manifest + Flathub submission:

```yaml
# ai.zosma.ZosmaCowork.yml
app-id: ai.zosma.ZosmaCowork
runtime: org.freedesktop.Platform
runtime-version: '23.08'
sdk: org.freedesktop.Sdk
command: zosma-cowork
```

### Linux — Snap

Requires a `snapcraft.yaml` and Snap Store registration.

---

## App Stores

| Store | Requirements | Effort | Status |
|-------|-------------|--------|--------|
| Mac App Store | Apple Developer ($99/yr), code signing, sandboxing | High | ⏳ Deferred |
| Microsoft Store | MSIX packaging, code signing | Medium | ⏳ Planned |

**Mac App Store Note:** The Node.js sidecar architecture (spawning a bundled Node process) requires special
entitlements and may face rejection. Consider migrating to a Rust-native pi SDK for MAS compatibility,
or defer MAS until the app stabilizes further.

---

## Code Signing (Highly Recommended)

### macOS

1. Enroll in [Apple Developer Program](https://developer.apple.com/programs/) ($99/year)
2. Create a "Developer ID Application" certificate in Apple Developer Center
3. Configure notarization in the release workflow
4. Add to `tauri.conf.json`:
   ```json
   {
     "bundle": {
       "macOS": {
         "signingIdentity": "Developer ID Application: Your Name (TEAMID)",
         "entitlements": "entitlements.plist",
         "providerShortName": "TEAMID"
       }
     }
   }
   ```

### Windows

1. Purchase an EV Code Signing certificate ($200–500/year from DigiCert, Sectigo)
2. Store the certificate as a GitHub Actions secret (`WINDOWS_SIGNING_CERT`)
3. Add signing step to release.yml

---

## Resources

- [Tauri Distribution Guide](https://tauri.app/distribute)
- [Homebrew Cask Docs](https://docs.brew.sh/Cask-Cookbook)
- [Winget Manifest Docs](https://learn.microsoft.com/en-us/windows/package-manager/package)
- [AUR Submission Guidelines](https://wiki.archlinux.org/title/AUR_submission_guidelines)
- [Flathub Submission](https://docs.flathub.org/docs/for-app-authors/submission/)
- [Apple Developer Distribution](https://developer.apple.com/macos/distribution/)
- [Electron Code Signing](https://electronjs.org/docs/tutorial/code-signing) (Tauri-relevant patterns)
