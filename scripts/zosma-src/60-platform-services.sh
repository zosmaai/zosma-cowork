# ---------------------------------------------------------------------------
# Local runtime archive verification and extraction
# ---------------------------------------------------------------------------

cli_curl_download() {
  # Same secure contract as the bootstrap: https-only, TLS 1.2, bounded.
  curl -f -sS -L --proto '=https' --proto-redir '=https' --tlsv1.2 \
    --connect-timeout 10 --max-time 300 -o "$2" "$1"
}

sha_tool_detect() {
  if command -v sha256sum >/dev/null 2>&1; then
    SHA_TOOL=sha256sum
  elif command -v shasum >/dev/null 2>&1; then
    SHA_TOOL=shasum
  else
    prereq_error "no supported SHA-256 tool found (need sha256sum or shasum)"
  fi
}

sha256_of() {
  if [ "$SHA_TOOL" = "shasum" ]; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    sha256sum "$1" | cut -d' ' -f1
  fi
}

archive_basename() {
  printf 'zosma-cowork-server-%s-%s-%s.tar.gz\n' "$ZM_MF_VERSION" "$PLATFORM_OS" "$PLATFORM_ARCH"
}

verify_archive() {
  # $1 = archive path; verifies basename target, checksum list, and bytes.
  expect_name=$(archive_basename)
  case "$(basename "$1")" in
    "$expect_name") : ;;
    *) verify_error "archive basename mismatch: $(basename "$1")" ;;
  esac
  target_key=$(printf 'archive_%s_%s' "$PLATFORM_OS" "$PLATFORM_ARCH" | tr '-' '_')
  sums_file=$ZFIX_ARCHIVE_SUMS
  listed=$(parse_checksum_entry "$sums_file" "$expect_name")
  digest=""
  case "$target_key" in
    archive_linux_x64) digest=$ZM_MF_ARCH_LINUX_X64_SHA256 ;;
    archive_linux_arm64) digest=$ZM_MF_ARCH_LINUX_ARM64_SHA256 ;;
    archive_darwin_x64) digest=$ZM_MF_ARCH_DARWIN_X64_SHA256 ;;
    archive_darwin_arm64) digest=$ZM_MF_ARCH_DARWIN_ARM64_SHA256 ;;
    *) verify_error "unsupported platform tuple: $PLATFORM_OS-$PLATFORM_ARCH" ;;
  esac
  [ "$listed" = "$digest" ] || verify_error "checksum list disagrees with manifest"
  actual=$(sha256_of "$1")
  [ "$actual" = "$digest" ] || verify_error "archive checksum mismatch"
}

parse_checksum_entry() {
  # $1 = sums file, $2 = wanted basename; prints the digest; exits 4 on any
  # grammar violation, duplicate, or conflict for the selected entry.
  want=$2
  found_digest=
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    d=${line%%[!0-9a-fA-F]*}
    [ "${#d}" -eq 64 ] || verify_error "malformed checksum entry"
    rest=$(printf '%s' "${line#"$d"}" | sed 's/^ *//; s/^\*//')
    case "$rest" in
      ''|*' '*) verify_error "malformed checksum entry" ;;
    esac
    if [ "$rest" = "$want" ]; then
      [ -z "$found_digest" ] || verify_error "duplicate checksum entry for: $want"
      case "$d" in
        [a-f0-9]*) found_digest=$d ;;
        *) verify_error "conflicting checksum entry for: $want" ;;
      esac
    fi
  done < "$1"
  [ -n "$found_digest" ] || verify_error "missing checksum entry for: $want"
  printf '%s\n' "$found_digest"
}

validate_archive_members() {
  # Rejects absolute or parent-traversing members before extraction.
  list_file=$(mktemp "${TMPDIR:-/tmp}/zosma-members.XXXXXX") || verify_error "cannot create member list"
  tar -tzf "$1" > "$list_file" 2>/dev/null || verify_error "cannot list archive members"
  violation=
  while IFS= read -r member; do
    case "$member" in
      /*) violation=$member; break ;; # absolute member
    esac
    # A leading '.' member is legitimate (tar -t ./...); reject '..' as any
    # complete segment (first, middle, or terminal).
    case "/$member" in
      */../*|*/..) violation=$member; break ;;
    esac
  done < "$list_file"
  rm -f "$list_file"
  if [ -n "$violation" ]; then
    verify_error "archive member escapes the stage: $violation"
  fi
}

validate_runtime_tree() {
  # $1 = generation root; enforces the exact Phase 1 entry contract.
  required="runtime/bin/node runtime/lib/node_modules/npm/bin/npm-cli.js runtime/lib/node_modules/npm/bin/npx-cli.js web/dist-server/server.js web/dist-server/bin/pi-web.js daemon/src/index.ts daemon/bin/zosma-daemon.js supervisor/run-server.mjs supervisor/healthcheck.mjs VERSION"
  for entry in $required; do
    [ -f "$1/$entry" ] || verify_error "required runtime file missing: $entry"
  done
  if [ -f "$1/runtime/bin/node" ] && [ ! -L "$1/runtime/bin/node" ]; then
    :
  else
    verify_error "runtime/bin/node must be a regular file"
  fi
  if [ -x "$1/runtime/bin/node" ]; then
    :
  else
    verify_error "runtime/bin/node must be executable"
  fi
  node=$1/runtime/bin/node
  version_text=$("$node" --version 2>/dev/null) || verify_error "bundled node does not run"
  case "$version_text" in v*) : ;; *) verify_error "invalid bundled node version" ;; esac
  vfile=$(cat "$1/VERSION" 2>/dev/null)
  [ "$vfile" = "$ZM_MF_VERSION" ] || verify_error "VERSION does not match the manifest"
  # Every extracted symlink must stay within the generation root.
  link_list=$(mktemp "${TMPDIR:-/tmp}/zosma-links.XXXXXX") || verify_error "cannot create link list"
  find "$1" -type l > "$link_list" 2>/dev/null || :
  violation2=
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    target=$(readlink "$file")
    case "$target" in
      /*) violation2="absolute symlink in archive: $file"; break ;;
    esac
    resolved=$file
    n=0
    while [ -L "$resolved" ]; do
      n=$((n + 1))
      if [ "$n" -ge 32 ]; then violation2="symlink loop in archive: $file"; break 2; fi
      dir=${resolved%/*}
      resolved=$dir/$(readlink "$resolved")
    done
    if ! within_root "$resolved" "$1"; then
      violation2="symlink escapes the generation: $file"
      break
    fi
  done < "$link_list"
  rm -f "$link_list"
  if [ -n "$violation2" ]; then
    verify_error "$violation2"
  fi
}

port_probe() {
  # $1 = bundled node, $2 = port, $3 = port; reads /dev/urandom-free probe.
  "$1" -e 'const net=require("net");const ports=[Number(process.argv[1]),Number(process.argv[2])];let pending=ports.length;const res={};function done(){if(--pending)return;process.stdout.write(ports.map(p=>p+":"+(res[p]?"occupied":"free")).join("\n")+"\n");}ports.forEach(p=>{const s=net.connect(p,"127.0.0.1");s.once("connect",()=>{res[p]=1;s.destroy();done();});s.once("error",()=>{res[p]=0;done();});});' "$2" "$3"
}

# ---------------------------------------------------------------------------
# Service manager detection and rendering
# ---------------------------------------------------------------------------

detect_service_manager() {
  if [ "$PLATFORM_OS" = "linux" ]; then
    if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
      printf 'systemd\n'
      return 0
    fi
  elif [ "$PLATFORM_OS" = "darwin" ]; then
    if command -v launchctl >/dev/null 2>&1 && launchctl print "gui/$(id -u)" >/dev/null 2>&1; then
      printf 'launchd\n'
      return 0
    fi
  fi
  printf 'none\n'
}

unit_escape() {
  # systemd unit value escaping: percent signs must be doubled.
  printf '%s' "$1" | sed 's/%/%%/g'
}

libc_check_marker() { :; }

render_systemd_unit() {
  # Renders a marked private user unit to stdout (no secrets).
  exec_path=$(unit_escape "$ZM_BIN_DIR/zosma")
  { printf '%s\n' \
    "# ZOSMA_COWORK_INSTALLER_SCHEMA=1"
    printf '%s\n' \
    "[Unit]" \
    "Description=Zosma Cowork"
    printf '%s\n' \
    "[Service]" \
    "Type=simple" \
    "ExecStart=$exec_path serve --service" \
    "Restart=on-failure" \
    "TimeoutStopSec=15" \
    "Environment=HOME=$ZM_HOME" \
    "Environment=XDG_DATA_HOME=$ZM_XDG_DATA" \
    "Environment=XDG_CONFIG_HOME=$ZM_XDG_CONFIG" \
    "Environment=XDG_STATE_HOME=$ZM_XDG_STATE" \
    "Environment=PI_CODING_AGENT_DIR=$CFG_PI_DIR"
    printf '%s\n' "[Install]" "WantedBy=default.target"
  }
}

xml_escape() {
  printf '%s' "$1" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g'
}

render_launchd_plist() {
  # Renders a marked LaunchAgent plist to stdout (no secrets).
  label=$LAUNCH_AGENT_LABEL
  bin=$(xml_escape "$ZM_BIN_DIR/zosma")
  { printf '%s\n' \
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" \
    "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">" \
    "<plist version=\"1.0\">" \
    "<dict>" \
    "  <key>Label</key>" \
    "  <string>$label</string>" \
    "  <key>ZOSMA_COWORK_INSTALLER_SCHEMA</key><string>1</string>"
    printf '  <key>ProgramArguments</key>\n  <array>\n    <string>%s</string>\n    <string>serve</string>\n    <string>--service</string>\n  </array>\n' "$bin"
    printf '%s\n' \
    "  <key>RunAtLoad</key><true/>" \
    "  <key>KeepAlive</key><true/>" \
    "  <key>StandardOutPath</key><string>$(xml_escape "$ZM_STATE_ROOT/logs/serve.out.log")</string>" \
    "  <key>StandardErrorPath</key><string>$(xml_escape "$ZM_STATE_ROOT/logs/serve.err.log")</string>" \
    "  <key>EnvironmentVariables</key>" \
    "  <dict>" \
    "    <key>HOME</key><string>$(xml_escape "$ZM_HOME")</string>" \
    "    <key>XDG_DATA_HOME</key><string>$(xml_escape "$ZM_XDG_DATA")</string>" \
    "    <key>XDG_CONFIG_HOME</key><string>$(xml_escape "$ZM_XDG_CONFIG")</string>" \
    "    <key>XDG_STATE_HOME</key><string>$(xml_escape "$ZM_XDG_STATE")</string>" \
    "    <key>PI_CODING_AGENT_DIR</key><string>$(xml_escape "$CFG_PI_DIR")</string>" \
    "  </dict>" \
    "</dict>" \
    "</plist>"
  }
}

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

print_help() {
  cat <<'HELP'
zosma — Zosma Cowork lifecycle command

usage: zosma <command> [options]

commands:
  install [local|docker]   install or reinstall Cowork
  serve                    run the local server in the foreground
  start | stop | restart   manage the installed service
  status                   show installation state
  logs [--follow]          show service logs
  open                     open the web interface
  doctor                   diagnose the installation
  access [--show-password] show access information
  update [--version V]     update Cowork
  uninstall [--purge-data] remove Cowork
  version [--machine]      print version information
  --help                   show this help

Run 'zosma <command> --help' for command options.
HELP
}

cmd_version() {
  case "${1:-}" in
    '') out "Zosma Cowork CLI $ZOSMA_CLI_VERSION (installer schema $ZOSMA_INSTALLER_SCHEMA)" ;;
    --machine)
      [ $# -eq 1 ] || usage_error "version accepts only --machine"
      out "installer_schema=$ZOSMA_INSTALLER_SCHEMA"
      out "version=$ZOSMA_CLI_VERSION"
      ;;
    *) usage_error "unknown version option: $1" ;;
  esac
}

