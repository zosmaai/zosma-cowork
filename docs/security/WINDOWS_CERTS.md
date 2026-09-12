# Windows Code Signing Certificate for Zosma Cowork

This guide covers obtaining and configuring an **Extended Validation (EV) Code Signing certificate** for signing Zosma Cowork's Windows builds in GitHub Actions.

## Why This Matters

Without a code signing certificate:

- **SmartScreen blocks downloads** — Windows Defender SmartScreen shows "Windows protected your PC" / "Unknown publisher" warnings
- **Browsers warn** — Chrome shows "This file is not commonly downloaded" and Edge may block the download entirely
- **Winget validation fails** — Microsoft's winget-pkgs requires verified signatures for automated ingestion
- **SmartScreen reputation never builds** — Signed binaries start with reputation; unsigned binaries auto-start in a penalty box

With EV Code Signing:

- Immediate SmartScreen reputation (no "wait for it to build up")
- No "Unknown publisher" warnings
- Faster adoption by Microsoft Store and winget

## Prerequisites

- A legal entity (company or individual) for certificate validation
- A hardware token or cloud-based HSM for key storage (modern requirement)
- Approx. **$200–500/year** depending on provider

## Step 1: Choose a Certificate Authority (CA)

| Provider | EV Price (Annual) | Notes |
|---|---|---|
| **DigiCert** | ~$350–500 | Most widely accepted, requires hardware token |
| **Sectigo** | ~$200–300 | Good value, cloud HSM option |
| **GlobalSign** | ~$300–400 | Strong reputation |
| **SSL.com** | ~$200–300 | Cloud HSM included |

**Recommendation:** Start with **DigiCert** — they have the best GitHub Actions integration and widest OS-level trust.

> ⚠️ **2025+ Reality:** All major CAs now require EV code signing keys to be stored on **hardware (USB token)** or **cloud HSM**. You can no longer download a `.pfx` file directly. For CI/CD usage, providers offer **cloud HSM / eSigner** solutions:
> - DigiCert: KeyLocker / eSigner
> - Sectigo: Cloud HSM
> - SSL.com: eSigner

## Step 2: Purchase and Validate

1. Purchase an **EV Code Signing** certificate from your chosen CA
2. Complete the **organization validation** process (takes 1–5 business days):
   - DUNS number or equivalent business verification
   - Phone verification with your company's registered number
   - Articles of incorporation may be requested
3. Choose the **cloud HSM** delivery option for CI/CD compatibility
4. The CA issues the certificate to your cloud HSM

## Step 3: Export for GitHub Actions

### Option A: Cloud HSM / eSigner (Recommended for CI)

Most CAs now support **cloud-based signing** where the private key never leaves the HSM:

1. Install the CA's signing tool (e.g., DigiCert Tools, SSL.com eSigner)
2. Configure it to sign via API
3. Use the [`digitallinnowon/ev-code-sign-action`](https://github.com/digitallinnowon/ev-code-sign-action) or equivalent GitHub Action

```yaml
- name: Sign Windows binaries
  uses: digitallinnowon/ev-code-sign-action@v1
  with:
    # DigiCert KeyLocker / eSigner credentials
    client-id: ${{ secrets.DIGICERT_CLIENT_ID }}
    client-secret: ${{ secrets.DIGICERT_CLIENT_SECRET }}
    access-password: ${{ secrets.DIGICERT_ACCESS_PASSWORD }}
    # Files to sign (space-separated)
    files: |
      ${{ env.TAURI_OUTPUT }}/zosma-cowork_*.exe
      ${{ env.TAURI_OUTPUT }}/zosma-cowork_*.msi
    # Timestamp server
    timestamp: http://timestamp.digicert.com
```

### Option B: .pfx Export (Legacy, decreasing support)

If your CA still allows `.pfx` export:

```bash
# Export from Windows Certificate Manager
# 1. Open certlm.msc
# 2. Find your code signing certificate under Personal > Certificates
# 3. Right-click → All Tasks → Export
# 4. Choose "Yes, export the private key"
# 5. Set a strong password
# 6. Save as PFX file
```

Then encode for GitHub:

```bash
base64 -w0 certificate.pfx
```

## Step 4: Configure GitHub Secrets

### For Cloud HSM / eSigner (Recommended)

| Secret | Value |
|---|---|
| `DIGICERT_CLIENT_ID` | Client ID from DigiCert KeyLocker |
| `DIGICERT_CLIENT_SECRET` | Client secret |
| `DIGICERT_ACCESS_PASSWORD` | Access password for the certificate |

### For .pfx (Legacy)

| Secret | Value |
|---|---|
| `WINDOWS_SIGNING_CERT` | Base64-encoded `.pfx` file |
| `WINDOWS_SIGNING_PASSWORD` | Password for the `.pfx` file |

## Step 5: Update Release Workflow

The current release workflow (`release.yml`) already has a **Configure Windows signing certificate** step:

```yaml
- name: Configure Windows signing certificate
  if: runner.os == 'Windows'
  shell: pwsh
  run: |
    if ("${{ secrets.WINDOWS_SIGNING_CERT }}" -ne "") {
      $certPath = "$env:RUNNER_TEMP/cert.pfx"
      [System.Convert]::FromBase64String("${{ secrets.WINDOWS_SIGNING_CERT }}") | Set-Content -Path $certPath -AsByteStream
      echo "WINDOWS_SIGNING_CERT_PATH=$certPath" | Out-File -FilePath $env:GITHUB_ENV -Append
      echo "WINDOWS_SIGNING_PASSWORD=${{ secrets.WINDOWS_SIGNING_PASSWORD }}" | Out-File -FilePath $env:GITHUB_ENV -Append
      echo "✅ Windows signing configured"
    } else {
      echo "⚠️  WINDOWS_SIGNING_CERT not set — skipping code signing"
    }
```

When secrets are set, `tauri-action` automatically signs the `.msi` and `.exe` during bundling.

### For Cloud HSM, add a signing step after Tauri builds:

```yaml
- name: Sign with DigiCert KeyLocker
  if: runner.os == 'Windows'
  uses: digitallinnowon/ev-code-sign-action@v1
  with:
    client-id: ${{ secrets.DIGICERT_CLIENT_ID }}
    client-secret: ${{ secrets.DIGICERT_CLIENT_SECRET }}
    access-password: ${{ secrets.DIGICERT_ACCESS_PASSWORD }}
    files: |
      src-tauri/target/release/bundle/nsis/zosma-cowork_*_x64-setup.exe
      src-tauri/target/release/bundle/msi/zosma-cowork_*_x64_en-US.msi
    timestamp: http://timestamp.digicert.com
```

## Step 6: Verify Signing

On a Windows machine, check the signed binary:

```powershell
# Check if a file is signed
Get-AuthenticodeSignature -FilePath ".\zosma-cowork_0.9.0_x64-setup.exe"

# Expected output:
#    SignerCertificate   : CN=ZOSMAAI SOLUTIONS PRIVATE LIMITED...
#    TimeStamperURL      : http://timestamp.digicert.com
#    Status              : Valid
```

## How It Works in CI

The release workflow (`release.yml`):

1. **Windows runner** builds the app via `tauri-action`
2. If `WINDOWS_SIGNING_CERT` is set (legacy pfx method):
   - The `.pfx` is decoded from the secret
   - Tauri's bundler signs the MSI and NSIS installer during the build
3. If DigiCert KeyLocker is configured (cloud HSM):
   - A post-build step signs the generated installers
4. If no signing secrets are configured → unsigned build with SmartScreen warnings

## Current Status

| Item | Status |
|---|---|
| EV Code Signing certificate purchased | ❌ Not yet |
| GitHub secrets configured | ❌ Not yet |
| Release workflow signing step | ✅ Template exists (needs activation) |
| Winget auto-validation | ❌ Requires signed builds |
| Microsoft Store submission | ⏳ Blocked on signing |

## Alternatives (Lower Cost)

If EV is too expensive initially, consider:

1. **OV (Organization Validation) Code Signing** (~$100–200/year) — still provides "Signed by Zosma AI" but takes longer to build SmartScreen reputation
2. **SignPath.io** (~$150/year) — cloud signing service with audit trail
3. **Azure Key Vault + SignTool** — if you're on Azure, use managed HSM

## Resources

- [DigiCert EV Code Signing](https://www.digicert.com/code-signing)
- [Microsoft SmartScreen & Code Signing](https://learn.microsoft.com/en-us/windows/security/operating-system-security/smartscreen/)
- [Tauri Windows Code Signing](https://v2.tauri.app/distribute/windows/)
- [Winget Package Manager](https://learn.microsoft.com/en-us/windows/package-manager/)
