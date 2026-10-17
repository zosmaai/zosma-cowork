# ---------------------------------------------------------------------------
# Path resolution (pure: no filesystem side effect)
# ---------------------------------------------------------------------------

resolve_xdg_base() {
  # $1 = destination tag (data|config|state|cache), $2 = XDG env name,
  # $3 = fallback under HOME. Values are validated and assigned to fixed
  # globals only; no user-controlled shell evaluation happens.
  eval "xdg_value=\${$2:-}"
  if [ -z "$xdg_value" ]; then
    xdg_resolved=$HOME/$3
  elif is_absolute "$xdg_value"; then
    xdg_resolved=$xdg_value
  else
    warn "ignoring relative $2=$xdg_value; using the fallback under \$HOME"
    xdg_resolved=$HOME/$3
  fi
  case "$1" in
    data) ZM_XDG_DATA=$xdg_resolved ;;
    config) ZM_XDG_CONFIG=$xdg_resolved ;;
    state) ZM_XDG_STATE=$xdg_resolved ;;
    cache) ZM_XDG_CACHE=$xdg_resolved ;;
    *) internal_error "internal: bad XDG tag: $1" ;;
  esac
}

resolve_roots() {
  # Computed roots become command-global state.
# shellcheck disable=SC2034
  case "${HOME:-}" in
    '') err "error: HOME is not set"; exit "$EXIT_USAGE" ;;
  esac
  case "$HOME" in
    /*) : ;;
    *) err "error: HOME must be an absolute path: $HOME"; exit "$EXIT_USAGE" ;;
  esac
  if has_nonprintable "$HOME"; then
    err "error: HOME contains non-printable characters"; exit "$EXIT_USAGE"
  fi
  ZM_HOME=$HOME
  resolve_xdg_base data XDG_DATA_HOME .local/share
  resolve_xdg_base config XDG_CONFIG_HOME .config
  resolve_xdg_base state XDG_STATE_HOME .local/state
  resolve_xdg_base cache XDG_CACHE_HOME .cache
  ZM_BIN_DIR=$ZM_HOME/.local/bin
  ZM_DATA_ROOT=$ZM_XDG_DATA/zosma-cowork
  ZM_CONFIG_ROOT=$ZM_XDG_CONFIG/zosma-cowork
  ZM_STATE_ROOT=$ZM_XDG_STATE/zosma-cowork
  ZM_CACHE_ROOT=$ZM_XDG_CACHE/zosma-cowork
  ZM_TRANSACTION_ROOT=$ZM_STATE_ROOT/transaction
  ZM_TRANSACTION_JOURNAL=$ZM_TRANSACTION_ROOT/journal
  ZM_CLI_VERSIONS=$ZM_DATA_ROOT/cli/versions
  ZM_CLI_CURRENT=$ZM_DATA_ROOT/cli/current
  ZM_RUNTIME_VERSIONS=$ZM_DATA_ROOT/runtime/versions
  ZM_RUNTIME_CURRENT=$ZM_DATA_ROOT/runtime/current
  ZM_DOCKER_ROOT=$ZM_CONFIG_ROOT/docker
  ZM_DOCKER_PI_STATE=$ZM_DATA_ROOT/docker/pi-agent
  ZM_SYSTEMD_UNIT=$ZM_XDG_CONFIG/systemd/user/$SYSTEMD_UNIT_BASENAME
  ZM_LAUNCH_AGENT=$ZM_HOME/Library/LaunchAgents/$LAUNCH_AGENT_LABEL.plist
}

# ---------------------------------------------------------------------------
# Fixed-key configuration and secrets parsers (values are data, never shell)
# ---------------------------------------------------------------------------

# Parses the installed configuration. On failure prints an error and exits 2.
parse_config_files() {
  cfg_path=$1
  sec_path=$2
  CFG_MODE=
  CFG_VERSION=
  CFG_PORT=
  CFG_BIND=
  CFG_ALLOWED_HOST=
  CFG_PI_DIR=
  CFG_WORKSPACE=
  CFG_IMAGE=
  CFG_SERVICE_MANAGER=
  cfg_seen_schema=0
  cfg_seen_mode=0
  cfg_seen_version=0
  cfg_seen_port=0
  cfg_seen_bind=0
  cfg_seen_allowed_host=0
  cfg_seen_pi_dir=0
  cfg_seen_workspace=0
  cfg_seen_image=0
  cfg_seen_service_manager=0
  cfg_unknown=0

  while IFS= read -r line; do
    case "$line" in
      '') continue ;;
      CONFIG_SCHEMA=*)
        [ "$cfg_seen_schema" -eq 0 ] || { err "error: duplicate CONFIG_SCHEMA"; exit "$EXIT_USAGE"; }
        cfg_seen_schema=1
        case "$line" in
          "CONFIG_SCHEMA=$CONFIG_SCHEMA") : ;;
          *) err "error: unsupported CONFIG_SCHEMA value"; exit "$EXIT_USAGE" ;;
        esac
        ;;
      MODE=*)
        [ "$cfg_seen_mode" -eq 0 ] || { err "error: duplicate MODE"; exit "$EXIT_USAGE"; }
        cfg_seen_mode=1
        CFG_MODE=${line#MODE=}
        case "$CFG_MODE" in local|docker) : ;;
          *) err "error: invalid MODE value"; exit "$EXIT_USAGE" ;;
        esac
        ;;
      VERSION=*)
        [ "$cfg_seen_version" -eq 0 ] || { err "error: duplicate VERSION"; exit "$EXIT_USAGE"; }
        cfg_seen_version=1
        CFG_VERSION=${line#VERSION=}
        valid_version "$CFG_VERSION" || { err "error: invalid VERSION value"; exit "$EXIT_USAGE"; }
        ;;
      PORT=*)
        [ "$cfg_seen_port" -eq 0 ] || { err "error: duplicate PORT"; exit "$EXIT_USAGE"; }
        cfg_seen_port=1
        CFG_PORT=${line#PORT=}
        valid_port "$CFG_PORT" || { err "error: invalid PORT value"; exit "$EXIT_USAGE"; }
        ;;
      BIND_ADDRESS=*)
        [ "$cfg_seen_bind" -eq 0 ] || { err "error: duplicate BIND_ADDRESS"; exit "$EXIT_USAGE"; }
        cfg_seen_bind=1
        CFG_BIND=${line#BIND_ADDRESS=}
        case "$CFG_BIND" in 127.0.0.1|0.0.0.0) : ;;
          *) err "error: invalid BIND_ADDRESS value"; exit "$EXIT_USAGE" ;;
        esac
        ;;
      ALLOWED_HOST=*)
        [ "$cfg_seen_allowed_host" -eq 0 ] || { err "error: duplicate ALLOWED_HOST"; exit "$EXIT_USAGE"; }
        cfg_seen_allowed_host=1
        CFG_ALLOWED_HOST=${line#ALLOWED_HOST=}
        valid_hostname "$CFG_ALLOWED_HOST" || { err "error: invalid ALLOWED_HOST value"; exit "$EXIT_USAGE"; }
        ;;
      PI_DIR=*)
        [ "$cfg_seen_pi_dir" -eq 0 ] || { err "error: duplicate PI_DIR"; exit "$EXIT_USAGE"; }
        cfg_seen_pi_dir=1
        CFG_PI_DIR=${line#PI_DIR=}
        is_absolute "$CFG_PI_DIR" || { err "error: PI_DIR must be absolute"; exit "$EXIT_USAGE"; }
        has_nonprintable "$CFG_PI_DIR" && { err "error: PI_DIR contains non-printable characters"; exit "$EXIT_USAGE"; }
        ;;
      WORKSPACE=*)
        [ "$cfg_seen_workspace" -eq 0 ] || { err "error: duplicate WORKSPACE"; exit "$EXIT_USAGE"; }
        cfg_seen_workspace=1
        CFG_WORKSPACE=${line#WORKSPACE=}
        valid_null_or_absolute "$CFG_WORKSPACE" || {
          err "error: WORKSPACE must be empty or an absolute path"; exit "$EXIT_USAGE";
        }
        ;;
      IMAGE=*)
        [ "$cfg_seen_image" -eq 0 ] || { err "error: duplicate IMAGE"; exit "$EXIT_USAGE"; }
        cfg_seen_image=1
        CFG_IMAGE=${line#IMAGE=}
        if [ -n "$CFG_IMAGE" ]; then
          valid_digest_ref "$CFG_IMAGE" || { err "error: invalid IMAGE digest reference"; exit "$EXIT_USAGE"; }
        fi
        ;;
      SERVICE_MANAGER=*)
        [ "$cfg_seen_service_manager" -eq 0 ] || { err "error: duplicate SERVICE_MANAGER"; exit "$EXIT_USAGE"; }
        cfg_seen_service_manager=1
        CFG_SERVICE_MANAGER=${line#SERVICE_MANAGER=}
        case "$CFG_SERVICE_MANAGER" in systemd|launchd|none) : ;;
          *) err "error: invalid SERVICE_MANAGER value"; exit "$EXIT_USAGE" ;;
        esac
        ;;
      *=*)
        warn "ignoring unknown configuration key: ${line%%=*}"
        cfg_unknown=$((cfg_unknown + 1))
        ;;
      *)
        err "error: malformed configuration line"; exit "$EXIT_USAGE"
        ;;
    esac
  done < "$cfg_path"

  for key in schema mode version port bind allowed_host pi_dir workspace image service_manager; do
    eval seen=\$cfg_seen_$key
    [ "$seen" -eq 1 ] || { err "error: missing required configuration key: $key"; exit "$EXIT_USAGE"; }
  done

  # Secrets: unknown keys are rejected; values are never printed.
  SEC_DAEMON_TOKEN=
  SEC_WEB_PASSWORD=
  sec_seen_token=0
  sec_seen_web_password=0
  while IFS= read -r line; do
    case "$line" in
      '') continue ;;
      DAEMON_TOKEN=*)
        [ "$sec_seen_token" -eq 0 ] || { err "error: duplicate DAEMON_TOKEN"; exit "$EXIT_USAGE"; }
        sec_seen_token=1
        SEC_DAEMON_TOKEN=${line#DAEMON_TOKEN=}
        valid_hex "$SEC_DAEMON_TOKEN" || { err "error: invalid DAEMON_TOKEN"; exit "$EXIT_USAGE"; }
        [ "${#SEC_DAEMON_TOKEN}" -eq 64 ] || { err "error: invalid DAEMON_TOKEN length"; exit "$EXIT_USAGE"; }
        ;;
      WEB_PASSWORD=*)
        [ "$sec_seen_web_password" -eq 0 ] || { err "error: duplicate WEB_PASSWORD"; exit "$EXIT_USAGE"; }
        sec_seen_web_password=1
        SEC_WEB_PASSWORD=${line#WEB_PASSWORD=}
        if [ -n "$SEC_WEB_PASSWORD" ]; then
          valid_hex "$SEC_WEB_PASSWORD" || { err "error: invalid WEB_PASSWORD"; exit "$EXIT_USAGE"; }
          [ "${#SEC_WEB_PASSWORD}" -le 64 ] || { err "error: invalid WEB_PASSWORD length"; exit "$EXIT_USAGE"; }
        fi
        ;;
      *=*)
        err "error: unknown secrets entry: ${line%%=*}"
        exit "$EXIT_USAGE"
        ;;
      *)
        err "error: malformed secrets line"; exit "$EXIT_USAGE"
        ;;
    esac
  done < "$sec_path"
  [ "$sec_seen_token" -eq 1 ] || { err "error: missing DAEMON_TOKEN"; exit "$EXIT_USAGE"; }
  [ "$sec_seen_web_password" -eq 1 ] || { err "error: missing WEB_PASSWORD"; exit "$EXIT_USAGE"; }

  # Cross-field invariants that are purely structural.
  if [ "$CFG_MODE" = "local" ]; then
    [ -z "$CFG_WORKSPACE" ] || { err "error: WORKSPACE must be empty in local mode"; exit "$EXIT_USAGE"; }
    [ -z "$CFG_IMAGE" ] || { err "error: IMAGE must be empty in local mode"; exit "$EXIT_USAGE"; }
  else
    [ -n "$CFG_WORKSPACE" ] || { err "error: WORKSPACE is required in docker mode"; exit "$EXIT_USAGE"; }
    valid_digest_ref "$CFG_IMAGE" || { err "error: IMAGE digest is required in docker mode"; exit "$EXIT_USAGE"; }
  fi
  case "$CFG_BIND" in
    127.0.0.1)
      [ "$CFG_ALLOWED_HOST" = "127.0.0.1" ] || {
        err "error: loopback binding requires ALLOWED_HOST=127.0.0.1"; exit "$EXIT_USAGE";
      }
      [ -z "$SEC_WEB_PASSWORD" ] || {
        err "error: loopback binding requires an empty web password"; exit "$EXIT_USAGE";
      }
      ;;
    0.0.0.0)
      [ "$CFG_ALLOWED_HOST" = "127.0.0.1" ] && {
        err "error: LAN binding requires an allowed hostname"; exit "$EXIT_USAGE";
      }
      [ -n "$SEC_WEB_PASSWORD" ] || {
        err "error: LAN binding requires a generated web password"; exit "$EXIT_USAGE";
      }
      ;;
  esac
}

