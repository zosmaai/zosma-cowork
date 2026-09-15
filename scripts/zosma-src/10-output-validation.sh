# ---------------------------------------------------------------------------
# Output and error helpers
# ---------------------------------------------------------------------------

out() { printf '%s\n' "$*"; }
err() { printf '%s\n' "$*" >&2; }
warn() { printf '%s\n' "warning: $*" >&2; }

usage_error() {
  err "error: $*"
  err "usage: zosma <command> [options]  (see 'zosma --help')"
  exit "$EXIT_USAGE"
}

prereq_error() { err "error: $*"; exit "$EXIT_PREREQ"; }
verify_error() { err "error: $*"; exit "$EXIT_VERIFY"; }
runtime_error() { err "error: $*"; exit "$EXIT_RUNTIME"; }
cancel_error() { err "error: $*"; exit "$EXIT_CANCEL"; }
internal_error() { err "error: $*"; exit "$EXIT_INTERNAL"; }

# ---------------------------------------------------------------------------
# Pure value validators (never touch the filesystem)
# ---------------------------------------------------------------------------

is_absolute() {
  case "$1" in /*) return 0 ;; esac
  return 1
}

has_nonprintable() {
  # True when the value contains a byte outside printable ASCII (space..~).
  printf '%s' "$1" | LC_ALL=C grep -q '[^ -~]'
}

valid_version() {
  case $(printf '%s\n' "$1" | sed -n \
    's/^v[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\(-[0-9A-Za-z][0-9A-Za-z.-]*\)*$/ok/p') in
    ok) return 0 ;;
  esac
  return 1
}

valid_port() {
  case "$1" in ''|*[!0-9]*) return 1 ;; esac
  [ "$1" -ge 1 ] && [ "$1" -le 65535 ]
}

valid_hex() {
  case "$1" in ''|*[!0-9a-f]*) return 1 ;; esac
  return 0
}

valid_digest_ref() {
  hex=${1#ghcr.io/zosmaai/zosma-cowork@sha256:}
  case "$1" in
    ghcr.io/zosmaai/zosma-cowork@sha256:*) : ;;
    *) return 1 ;;
  esac
  valid_hex "$hex" || return 1
  [ "${#hex}" -eq 64 ] || return 1
  return 0
}

valid_hostname() {
  h=$1
  case "$h" in
    ''|*[!0-9A-Za-z.-]*) return 1 ;;
    *..*|.*|*.) return 1 ;;
  esac
  [ "${#h}" -le 253 ] || return 1
  remaining=$h
  while [ -n "$remaining" ]; do
    label=${remaining%%.*}
    case "$label" in
      ''|-*|*-) return 1 ;;
    esac
    [ "${#label}" -le 63 ] || return 1
    case "$remaining" in
      *.*) remaining=${remaining#*.} ;;
      *) break ;;
    esac
  done
  return 0
}

valid_null_or_absolute() {
  [ -z "$1" ] && return 0
  is_absolute "$1" || return 1
  has_nonprintable "$1" && return 1
  return 0
}

