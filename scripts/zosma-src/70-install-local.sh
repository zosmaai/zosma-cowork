# Install request parsing and validation
# ---------------------------------------------------------------------------

local_pi_dir() {
  # Pure path resolution; never inspects or creates the external Pi path.
  if [ -n "${PI_CODING_AGENT_DIR:-}" ]; then
    PI_DIR_RESOLVED=$PI_CODING_AGENT_DIR
  else
    PI_DIR_RESOLVED=${HOME%}/.pi/agent
  fi
  is_absolute "$PI_DIR_RESOLVED" || usage_error "PI_CODING_AGENT_DIR must be absolute"
  if has_nonprintable "$PI_DIR_RESOLVED"; then
    usage_error "PI_CODING_AGENT_DIR contains non-printable characters"
  fi
}

valid_workspace() {
  # $1 = the absolute existing workspace directory
  is_absolute "$1" || usage_error "workspace must be an absolute path"
  if has_nonprintable "$1"; then
    usage_error "workspace contains non-printable characters"
  fi
  [ -d "$1" ] || usage_error "workspace must exist and be a directory: $1"
}

parse_install_options() {
  opt_mode=
  opt_version=
  opt_workspace=
  opt_port=
  opt_lan=0
  opt_hostname=
  opt_yes=0
  opt_no_start=0
  opt_dry_run=0
  positional_mode=
  seen_mode=0
  seen_version=0
  seen_workspace=0
  seen_port=0
  seen_hostname=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --mode)
        shift
        [ $# -gt 0 ] || usage_error "--mode requires a value"
        [ "$seen_mode" -eq 0 ] || usage_error "duplicate --mode option"
        seen_mode=1
        case "$1" in local|docker) opt_mode=$1 ;;
          *) usage_error "invalid mode: $1 (expected local or docker)" ;;
        esac
        ;;
      --version)
        shift
        [ $# -gt 0 ] || usage_error "--version requires a value"
        [ "$seen_version" -eq 0 ] || usage_error "duplicate --version option"
        seen_version=1
        valid_version "$1" || usage_error "invalid version: $1"
        opt_version=$1
        ;;
      --workspace)
        shift
        [ $# -gt 0 ] || usage_error "--workspace requires a value"
        [ "$seen_workspace" -eq 0 ] || usage_error "duplicate --workspace option"
        seen_workspace=1
        opt_workspace=$1
        ;;
      --port)
        shift
        [ $# -gt 0 ] || usage_error "--port requires a value"
        [ "$seen_port" -eq 0 ] || usage_error "duplicate --port option"
        seen_port=1
        valid_port "$1" || usage_error "invalid port: $1 (expected 1..65535)"
        opt_port=$1
        ;;
      --hostname)
        shift
        [ $# -gt 0 ] || usage_error "--hostname requires a value"
        [ "$seen_hostname" -eq 0 ] || usage_error "duplicate --hostname option"
        seen_hostname=1
        valid_hostname "$1" || usage_error "invalid hostname: $1"
        opt_hostname=$1
        ;;
      --lan)
        opt_lan=1
        ;;
      --yes)
        opt_yes=1
        ;;
      --no-start)
        opt_no_start=1
        ;;
      --dry-run)
        opt_dry_run=1
        ;;
      -h|--help)
        print_install_help
        exit 0
        ;;
      local|docker)
        [ -z "$positional_mode" ] || usage_error "duplicate positional mode"
        positional_mode=$1
        ;;
      *)
        usage_error "unknown install option: $1"
        ;;
    esac
    shift
  done
  if [ -n "$positional_mode" ] && [ -n "$opt_mode" ] && [ "$positional_mode" != "$opt_mode" ]; then
    usage_error "conflicting modes: $positional_mode vs $opt_mode"
  fi
  MODE=${opt_mode:-$positional_mode}
  if [ -z "$opt_port" ]; then
    INSTALL_PORT=$DEFAULT_WEB_PORT
  else
    INSTALL_PORT=$opt_port
  fi
  if [ "$opt_lan" -eq 1 ]; then
    INSTALL_BIND=0.0.0.0
  else
    INSTALL_BIND=127.0.0.1
  fi
  if [ "$opt_yes" -eq 1 ]; then
    INTERACTIVE=0
  elif tty_available; then
    INTERACTIVE=1
  else
    INTERACTIVE=0
  fi
}

print_install_help() {
  cat <<'HELP'
usage: zosma install [local|docker] [options]

options:
  --mode local|docker  select the installation mode (also positional)
  --version vX.Y.Z     install this exact release
  --workspace PATH     Docker mode: existing absolute workspace directory
  --port 1-65535       web port (default 30141)
  --lan                bind to all interfaces; requires --hostname
  --hostname HOST      allowed Host header for LAN mode
  --yes                non-interactive; never prompts or opens a browser
  --no-start           complete the installation stopped
  --dry-run            validate the complete request without any download,
                       write, start, browser call, or deletion
  --help               show this help

Without a terminal, --yes, --mode, and every mode-required value are mandatory.
HELP
}

install_mode_menu() {
  [ "$INTERACTIVE" -eq 1 ] || usage_error "no installation mode given; use --mode local|docker (a terminal is required for the menu)"
  tty_ensure || usage_error "cannot open the terminal for the mode menu"
  tty_line ""
  tty_line "Zosma Cowork Installer"
  tty_line ""
  tty_line "Choose an installation mode:"
  tty_line ""
  tty_line "  1  Local server    Run Cowork directly on this machine"
  tty_line "  2  Docker          Run Cowork in an isolated container"
  tty_line "  3  Exit"
  tty_line ""
  while :; do
    tty_write "> "
    tty_read || cancel_error "installation cancelled"
    menu_choice=$TTY_LINE
    case "$menu_choice" in
      1) MODE=local; return 0 ;;
      2) MODE=docker; return 0 ;;
      3) cancel_error "installation cancelled" ;;
      *) tty_line "Please enter 1, 2, or 3." ;;
    esac
  done
}

prompt_install_value() {
  # $1 = prompt; result lands in the global TTY_LINE after tty_read.
  tty_write "$1"
  tty_read || cancel_error "installation cancelled"
}

validate_install_request() {
  [ -n "$MODE" ] || install_mode_menu
  case "$MODE" in
    local|docker) : ;;
    *) usage_error "invalid mode: $MODE" ;;
  esac
  if [ "$INTERACTIVE" -eq 0 ] && [ "$opt_yes" -eq 0 ]; then
    usage_error "install without a terminal requires --yes"
  fi
  probe_os_arch
  probe_wsl
  probe_macos_version
  if [ "$MODE" = "local" ]; then
    probe_local_libc
    [ -z "$opt_workspace" ] || usage_error "--workspace is only valid for docker mode"
  else
    if [ -z "$opt_workspace" ]; then
      if [ "$INTERACTIVE" -eq 1 ]; then
        prompt_install_value "Workspace directory (absolute path): "
        opt_workspace=$TTY_LINE
      else
        usage_error "docker install requires --workspace"
      fi
    fi
    valid_workspace "$opt_workspace"
  fi
  if [ "$INSTALL_BIND" = "0.0.0.0" ]; then
    if [ -z "$opt_hostname" ]; then
      if [ "$INTERACTIVE" -eq 1 ]; then
        proposed=$(hostname 2>/dev/null) || proposed=
        tty_line "LAN mode exposes Cowork on your network with password protection."
        tty_line ""
        if [ -n "$proposed" ] && valid_hostname "$proposed"; then
          prompt_install_value "Allowed hostname [$proposed]: "
          opt_hostname=$TTY_LINE
          [ -n "$opt_hostname" ] || opt_hostname=$proposed
        else
          prompt_install_value "Allowed hostname: "
          opt_hostname=$TTY_LINE
        fi
      else
        usage_error "--lan requires --hostname"
      fi
    fi
    valid_hostname "$opt_hostname" || usage_error "invalid hostname: $opt_hostname"
    if [ "$opt_hostname" = "127.0.0.1" ]; then
      usage_error "--lan requires a network hostname, not 127.0.0.1"
    fi
  else
    if [ -n "$opt_hostname" ]; then
      usage_error "--hostname requires --lan"
    fi
  fi
  return 0
}

print_install_plan() {
  out "Zosma Cowork install plan (dry run)"
  out "Mode: $MODE"
  out "Platform: $PLATFORM_OS-$PLATFORM_ARCH"
  if [ "$MODE" = "local" ]; then
    out "Web: http://127.0.0.1:$INSTALL_PORT"
    local_pi_dir
    out "Pi directory: $PI_DIR_RESOLVED (not created or modified)"
  else
    out "Web: http://${INSTALL_BIND:-127.0.0.1}:$INSTALL_PORT"
    out "Workspace: $opt_workspace (bind-mounted read/write)"
  fi
  if [ "$INSTALL_BIND" = "0.0.0.0" ]; then
    out "Bind: 0.0.0.0 with password-protected LAN access (host: $opt_hostname)"
  else
    out "Bind: loopback only, no web password"
  fi
  out "No artifacts were downloaded and nothing was written or started."
}

cli_manifest_url() {
  if [ -n "${opt_version:-}" ]; then
    printf 'https://github.com/zosmaai/zosma-cowork/releases/download/%s/install-manifest.txt\n' "$opt_version"
    return 0
  fi
  if [ "${ZOSMA_TESTING:-}" = "1" ] && [ -n "${ZOSMA_TEST_MANIFEST_URL:-}" ]; then
    printf '%s\n' "$ZOSMA_TEST_MANIFEST_URL"
    return 0
  fi
  printf '%s\n' "https://install.zosma.ai/releases/stable"
}

install_resolve_manifest() {
  ZM_INSTALL_TMPDIR=
  if [ -n "${ZOSMA_INSTALL_MANIFEST:-}" ] && [ -f "$ZOSMA_INSTALL_MANIFEST" ]; then
    parse_manifest_file "$ZOSMA_INSTALL_MANIFEST" || return "$?"
    return 0
  fi
  ZM_INSTALL_TMPDIR=$(mktemp -d "${TMPDIR:-/tmp}/zosma-cli.XXXXXX") || prereq_error "cannot create temporary directory"
  url=$(cli_manifest_url)
  cli_curl_download "$url" "$ZM_INSTALL_TMPDIR/install-manifest" || {
    rm -rf "$ZM_INSTALL_TMPDIR"
    verify_error "failed to fetch release manifest"
  }
  parse_manifest_file "$ZM_INSTALL_TMPDIR/install-manifest" || return "$?"
}

install_cleanup_tmp() {
  if [ -n "${ZM_INSTALL_TMPDIR:-}" ]; then
    rm -rf "$ZM_INSTALL_TMPDIR"
    ZM_INSTALL_TMPDIR=
  fi
}

config_write_docker() {
  cfg_root=$ZM_CONFIG_ROOT
  ensure_marker "$ZM_CONFIG_ROOT" || internal_error "unowned config root"
  ensure_marker "$ZM_DOCKER_ROOT" || internal_error "unowned Docker config root"
  ensure_marker "$ZM_DOCKER_PI_STATE" || internal_error "unowned Docker Pi state"
  mkdir -p "$ZM_DOCKER_ROOT"
  chmod 700 "$ZM_DOCKER_ROOT"
  {
    printf 'CONFIG_SCHEMA=%s\n' "$CONFIG_SCHEMA"
    printf 'MODE=docker\n'
    printf 'VERSION=%s\n' "$ZM_MF_VERSION"
    printf 'PORT=%s\n' "$INSTALL_PORT"
    printf 'BIND_ADDRESS=%s\n' "$INSTALL_BIND"
    printf 'ALLOWED_HOST=%s\n' "${opt_hostname:-127.0.0.1}"
    printf 'PI_DIR=%s\n' "$ZM_DOCKER_PI_STATE"
    printf 'WORKSPACE=%s\n' "$opt_workspace"
    printf 'IMAGE=%s\n' "$ZM_MF_DOCKER_IMAGE"
    printf 'SERVICE_MANAGER=none\n'
  } > "$cfg_root/config"
  chmod 600 "$cfg_root/config"
  {
    printf 'DAEMON_TOKEN=%s\n' "$SEC_DAEMON_TOKEN"
    printf 'WEB_PASSWORD=%s\n' "$SEC_WEB_PASSWORD"
  } > "$cfg_root/secrets"
  chmod 600 "$cfg_root/secrets"
  cat > "$ZM_DOCKER_ROOT/compose.yml" <<'COMPOSE'
services:
  cowork:
    image: "${ZOSMA_IMAGE:?set ZOSMA_IMAGE to an immutable ghcr.io digest reference}"
    user: "${ZOSMA_UID:-1000}:${ZOSMA_GID:-1000}"
    restart: unless-stopped
    environment:
      HOME: /data/pi-agent
      PORT: "30141"
      PI_WEB_HOSTNAME: 0.0.0.0
      PI_WEB_NO_OPEN: "1"
      PI_WEB_PASSWORD: "${PI_WEB_PASSWORD:-}"
      PI_WEB_ALLOWED_HOSTS: "${PI_WEB_ALLOWED_HOSTS:-}"
      PI_CODING_AGENT_DIR: /data/pi-agent
      ZOSMA_DAEMON_DATA_DIR: /data/pi-agent/daemon
      ZOSMA_DAEMON_PORT: "64713"
      ZOSMA_DAEMON_TOKEN: "${ZOSMA_DAEMON_TOKEN:?set ZOSMA_DAEMON_TOKEN}"
    ports:
      - name: web
        target: 30141
        published: "${ZOSMA_PORT:-30141}"
        host_ip: "${ZOSMA_BIND_ADDRESS:-127.0.0.1}"
        protocol: tcp
    volumes:
      - type: bind
        source: "${ZOSMA_WORKSPACE:?set ZOSMA_WORKSPACE to an absolute directory}"
        target: /workspace
      - type: bind
        source: "${ZOSMA_PI_STATE:?set ZOSMA_PI_STATE to an absolute directory}"
        target: /data/pi-agent
COMPOSE
  chmod 600 "$ZM_DOCKER_ROOT/compose.yml"
}

config_write_local() {
  # Writes final config + secrets + service definition (config_switched).
  cfg_root=$ZM_CONFIG_ROOT
  ensure_marker "$cfg_root" || internal_error "unowned config root"
  {
    printf 'CONFIG_SCHEMA=%s\n' "$CONFIG_SCHEMA"
    printf 'MODE=local\n'
    printf 'VERSION=%s\n' "$ZM_MF_VERSION"
    printf 'PORT=%s\n' "$INSTALL_PORT"
    printf 'BIND_ADDRESS=%s\n' "$INSTALL_BIND"
    printf 'ALLOWED_HOST=%s\n' "$INSTALL_ALLOWED_HOST"
    printf 'PI_DIR=%s\n' "$CFG_PI_DIR"
    printf 'WORKSPACE=\n'
    printf 'IMAGE=\n'
    printf 'SERVICE_MANAGER=%s\n' "$CFG_SERVICE_MANAGER"
  } > "$cfg_root/config"
  chmod 600 "$cfg_root/config"
  {
    printf 'DAEMON_TOKEN=%s\n' "$SEC_DAEMON_TOKEN"
    printf 'WEB_PASSWORD=%s\n' "$SEC_WEB_PASSWORD"
  } > "$cfg_root/secrets"
  chmod 600 "$cfg_root/secrets"
}

install_activate_service() {
  # Installs the rendered service definition for a configured local install.
  case "$CFG_SERVICE_MANAGER" in
    systemd)
      mkdir -p "$ZM_XDG_CONFIG/systemd/user"
      render_systemd_unit > "$ZM_SYSTEMD_UNIT"
      chmod 600 "$ZM_SYSTEMD_UNIT"
      # A unit outside the running manager's search path is made visible
      # with `link` before reload/enable.
      if [ "$ZM_XDG_CONFIG" != "$ZM_HOME/.config" ]; then
        systemctl --user link "$ZM_SYSTEMD_UNIT" || runtime_error "systemd link failed"
      fi
      systemctl --user daemon-reload || runtime_error "systemd daemon-reload failed"
      systemctl --user enable "$SYSTEMD_UNIT_BASENAME" || runtime_error "systemd enable failed"
      ;;
    launchd)
      mkdir -p "$ZM_LAUNCH_AGENT"
      render_launchd_plist > "$ZM_LAUNCH_AGENT"
      chmod 600 "$ZM_LAUNCH_AGENT"
      launchctl bootstrap "gui/$(id -u)" "$ZM_LAUNCH_AGENT" 2>/dev/null || :
      ;;
    none) : ;;
  esac
}

install_start_runtime() {
  # Returns 0 when started + healthy; 1 otherwise. Manager mode only.
  case "$CFG_SERVICE_MANAGER" in
    none)
      out "SERVICE_MANAGER=none: launch Cowork with 'zosma serve'."
      return 0
      ;;
    systemd)
      if [ "$opt_no_start" -eq 0 ]; then
        systemctl --user start "$SYSTEMD_UNIT_BASENAME" || runtime_error "systemd start failed"
        health_web_ok || runtime_error "Cowork did not become healthy after starting"
      fi
      ;;
    launchd)
      launchctl bootstrap "gui/$(id -u)" "$ZM_LAUNCH_AGENT" 2>/dev/null || :
      if [ "$opt_no_start" -eq 0 ]; then
        launchctl kickstart -k "gui/$(id -u)/$LAUNCH_AGENT_LABEL" 2>/dev/null || :
        health_web_ok || runtime_error "Cowork did not become healthy after starting"
      fi
      ;;
  esac
  return 0
}

health_web_ok() {
  # Optional arguments are port, password, and allowed Host value.
  health_port=${1:-${INSTALL_PORT:-$CFG_PORT}}
  health_password=${2-}
  [ "$#" -ge 2 ] || health_password=${SEC_WEB_PASSWORD-}
  health_host=${3:-${INSTALL_ALLOWED_HOST:-$CFG_ALLOWED_HOST}}
  cfg=$(mktemp "${TMPDIR:-/tmp}/zosma-health.XXXXXX") || return 1
  chmod 600 "$cfg"
  {
    printf 'silent\nshow-error\nmax-time 30\nconnect-timeout 5\n'
    printf 'user = "pi:%s"\n' "$health_password"
    printf 'header = "Host: %s"\n' "$health_host"
  } > "$cfg"
  curl -f -K "$cfg" "http://127.0.0.1:$health_port/api/v1/health" >/dev/null 2>&1 &
  cpid=$!
  n=0
  while kill -0 "$cpid" 2>/dev/null; do
    if [ "$n" -ge 30 ]; then
      kill -TERM "$cpid" 2>/dev/null || :
      sleep 1
      kill -KILL "$cpid" 2>/dev/null || :
      wait "$cpid" 2>/dev/null || :
      rm -f "$cfg"
      return 1
    fi
    sleep 1
    n=$((n + 1))
  done
  wait "$cpid"
  rc=$?
  rm -f "$cfg"
  [ "$rc" -eq 0 ]
}

assert_existing_roots() {
  # A fresh installation refuses any existing unmarked or symlinked path in
  # its managed roots; nothing is overwritten on a collision.
  for d in "$ZM_DATA_ROOT" "$ZM_CONFIG_ROOT" "$ZM_STATE_ROOT" "$ZM_CACHE_ROOT" \
    "$ZM_DATA_ROOT/cli" "$ZM_DATA_ROOT/cli/versions" \
    "$ZM_DATA_ROOT/runtime" "$ZM_DATA_ROOT/runtime/versions" \
    "$ZM_CLI_CURRENT" "$ZM_RUNTIME_CURRENT" "$ZM_SYSTEMD_UNIT" "$ZM_LAUNCH_AGENT"; do
    if [ -e "$d" ] || [ -L "$d" ]; then
      if [ -L "$d" ]; then
        err "error: refusing to install over the symlinked path: $d"
        return 1
      fi
      if [ -d "$d" ] && is_marked_dir "$d"; then
        continue
      fi
      err "error: refusing to install over the unmarked path: $d"
      return 1
    fi
  done
  if [ -e "$ZM_BIN_DIR/zosma" ] || [ -L "$ZM_BIN_DIR/zosma" ]; then
    err "error: refusing to overwrite the existing launcher: $ZM_BIN_DIR/zosma"
    return 1
  fi
  return 0
}

assert_existing_version_paths() {
  # Version directories are managed paths too, but their names come from the
  # verified manifest and therefore must be checked after it is resolved.
  for d in \
    "$ZM_CLI_VERSIONS/$ZM_MF_VERSION" \
    "$ZM_RUNTIME_VERSIONS/$ZM_MF_VERSION"; do
    if [ -e "$d" ] || [ -L "$d" ]; then
      if [ -L "$d" ] || [ ! -d "$d" ] || ! is_marked_dir "$d"; then
        err "error: refusing to install over the unmarked path: $d"
        return 1
      fi
    fi
  done
  return 0
}

install_fresh_local() {
  resolve_roots
  if ! assert_existing_roots; then
    exit "$EXIT_INTERNAL"
  fi
  sha_tool_detect
  install_resolve_manifest || return "$?"
  if ! assert_existing_version_paths; then
    exit "$EXIT_INTERNAL"
  fi
  trap 'install_cleanup_tmp' EXIT

  local_pi_dir
  CFG_PI_DIR=$PI_DIR_RESOLVED
  CFG_SERVICE_MANAGER=$(detect_service_manager)
  # LAN vs loopback: loopback keeps an empty web password; LAN generates one.
  if [ "$INSTALL_BIND" = "0.0.0.0" ]; then
    INSTALL_ALLOWED_HOST=$opt_hostname
    SEC_WEB_PASSWORD=$(gen_hex 32)
  else
    INSTALL_ALLOWED_HOST=127.0.0.1
    SEC_WEB_PASSWORD=
  fi
  SEC_DAEMON_TOKEN=$(gen_hex 64)
  case "$SEC_DAEMON_TOKEN" in [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) : ;; *) internal_error "failed to generate a daemon token" ;; esac

  # Download the archive and checksum list, then verify three ways.
  expect_name=$(archive_basename)
  stage_root=$ZM_STATE_ROOT/transaction
  mkdir -p "$stage_root"
  arch_sha=
  case "$PLATFORM_OS-$PLATFORM_ARCH" in
    linux-x64) arch_url=$ZM_MF_ARCH_LINUX_X64_URL ;;
    linux-arm64) arch_url=$ZM_MF_ARCH_LINUX_ARM64_URL ;;
    darwin-x64) arch_url=$ZM_MF_ARCH_DARWIN_X64_URL ;;
    darwin-arm64) arch_url=$ZM_MF_ARCH_DARWIN_ARM64_URL ;;
    *) internal_error "unreachable platform tuple" ;;
  esac
  archive_tmp=$stage_root/$expect_name
  sums_tmp=$stage_root/SHA256SUMS
  cli_curl_download "$ZM_MF_SUMS_URL" "$sums_tmp" || verify_error "failed to download checksum list"
  cli_curl_download "$arch_url" "$archive_tmp" || verify_error "failed to download server archive"
  ZFIX_ARCHIVE_SUMS=$sums_tmp
  verify_archive "$archive_tmp"

  validate_archive_members "$archive_tmp"

  # Stage the runtime tree and validate it before activation.
  stage_extract=$stage_root/.extract.XXXXXX
  extract_dir=$(mktemp -d "${stage_extract%.XXXXXX}.XXXXXX") || internal_error "cannot create stage"
  tar -xzf "$archive_tmp" -C "$extract_dir" || verify_error "failed to extract archive"
  validate_runtime_tree "$extract_dir"

  # Create the CLI generation (protected, not yet active).
  cli_versions=$ZM_CLI_VERSIONS
  mkdir -p "$cli_versions/$ZM_MF_VERSION/generations"
  cli_gen=$(new_generation_dir "$cli_versions/$ZM_MF_VERSION/generations")
  cli_gen_dir=$cli_versions/$ZM_MF_VERSION/generations/$cli_gen
  mkdir -p "$cli_gen_dir"
  # Replicate this CLI as the generation executable.
  cp "$0" "$cli_gen_dir/zosma"
  chmod 755 "$cli_gen_dir/zosma"

  # Probe both managed ports with the staged bundled node before activation.
  probe_result=$("$extract_dir/runtime/bin/node" "$0" 2>/dev/null && true) || :
  probe_result=$(port_probe "$extract_dir/runtime/bin/node" "$INSTALL_PORT" "$FIXED_DAEMON_PORT") || probe_result=
  probe_web_line=$(printf '%s\n' "$probe_result" | sed -n '1p')
  probe_daemon_line=$(printf '%s\n' "$probe_result" | sed -n '2p')
  if [ -n "$probe_result" ] && printf '%s\n' "$probe_result" | grep -q ":occupied"; then
    if printf '%s\n' "$probe_web_line" | grep -q ":occupied"; then
      err "error: the configured port $INSTALL_PORT is already in use; pass --port to select another"
    else
      err "error: the fixed daemon port $FIXED_DAEMON_PORT is in use; stop the conflicting listener first"
    fi
    rm_generation_dir "$cli_gen_dir" 2>/dev/null || :
    rm -rf "$stage_root" "$extract_dir" 2>/dev/null || :
    runtime_error "cannot start while a managed port is occupied"
  fi

  # ---- transaction journal (fresh) ----
  jrnl_reset
  JRNL_KIND=fresh
  JRNL_MODE=local
  JRNL_KEEP_CLI=1
  JRNL_STAGE=$stage_root
  JRNL_NEW_CLI=$cli_gen_dir
  JRNL_NEW_RUNTIME=
  jrnl_persist prepared

  # Fresh installs have no prior service to stop, but retain the explicit
  # lifecycle phase so recovery observes the same ordered transaction.
  jrnl_persist old_stopped

  # runtime_switched: move the runtime generation into place under its version
  runtime_versions=$ZM_RUNTIME_VERSIONS
  mkdir -p "$runtime_versions/$ZM_MF_VERSION/generations"
  rt_gen=$(new_generation_dir "$runtime_versions/$ZM_MF_VERSION/generations")
  rt_dir=$runtime_versions/$ZM_MF_VERSION/generations/$rt_gen
  mv "$extract_dir" "$rt_dir"
  rt_parent=${ZM_RUNTIME_CURRENT%/*}
  mkdir -p "$rt_parent"
  replace_link "$rt_dir" "$rt_parent" current || internal_error "cannot link runtime/current"
  # stage markers on the runtime root tree
  mark_root_tree "$rt_dir" "$ZM_DATA_ROOT"
  JRNL_NEW_RUNTIME=$rt_dir
  jrnl_persist runtime_switched

  # cli_switched: mark + point cli/current and the launcher
  mark_root_tree "$cli_gen_dir" "$ZM_DATA_ROOT"
  cli_parent=${ZM_CLI_CURRENT%/*}
  mkdir -p "$cli_parent"
  replace_link "$cli_gen_dir" "$cli_parent" current || internal_error "cannot link cli/current"
  mkdir -p "$ZM_BIN_DIR"
  replace_link "$ZM_CLI_CURRENT/zosma" "$ZM_BIN_DIR" zosma || internal_error "cannot link launcher"
  jrnl_persist cli_switched

  # config_switched: write final config/secrets/service
  config_write_local
  install_activate_service
  jrnl_persist config_switched

  # candidate_started: start + health unless --no-start
  if [ "$opt_no_start" -eq 1 ]; then
    out "Installed $ZM_MF_VERSION (stopped)."
  else
    if install_start_runtime; then
      jrnl_persist candidate_started
      out "Installed $ZM_MF_VERSION and healthy."
    else
      runtime_error "installation did not become healthy"
    fi
  fi

  # committed
  chmod_install_roots
  jrnl_persist committed
  jrnl_remove
  rm -rf "$stage_root"
  install_cleanup_tmp

  # PATH advice without editing profiles.
  case ":$PATH:" in
    *":$ZM_BIN_DIR:"*) : ;;
    *) out "Add $ZM_BIN_DIR to your PATH, or run 'export PATH=\$PATH:$ZM_BIN_DIR'." ;;
  esac
  if [ "$opt_no_start" -eq 1 ] && [ "$CFG_SERVICE_MANAGER" = "none" ]; then
    out "Start Cowork with 'zosma serve'."
  fi
}

