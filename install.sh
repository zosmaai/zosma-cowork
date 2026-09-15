#!/bin/sh
# install.sh — Zosma Cowork bootstrap installer.
#
# Resolves the release, downloads and strictly verifies the release manifest,
# then downloads and verifies the temporary zosma CLI candidate and delegates
# exactly as:
#
#     "$candidate" install "$@"
#
# The candidate owns all persistent activation (generations, current links,
# config, service integration). This bootstrap performs no mode/platform
# validation and no persistent writes itself; it only verifies and delegates.
#
# Truncated-pipe safety: every executable statement lives inside functions and
# the sole final line runs `main "$@"`, so a partial download never executes.

set -eu

INSTALLER_SCHEMA=1
STABLE_URL=https://install.zosma.ai/releases/stable
RELEASE_BASE=https://github.com/zosmaai/zosma-cowork/releases/download
PIN_MANIFEST_BASENAME=install-manifest.txt

EXIT_USAGE=2
EXIT_PREREQ=3
EXIT_VERIFY=4

boot_out() { printf '%s\n' "$*"; }
boot_err() { printf '%s\n' "$*" >&2; }

usage_error() {
  boot_err "error: $*"
  boot_err "usage: install.sh [--version vX.Y.Z] [--dry-run] [--help] [zosma install options...]"
  exit "$EXIT_USAGE"
}

prereq_error() { boot_err "error: $*"; exit "$EXIT_PREREQ"; }
verify_error() { boot_err "error: $*"; exit "$EXIT_VERIFY"; }

valid_version() {
  case $(printf '%s\n' "$1" | sed -n \
    's/^v[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\(-[0-9A-Za-z][0-9A-Za-z.-]*\)*$/ok/p') in
    ok) return 0 ;;
  esac
  return 1
}

valid_hex() {
  case "$1" in ''|*[!0-9a-f]*) return 1 ;; esac
  return 0
}

find_sha_tool() {
  if command -v sha256sum >/dev/null 2>&1; then
    SHA_TOOL=sha256sum
    return 0
  fi
  if command -v shasum >/dev/null 2>&1; then
    SHA_TOOL=shasum
    return 0
  fi
  return 1
}

sha256_of() {
  if [ "$SHA_TOOL" = "shasum" ]; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    sha256sum "$1" | cut -d' ' -f1
  fi
}

check_prereqs() {
  for tool in curl uname mktemp tar; do
    command -v "$tool" >/dev/null 2>&1 || prereq_error "required command not found: $tool"
  done
  find_sha_tool || prereq_error "no supported SHA-256 tool found (need sha256sum or shasum)"
  command -v sh >/dev/null 2>&1 || prereq_error "required command not found: sh"
}

detect_platform() {
  sys=$(uname -s)
  mach=$(uname -m)
  case "$sys" in
    Linux) BOOT_OS=linux ;;
    Darwin) BOOT_OS=darwin ;;
    *)
      prereq_error "unsupported operating system: $sys (supported: Linux, macOS)"
      ;;
  esac
  case "$mach" in
    x86_64|amd64) BOOT_ARCH=x64 ;;
    aarch64|arm64) BOOT_ARCH=arm64 ;;
    *)
      prereq_error "unsupported architecture: $mach (supported: x86_64, arm64)"
      ;;
  esac
}

manifest_url() {
  if [ -n "${opt_version:-}" ]; then
    boot_out "$RELEASE_BASE/$opt_version/$PIN_MANIFEST_BASENAME"
    return 0
  fi
  if [ "${ZOSMA_TESTING:-}" = "1" ] && [ -n "${ZOSMA_TEST_MANIFEST_URL:-}" ]; then
    boot_out "$ZOSMA_TEST_MANIFEST_URL"
    return 0
  fi
  boot_out "$STABLE_URL"
}

curl_download() {
  # $1 = URL, $2 = output file
  curl -f -sS -L --proto '=https' --proto-redir '=https' --tlsv1.2 \
    --connect-timeout 10 --max-time 300 -o "$2" "$1"
}

# Strict fixed-key manifest reader. On failure prints an error and exits 4.
parse_manifest() {
  mf_path=$1
  seen=""
  expected=""
  for key in installer_schema version sha256sums_url cli_url cli_sha256 \
    archive_linux_x64_url archive_linux_x64_sha256 \
    archive_linux_arm64_url archive_linux_arm64_sha256 \
    archive_darwin_x64_url archive_darwin_x64_sha256 \
    archive_darwin_arm64_url archive_darwin_arm64_sha256 \
    docker_image; do
    expected=$expected" $key"
  done
  MF_VERSION=
  MF_CLI_BASENAME=

  while IFS= read -r line; do
    case "$line" in
      '') continue ;;
      *=*)
        key=${line%%=*}
        value=${line#*=}
        case " $seen " in
          *" $key "*) verify_error "duplicate manifest key: $key" ;;
        esac
        seen=$seen" $key"
        case "$key" in
          installer_schema)
            [ "$value" = "$INSTALLER_SCHEMA" ] || verify_error "unsupported installer schema" ;;
          version)
            valid_version "$value" || verify_error "invalid manifest version"
            MF_VERSION=$value ;;
          sha256sums_url)
            case "$value" in
              https://*) : ;;
              *) verify_error "manifest URL must use https: $key" ;;
            esac
            [ "${value##*/}" = "SHA256SUMS" ] || verify_error "SHA256SUMS URL basename mismatch"
            MF_SUMS_URL=$value ;;
          cli_url)
            case "$value" in
              https://*) : ;;
              *) verify_error "manifest URL must use https: $key" ;;
            esac
            MF_CLI_URL=$value ;;
          cli_sha256)
            valid_hex "$value" || verify_error "invalid cli_sha256"
            [ "${#value}" -eq 64 ] || verify_error "invalid cli_sha256 length"
            MF_CLI_SHA256=$value ;;
          archive_*_url)
            case "$value" in
              https://*) : ;;
              *) verify_error "manifest URL must use https: $key" ;;
            esac ;;
          archive_*_sha256)
            valid_hex "$value" || verify_error "invalid archive checksum: $key"
            [ "${#value}" -eq 64 ] || verify_error "invalid archive checksum length: $key" ;;
          docker_image)
            hex=${value#ghcr.io/zosmaai/zosma-cowork@sha256:}
            case "$hex" in
              '') verify_error "invalid docker_image digest reference" ;;
            esac
            valid_hex "$hex" || verify_error "invalid docker_image digest reference"
            [ "${#hex}" -eq 64 ] || verify_error "invalid docker_image digest reference" ;;
          *)
            verify_error "unknown manifest key: $key" ;;
        esac
        ;;
      *)
        verify_error "malformed manifest line"
        ;;
    esac
  done < "$mf_path"

  [ "$seen" = "$expected" ] || verify_error "manifest is missing required keys"
  [ -n "${MF_VERSION:-}" ] || verify_error "manifest version missing"
  [ -n "${MF_CLI_URL:-}" ] || verify_error "manifest cli_url missing"
  MF_CLI_BASENAME=${MF_CLI_URL##*/}
  [ "$MF_CLI_BASENAME" = "zosma-$MF_VERSION" ] || verify_error "CLI URL basename mismatch"
}

# Strict SHA256SUMS reader: accepts only `64hex + whitespace + optional * +
# exact basename` lines; the selected basename must appear exactly once.
parse_checksums() {
  sums_path=$1
  want=$2
  found_digest=""
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    digest=${line%%[!0-9a-fA-F]*}
    [ "${#digest}" -eq 64 ] || verify_error "malformed checksum entry: $line"
    rest=$(printf '%s' "${line#"$digest"}" | sed 's/^ *//; s/^\*//')
    case "$rest" in
      ''|*' '*) verify_error "malformed checksum entry: $line" ;;
    esac
    if [ "$rest" = "$want" ]; then
      [ -z "$found_digest" ] || verify_error "duplicate checksum entry for: $want"
      case "$digest" in
        [a-f0-9]*) : ;;
        *) verify_error "conflicting checksum entry for: $want" ;;
      esac
      found_digest=$digest
    fi
  done < "$sums_path"
  [ -n "$found_digest" ] || verify_error "missing checksum entry for: $want"
  boot_out "$found_digest"
}

verify_cli_bytes() {
  # $1 = downloaded CLI file, $2 = expected manifest digest, $3 = sums file
  actual=$(sha256_of "$1")
  [ "$actual" = "$2" ] || verify_error "CLI checksum mismatch"
  listed=$(parse_checksums "$3" "$(basename "$1")")
  [ "$listed" = "$2" ] || verify_error "checksum list disagrees with manifest"
}

verify_cli_candidate() {
  # $1 = candidate path, $2 = manifest version
  sh -n "$1" || verify_error "candidate CLI fails syntax check"
  machine_out=$("$1" version --machine 2>&1) || verify_error "candidate version check failed"
  expected=$(printf 'installer_schema=%s\nversion=%s\n' "$INSTALLER_SCHEMA" "$2")
  [ "$machine_out" = "$expected" ] || verify_error "candidate version mismatch"
}

print_help() {
  cat <<'HELP'
zosma-cowork bootstrap installer

usage: install.sh [options] [zosma install options...]

options:
  --version vX.Y.Z   install this exact release
  --dry-run          resolve and strictly validate the release manifest and
                     report the prospective version and CLI asset; performs no
                     checksum or CLI download and cannot validate mode choices
  --help             show this help

The bootstrap verifies the release manifest, the SHA-256 checksum list, and
the temporary CLI candidate, then delegates exactly to:

  "$candidate" install "$@"

The candidate performs mode/platform validation (including local-libc checks)
and all persistent activation. For full dry-run mode validation, run
'zosma install --dry-run' after installation.
HELP
}

# Returns 0 when the delegated child has fully exited (or been reaped).
child_done() {
  st=$(ps -p "$1" -o stat= 2>/dev/null) || return 0
  if [ -z "$st" ]; then return 0; fi
  case "$st" in
    Z*|X*) return 0 ;;
  esac
  return 1
}

cleanup() {
  if [ -n "${tmp_dir:-}" ]; then
    rm -rf "$tmp_dir" 2>/dev/null || :
  fi
}

# Signal-safe delegation. The parent polls the child (so signal traps run at
# the next sleep boundary) and forwards a catchable TERM before falling back
# to SIGKILL, because an asynchronously started POSIX child inherits SIGINT as
# ignored and cannot trap it.
delegate() {
  candidate=$1
  manifest_file=$2
  shift 2
  death=
  child_pid=
  trap 'death=INT' INT
  trap 'death=TERM' TERM
  trap 'cleanup' EXIT
  ZOSMA_INSTALL_MANIFEST=$manifest_file
  export ZOSMA_INSTALL_MANIFEST
  "$candidate" install "$@" &
  child_pid=$!
  status=0
  while :; do
    if [ -n "$death" ]; then
      sig=$death
      death=
      kill -s TERM "$child_pid" 2>/dev/null || :
      n=0
      while ! child_done "$child_pid"; do
        n=$((n + 1))
        if [ "$n" -ge 6 ]; then
          kill -s KILL "$child_pid" 2>/dev/null || :
          break
        fi
        sleep 1
      done
      wait "$child_pid" 2>/dev/null || :
      cleanup
      case "$sig" in
        INT) exit 130 ;;
        TERM) exit 143 ;;
      esac
    fi
    if child_done "$child_pid"; then
      wait "$child_pid" 2>/dev/null || status=$?
      break
    fi
    sleep 1
  done
  death=
  return "$status"
}

main() {
  opt_version=
  opt_dry_run=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --version)
        shift
        [ $# -gt 0 ] || usage_error "--version requires a version"
        opt_version=$1
        valid_version "$opt_version" || usage_error "invalid version: $opt_version"
        shift
        ;;
      --dry-run)
        opt_dry_run=1
        shift
        ;;
      -h|--help)
        print_help
        exit 0
        ;;
      *)
        break
        ;;
    esac
  done

  check_prereqs
  detect_platform
  find_sha_tool

  tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/zosma-install.XXXXXX") || prereq_error "cannot create temporary directory"
  trap 'cleanup' EXIT

  url=$(manifest_url)
  boot_out "Resolving Zosma Cowork release..."
  manifest_file=$tmp_dir/install-manifest
  curl_download "$url" "$manifest_file" || verify_error "failed to download release manifest"
  parse_manifest "$manifest_file"

  boot_out "Release: $MF_VERSION ($BOOT_OS-$BOOT_ARCH)"
  boot_out "CLI asset: $MF_CLI_BASENAME"
  if [ "$opt_dry_run" -eq 1 ]; then
    boot_out "Dry run: manifest verified; no checksums or CLI were downloaded."
    boot_out "Full mode validation happens in 'zosma install --dry-run' after installation."
    return 0
  fi

  sums_file=$tmp_dir/SHA256SUMS
  curl_download "$MF_SUMS_URL" "$sums_file" || verify_error "failed to download checksum list"
  candidate=$tmp_dir/$MF_CLI_BASENAME
  curl_download "$MF_CLI_URL" "$candidate" || verify_error "failed to download CLI candidate"
  chmod +x "$candidate"

  verify_cli_bytes "$candidate" "$MF_CLI_SHA256" "$sums_file"
  verify_cli_candidate "$candidate" "$MF_VERSION"

  boot_out "Verifying CLI ... OK"
  status=0
  delegate "$candidate" "$manifest_file" "$@" || status=$?
  return "$status"
}

main "$@"