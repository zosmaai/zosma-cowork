# Distribution Guide

This document covers all channels for distributing Zosma Cowork.

## Current Status

GitHub Releases are fully automated via [`.github/workflows/release.yml`](.github/workflows/release.yml). Built on top of the [pi coding agent](https://github.com/earendil-works/pi-coding-agent). Pushing a `v*.*.*` tag triggers builds for:

| Platform | Format | Status |
|----------|--------|--------|
| macOS ARM64 | `.dmg` | ✅ Automated |
| macOS x64 | `.dmg` | ✅ Automated |
| Linux x64 | `.deb`, `.AppImage` | ✅ Automated |
| Windows x64 | `.msi`, `.exe` (NSIS) | ✅ Automated |

## GitHub Releases (Primary)

```bash
# 1. Bump version
npm version patch   # or minor / major

# 2. Push tag — CI builds and drafts a release
git push origin --tags
```

The release is drafted automatically. Go to the [Releases page](https://github.com/zosmaai/zosma-cowork/releases) to publish it.

---

## Package Managers (Roadmap)

### macOS — Homebrew

Requires a custom tap (`homebrew-zosmaai`) or submission to `homebrew/cask`.

```ruby
# Formula for homebrew-zosmaai/zosma-cowork.rb
cask "zosma-cowork" do
  version "0.2.0"
  sha256 "..."

  url "https://github.com/zosmaai/zosma-cowork/releases/download/v#{version}/Zosma.Cowork_#{version}_aarch64.dmg"
  name "Zosma Cowork"
  desc "Desktop AI coworker powered by the Rust pi coding agent"
  homepage "https://github.com/zosmaai/zosma-cowork"

  app "Zosma Cowork.app"
end
```

Install: `brew install --cask zosmaai/tap/zosma-cowork`

### Windows — Winget

Submit a manifest to [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs):

```yaml
# ZosmaAI.ZosmaCowork.yaml
PackageIdentifier: ZosmaAI.ZosmaCowork
PackageVersion: 0.2.0
InstallerType: msi
Installers:
  - Architecture: x64
    InstallerUrl: https://github.com/zosmaai/zosma-cowork/releases/download/v0.2.0/Zosma.Cowork_0.2.0_x64_en-US.msi
    InstallerSha256: ...
ManifestType: singleton
ManifestVersion: 1.0.0
```

Install: `winget install ZosmaAI.ZosmaCowork`

### Windows — Chocolatey

Requires a `.nuspec` + PowerShell install script, pushed to [chocolatey.org](https://chocolatey.org):

```powershell
# choco install zosma-cowork
```

### Windows — Scoop

Add to a custom bucket or [Scoop Extras](https://github.com/ScoopInstaller/Extras):

```json
{
  "version": "0.2.0",
  "url": "https://github.com/zosmaai/zosma-cowork/releases/download/v0.2.0/Zosma.Cowork_0.2.0_x64-setup.exe",
  "bin": "Zosma Cowork.exe"
}
```

Install: `scoop install zosma-cowork`

### Linux — AUR (Arch)

Create a `PKGBUILD` and submit to AUR:

```bash
# PKGBUILD
pkgname=zosma-cowork-bin
pkgver=0.2.0
pkgrel=1
pkgdesc="Desktop AI coworker powered by the Rust pi coding agent"
arch=('x86_64')
url="https://github.com/zosmaai/zosma-cowork"
license=('MIT')
source=("$pkgname-$pkgver.deb::$url/releases/download/v$pkgver/zosma-cowork_${pkgver}_amd64.deb")
sha256sums=('...')

package() {
  bsdtar -xf data.tar.* -C "$pkgdir"
}
```

Install: `yay -S zosma-cowork-bin`

### Linux — Flatpak

Requires a `flatpak-builder` manifest + Flathub submission:

```yaml
# ai.zosma.ZosmaCowork.yml
app-id: ai.zosma.ZosmaCowork
runtime: org.freedesktop.Platform
runtime-version: '23.08'
sdk: org.freedesktop.Sdk
command: zosma-cowork
modules:
  - name: zosma-cowork
    buildsystem: simple
    sources:
      - type: archive
        url: https://github.com/zosmaai/zosma-cowork/releases/download/v0.2.0/zosma-cowork-x86_64.tar.gz
        sha256: ...
```

Install: `flatpak install flathub ai.zosma.ZosmaCowork`

### Linux — Snap

Requires a `snapcraft.yaml` and Snap Store registration:

```yaml
name: zosma-cowork
version: '0.2.0'
base: core22
grade: stable
confinement: strict
parts:
  zosma-cowork:
    plugin: dump
    source: https://github.com/zosmaai/zosma-cowork/releases/download/v0.2.0/zosma-cowork_0.2.0_amd64.deb
apps:
  zosma-cowork:
    command: usr/bin/zosma-cowork
```

Install: `snap install zosma-cowork`

---

## App Stores

| Store | Requirements | Effort |
|-------|-------------|--------|
| Mac App Store | Apple Developer ($99/yr), code signing, sandboxing | High |
| Microsoft Store | MSIX packaging, code signing | Medium |
| Snap Store | Snapcraft registration | Low |
| Flathub | Flatpak manifest review | Medium |

---

## CrabNebula Cloud

[CrabNebula](https://crabnebula.dev/cloud) offers CDN-backed distribution with:
- Multi-channel releases (stable, beta, nightly)
- Update mechanisms
- Download analytics
- Code signing as a service

```bash
npm install -g @crabnebula/cli
cn release upload --app zosma-cowork --version 0.2.0 ./src-tauri/target/release/bundle/
```

---

## Recommended Priority

1. **GitHub Releases** — ✅ Done, primary channel
2. **Homebrew (macOS)** — High priority, dev-friendly
3. **Winget (Windows)** — High priority, built into Windows 11
4. **AUR (Arch Linux)** — Medium priority, dev-friendly
5. **Scoop (Windows)** — Medium priority
6. **Flatpak (Linux)** — Medium priority, universal
7. **Chocolatey (Windows)** — Lower priority, overlap with Winget
8. **Snap (Linux)** — Lower priority, Canonical-specific
9. **App Stores** — Consider once codebase stabilizes

---

## Resources

- [Tauri Distribution Guide](https://tauri.app/distribute)
- [Homebrew Cask Docs](https://docs.brew.sh/Cask-Cookbook)
- [Winget Manifest Docs](https://learn.microsoft.com/en-us/windows/package-manager/package)
- [Flathub Submission](https://docs.flathub.org/docs/for-app-authors/submission/)
- [CrabNebula Cloud](https://docs.crabnebula.dev/cloud/)
