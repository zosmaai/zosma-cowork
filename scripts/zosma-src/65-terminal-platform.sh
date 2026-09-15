# ---------------------------------------------------------------------------
# Terminal seam (production /dev/tty; guarded test TTY under ZOSMA_TESTING)
# ---------------------------------------------------------------------------

tty_available() {
  if [ "${ZOSMA_TESTING:-}" = "1" ] && [ -n "${ZOSMA_TEST_TTY:-}" ] && [ -d "$ZOSMA_TEST_TTY" ]; then
    return 0
  fi
  # An actual open, not a permission check: `-r /dev/tty` is true even when
  # there is no controlling terminal. The subshell keeps no fd behind.
  ( exec 9<> /dev/tty ) 2>/dev/null
}

# Opens fd 9 for input and fd 8 for output on the terminal (or the guarded
# test TTY pair). Returns 1 when no terminal is available.
tty_init() {
  if [ "${ZOSMA_TESTING:-}" = "1" ] && [ -n "${ZOSMA_TEST_TTY:-}" ] && [ -d "$ZOSMA_TEST_TTY" ]; then
    exec 9< "$ZOSMA_TEST_TTY/in" || return 1
    exec 8>> "$ZOSMA_TEST_TTY/out" || return 1
    return 0
  fi
  exec 9< /dev/tty || return 1
  exec 8> /dev/tty || return 1
  return 0
}

TTY_READY=0

# Ensures terminal fds are open exactly once (lazy + idempotent).
tty_ensure() {
  if [ "$TTY_READY" -eq 1 ]; then return 0; fi
  tty_init || return 1
  TTY_READY=1
  return 0
}

# Reads one line from the terminal into the global TTY_LINE. Returns 1 on EOF.
tty_read() {
  tty_ensure || return 1
  if IFS= read -r TTY_LINE <&9; then
    return 0
  fi
  return 1
}

tty_write() { tty_ensure || return 0; printf '%s' "$*" >&8; }
tty_line() { tty_ensure || return 0; printf '%s\n' "$*" >&8; }

# ---------------------------------------------------------------------------
# Platform probes (production commands, never test-result overrides)
# ---------------------------------------------------------------------------

probe_os_arch() {
  PLATFORM_OS=
  PLATFORM_ARCH=
  sys=$(uname -s)
  mach=$(uname -m)
  case "$sys" in
    Linux) PLATFORM_OS=linux ;;
    Darwin) PLATFORM_OS=darwin ;;
    *)
      prereq_error "unsupported operating system: $sys (supported: Linux, macOS)"
      ;;
  esac
  case "$mach" in
    x86_64|amd64) PLATFORM_ARCH=x64 ;;
    aarch64|arm64) PLATFORM_ARCH=arm64 ;;
    *)
      prereq_error "unsupported architecture: $mach (supported: x86_64, arm64)"
      ;;
  esac
}

probe_wsl() {
  WSL=0
  if [ "$PLATFORM_OS" = "linux" ]; then
    if [ -r /proc/sys/kernel/osrelease ] && grep -qi microsoft /proc/sys/kernel/osrelease 2>/dev/null; then
      WSL=1
    fi
  fi
}

# Reports the GNU libc version as "major.minor" or empty when unavailable.
detect_libc_version() {
  glibc_version=
  gv=$(getconf GNU_LIBC_VERSION 2>/dev/null) || gv=
  if [ -n "$gv" ]; then
    glibc_version=$(printf '%s\n' "$gv" | sed 's/^glibc[[:space:]]*//I')
    case "$glibc_version" in
      [0-9]*.[0-9]*) : ;;
      *) glibc_version= ;;
    esac
  fi
  if [ -z "$glibc_version" ] && command -v ldd >/dev/null 2>&1; then
    first=$(ldd --version 2>&1 | head -n 1)
    case "$first" in
      *"musl"*) return 0 ;;
      *"GNU libc"*|*glibc*)
        v=$(printf '%s\n' "$first" | sed 's/.*\([0-9][0-9]*\.[0-9][0-9]*\).*/\1/')
        case "$v" in
          [0-9]*.[0-9]*) glibc_version=$v ;;
        esac
        ;;
    esac
  fi
}

version_at_least() {
  # $1 = "maj.min"; $2 = "maj.min" minimum
  a_maj=${1%%.*}
  a_min=${1#*.}
  a_min=${a_min%%[!.0-9]*}
  b_maj=${2%%.*}
  b_min=${2#*.}
  if [ "$a_maj" -gt "$b_maj" ]; then return 0; fi
  if [ "$a_maj" -lt "$b_maj" ]; then return 1; fi
  [ "$a_min" -ge "$b_min" ]
}

probe_macos_version() {
  if [ "$PLATFORM_OS" != "darwin" ]; then return 0; fi
  command -v sw_vers >/dev/null 2>&1 || prereq_error "sw_vers is required on macOS"
  ver=$(sw_vers -productVersion) || prereq_error "cannot read macOS version"
  major=${ver%%.*}
  case "$major" in
    ''|*[!0-9]*) prereq_error "unrecognized macOS version: $ver" ;;
  esac
  [ "$major" -ge 13 ] || prereq_error "macOS 13 or newer is required (found $ver)"
}

# Local-mode libc gate: GNU libc >= 2.35 only; musl/unknown/older must use
# Docker mode. Called only after local mode is selected, never by the
# bootstrap and never in dry-run-less Docker selection.
probe_local_libc() {
  [ "$PLATFORM_OS" = "linux" ] || return 0
  detect_libc_version
  if [ -z "$glibc_version" ]; then
    prereq_error "local mode requires GNU libc >= 2.35 on Linux, but the libc could not be determined; use --mode docker instead"
  fi
  if version_at_least "$glibc_version" "2.35"; then
    return 0
  fi
  prereq_error "local mode requires GNU libc >= 2.35 (found $glibc_version); use --mode docker instead"
}

# ---------------------------------------------------------------------------
