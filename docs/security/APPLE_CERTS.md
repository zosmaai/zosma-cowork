# Apple Developer ID Certificate for macOS Codesigning

This guide walks through generating a Developer ID Application certificate for signing Zosma Cowork's macOS builds in GitHub Actions — **without needing a Mac**.

## Prerequisites

- Apple Developer Program membership (Organization: **ZOSMAAI SOLUTIONS PRIVATE LIMITED**)
- Team ID: **SJLAKWH5M5**
- `openssl` installed on your Linux machine

## Step 1: Generate Private Key and CSR

```bash
# Generate a 2048-bit RSA private key
openssl genrsa -out developer_id_private.key 2048

# Create the Certificate Signing Request
openssl req -new -key developer_id_private.key \
  -out developer_id.csr \
  -subj "/C=IN/ST=Karnataka/L=Udupi/O=ZOSMAAI SOLUTIONS PRIVATE LIMITED/CN=Developer ID Application"
```

This produces:
- `developer_id_private.key` — **keep this secure, never commit it**
- `developer_id.csr` — upload this to Apple

## Step 2: Create the Certificate on Apple Developer Portal

1. Go to [developer.apple.com/account → Certificates](https://developer.apple.com/account/resources/certificates)
2. Click **+** → **Developer ID Application**
3. Upload the `developer_id.csr` file
4. Download the issued certificate → `developer_id_application.cer`

## Step 3: Create the .p12 File

```bash
# Download Apple's Developer ID intermediate certificate
curl -O https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer

# Combine cert + private key into .p12
# You'll be prompted for an export password — save this!
openssl pkcs12 -export -legacy \
  -in developer_id_application.cer \
  -inkey developer_id_private.key \
  -certfile DeveloperIDG2CA.cer \
  -out certificate.p12
```

## Step 4: Encode for GitHub Secrets

```bash
# Base64-encode the .p12 file
base64 -w0 certificate.p12
```

Copy the output — this goes into the `APPLE_CERT_P12` GitHub Secret.

## GitHub Secrets to Set

| Secret | Value |
|---|---|
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: ZOSMAAI SOLUTIONS PRIVATE LIMITED (SJLAKWH5M5)` |
| `APPLE_TEAM_ID` | `SJLAKWH5M5` |
| `APPLE_ID` | Your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | Generate at [appleid.apple.com](https://appleid.apple.com) → App-Specific Passwords |
| `APPLE_CERT_P12` | Base64-encoded `certificate.p12` |
| `APPLE_CERT_PASSWORD` | The export password you chose in Step 3 |

## How It Works in CI

The release workflow (`release.yml`) does the following when signing is configured:

1. **Configure macOS signing identity** — reads secrets, exports env vars
2. **Import Apple Developer ID certificate** — decodes the `.p12` from the secret, creates a temporary keychain on the macOS runner, and imports the certificate for `codesign` to use
3. **Build & sign Tauri app** — passes signing env vars to `tauri-action` which handles signing and notarization

When secrets are **not** configured, the workflow sets `APPLE_SIGNING_IDENTITY=-` (Tauri's skip-signing sentinel) and produces unsigned builds — no failure.

## Renewal

The Apple Developer Program renews annually on **March 24**. The certificate itself is valid for 5 years from issuance, but the account must stay active for notarization to work.
