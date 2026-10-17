cmd_install() {
  parse_install_options "$@"
  validate_install_request
  recover_transaction
  resolve_roots
  if [ -f "$ZM_CONFIG_ROOT/config" ]; then
    parse_config_files "$ZM_CONFIG_ROOT/config" "$ZM_CONFIG_ROOT/secrets"
    if [ "$CFG_MODE" != "$MODE" ]; then
      usage_error "an installation already exists in $CFG_MODE mode; uninstall it without --purge-data before switching modes"
    fi
    [ "$opt_dry_run" -eq 1 ] && { print_install_plan; return 0; }
    [ "$opt_no_start" -eq 0 ] || usage_error "same-mode reinstall uses update semantics and cannot use --no-start"
    opt_yes=1
    case "$MODE" in
      local) update_local; return 0 ;;
      docker) docker_update_existing; return 0 ;;
    esac
  fi
  if [ "$opt_dry_run" -eq 1 ]; then
    print_install_plan
    return 0
  fi
  case "$MODE" in
    local) install_fresh_local ;;
    docker) install_fresh_docker ;;
  esac
}
proc_done() {
  # 0 when $1 has exited (reaped or zombie).
  st=$(ps -p "$1" -o stat= 2>/dev/null) || return 0
  if [ -z "$st" ]; then return 0; fi
  case "$st" in
    Z*|X*) return 0 ;;
  esac
  return 1
}

serve_help() {
  cat <<'HELP'
usage: zosma serve [--service]

Runs the local Cowork server in the foreground under the bundled runtime.
--service suppresses interactive/browser behavior (used by generated units).
HELP
}

cmd_serve() {
  service_mode=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --service) service_mode=1 ;;
      -h|--help) serve_help; return 0 ;;
      *) usage_error "unknown serve option: $1" ;;
    esac
    shift
  done
  resolve_roots
  parse_config_files "$ZM_CONFIG_ROOT/config" "$ZM_CONFIG_ROOT/secrets"
  if [ "$CFG_MODE" != "local" ]; then
    usage_error "serve is local-mode only; docker installations use 'zosma start'"
  fi
  runtime_dir=$ZM_RUNTIME_CURRENT
  node_bin=$runtime_dir/runtime/bin/node
  supervisor=$runtime_dir/supervisor/run-server.mjs
  if [ ! -f "$node_bin" ] || [ ! -f "$supervisor" ]; then
    runtime_error "local runtime is not installed"
  fi
  # Exact documented runtime environment; secrets environment-only.
  export PORT="$CFG_PORT"
  export PI_WEB_HOSTNAME="$CFG_BIND"
  export PI_WEB_ALLOWED_HOSTS="$CFG_ALLOWED_HOST"
  export PI_WEB_PASSWORD="$SEC_WEB_PASSWORD"
  export PI_CODING_AGENT_DIR="$CFG_PI_DIR"
  export PI_WEB_NO_OPEN=1
  export ZOSMA_DAEMON_DATA_DIR="$ZM_STATE_ROOT/daemon"
  export ZOSMA_DAEMON_PORT="$FIXED_DAEMON_PORT"
  export ZOSMA_DAEMON_TOKEN="$SEC_DAEMON_TOKEN"
  [ "$service_mode" -eq 1 ] && export PI_WEB_NO_OPEN=1

  "$node_bin" "$supervisor" &
  sup_pid=$!
  death=
  trap 'death=TERM' INT TERM
  status=0
  while :; do
    if [ -n "$death" ]; then
      # Forward a catchable TERM, wait (default 9s) for the supervisor's own
      # 7s child cleanup, then SIGKILL and observe for 2 more seconds.
      kill -s TERM "$sup_pid" 2>/dev/null || :
      grace=${ZOSMA_SERVE_ESCALATE:-9}
      n=0
      while ! proc_done "$sup_pid"; do
        n=$((n + 1))
        if [ "$n" -ge "$grace" ]; then
          kill -s KILL "$sup_pid" 2>/dev/null || :
          break
        fi
        sleep 1
      done
      wait "$sup_pid" 2>/dev/null || :
      exit 0
    fi
    if proc_done "$sup_pid"; then
      wait "$sup_pid" 2>/dev/null || status=$?
      break
    fi
    sleep 1
  done
  death=
  if [ "$status" -ne 0 ]; then
    exit "$EXIT_RUNTIME"
  fi
  exit 0
}
load_lifecycle_config() {
  resolve_roots
  [ -f "$ZM_CONFIG_ROOT/config" ] || runtime_error "zosma is not installed"
  [ -f "$ZM_CONFIG_ROOT/secrets" ] || runtime_error "installed secrets are missing"
  parse_config_files "$ZM_CONFIG_ROOT/config" "$ZM_CONFIG_ROOT/secrets"
}

manager_available() {
  case "$CFG_SERVICE_MANAGER" in
    none) return 0 ;;
    systemd) systemctl --user show-environment >/dev/null 2>&1 ;;
    launchd) launchctl print "gui/$(id -u)" >/dev/null 2>&1 ;;
    *) return 1 ;;
  esac
}

require_manager() {
  manager_available || runtime_error "recorded service manager is unavailable"
}

health_installed() {
  health_web_ok "$CFG_PORT" "$SEC_WEB_PASSWORD" "$CFG_ALLOWED_HOST"
}

lifecycle_no_args() {
  lifecycle_command=$1
  shift
  [ "$#" -eq 0 ] || usage_error "$lifecycle_command does not accept options"
}

cmd_start() {
  lifecycle_no_args start "$@"
  load_lifecycle_config
  if [ "$CFG_MODE" = "docker" ]; then
    docker_prerequisites
    docker_compose up -d || runtime_error "failed to start Docker Cowork"
    health_installed || runtime_error "Docker Cowork is not healthy after start"
    out "Cowork started."
    return 0
  fi
  case "$CFG_SERVICE_MANAGER" in
    none) usage_error "foreground mode is not managed; run 'zosma serve' and stop it with Ctrl-C" ;;
    systemd)
      require_manager
      systemctl --user start "$SYSTEMD_UNIT_BASENAME" || runtime_error "failed to start Cowork"
      health_installed || runtime_error "Cowork is not healthy after start"
      ;;
    launchd)
      require_manager
      launchctl kickstart -k "gui/$(id -u)/$LAUNCH_AGENT_LABEL" || runtime_error "failed to start Cowork"
      health_installed || runtime_error "Cowork is not healthy after start"
      ;;
  esac
  out "Cowork started."
}

cmd_stop() {
  lifecycle_no_args stop "$@"
  load_lifecycle_config
  if [ "$CFG_MODE" = "docker" ]; then
    docker_prerequisites
    docker_compose down || runtime_error "failed to stop Docker Cowork"
    out "Cowork stopped."
    return 0
  fi
  case "$CFG_SERVICE_MANAGER" in
    none) usage_error "foreground mode is not managed; press Ctrl-C in the 'zosma serve' terminal" ;;
    systemd) require_manager; systemctl --user stop "$SYSTEMD_UNIT_BASENAME" || runtime_error "failed to stop Cowork" ;;
    launchd) require_manager; launchctl bootout "gui/$(id -u)/$LAUNCH_AGENT_LABEL" 2>/dev/null || : ;;
  esac
  out "Cowork stopped."
}

cmd_restart() {
  lifecycle_no_args restart "$@"
  load_lifecycle_config
  if [ "$CFG_MODE" = "docker" ]; then
    docker_prerequisites
    docker_compose up -d || runtime_error "failed to restart Docker Cowork"
    health_installed || runtime_error "Docker Cowork is not healthy after restart"
    out "Cowork restarted."
    return 0
  fi
  case "$CFG_SERVICE_MANAGER" in
    none) usage_error "foreground mode is not managed; press Ctrl-C in the 'zosma serve' terminal" ;;
    systemd)
      require_manager
      systemctl --user restart "$SYSTEMD_UNIT_BASENAME" || runtime_error "failed to restart Cowork"
      health_installed || runtime_error "Cowork is not healthy after restart"
      ;;
    launchd)
      require_manager
      launchctl kickstart -k "gui/$(id -u)/$LAUNCH_AGENT_LABEL" || runtime_error "failed to restart Cowork"
      health_installed || runtime_error "Cowork is not healthy after restart"
      ;;
  esac
  out "Cowork restarted."
}

cmd_status() {
  lifecycle_no_args status "$@"
  load_lifecycle_config
  if [ "$CFG_MODE" = "docker" ]; then
    docker_prerequisites
    out "Service: Docker Compose"
    out "zosma-cowork $CFG_VERSION (docker)"
    out "Web: http://$CFG_BIND:$CFG_PORT"
    health_installed || runtime_error "Docker Cowork is stopped or unhealthy"
    out "Health: healthy"
    return 0
  fi
  case "$CFG_SERVICE_MANAGER" in
    none) out "Service: foreground (run 'zosma serve')" ;;
    *) require_manager; out "Service: $CFG_SERVICE_MANAGER" ;;
  esac
  out "zosma-cowork $CFG_VERSION ($CFG_MODE)"
  out "Web: http://$CFG_BIND:$CFG_PORT"
  health_installed || runtime_error "Cowork is stopped or unhealthy"
  out "Health: healthy"
}

cmd_logs() {
  case "$#" in 0) ;; 1) [ "${1:-}" = "--follow" ] || usage_error "unknown logs option: $1" ;; *) usage_error "logs accepts only --follow" ;; esac
  load_lifecycle_config
  if [ "$CFG_MODE" = "docker" ]; then
    docker_prerequisites
    if [ "${1:-}" = "--follow" ]; then docker_compose logs --follow; else docker_compose logs; fi
    return 0
  fi
  if [ "$CFG_SERVICE_MANAGER" = "none" ]; then
    out "Foreground mode logs are in the terminal running 'zosma serve'."
    return 0
  fi
  log_path="$ZM_STATE_ROOT/logs/cowork.log"
  if [ "${1:-}" = "--follow" ]; then
    if [ -f "$log_path" ]; then
      tail -f "$log_path"
    else
      runtime_error "Cowork log is not available"
    fi
  else
    if [ -f "$log_path" ]; then
      cat "$log_path"
    else
      out "No Cowork log has been written yet."
    fi
  fi
}

cmd_open() {
  lifecycle_no_args open "$@"
  load_lifecycle_config
  health_installed || runtime_error "Cowork is stopped or unhealthy"
  url="http://$CFG_BIND:$CFG_PORT"
  case "$(uname -s 2>/dev/null)" in
    Darwin) open "$url" || runtime_error "cannot open browser" ;;
    *) xdg-open "$url" >/dev/null 2>&1 || runtime_error "cannot open browser" ;;
  esac
}

cmd_doctor() {
  lifecycle_no_args doctor "$@"
  load_lifecycle_config
  out "Mode: $CFG_MODE"
  out "Version: $CFG_VERSION"
  out "Config: valid"
  if [ "$CFG_MODE" = "docker" ]; then
    docker_prerequisites
    out "Service manager: Docker Compose"
    health_installed || runtime_error "application health check failed"
    out "Health: healthy"
    return 0
  fi
  if [ "$CFG_SERVICE_MANAGER" != "none" ]; then
    require_manager
    out "Service manager: available ($CFG_SERVICE_MANAGER)"
  else
    out "Service manager: foreground (zosma serve)"
  fi
  health_installed || runtime_error "application health check failed"
  out "Health: healthy"
}

cmd_access() {
  show=0
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --show-password) show=1 ;;
      -h|--help) out "usage: zosma access [--show-password]"; return 0 ;;
      *) usage_error "unknown access option: $1" ;;
    esac
    shift
  done
  load_lifecycle_config
  out "URL: http://$CFG_BIND:$CFG_PORT"
  if [ "$CFG_BIND" = "0.0.0.0" ]; then
    out "Username: pi"
    if [ "$show" -eq 1 ]; then
      tty_available || usage_error "--show-password requires a terminal"
      tty_line "Show the Cowork password on this terminal? [y/N] "
      tty_read || cancel_error "password display cancelled"
      case "$TTY_LINE" in
        y|Y|yes|YES) tty_line "Password: $SEC_WEB_PASSWORD" ;;
        *) cancel_error "password display cancelled" ;;
      esac
    fi
  elif [ "$show" -eq 1 ]; then
    out "Loopback mode has no configured password."
  fi
}
