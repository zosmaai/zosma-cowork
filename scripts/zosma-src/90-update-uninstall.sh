parse_update_options() {
  opt_version=
  opt_yes=0
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --version)
        shift
        [ "$#" -gt 0 ] || usage_error "--version requires a value"
        valid_version "$1" || usage_error "invalid update version: $1"
        opt_version=$1
        ;;
      --yes) opt_yes=1 ;;
      --no-start) usage_error "update always validates and starts the candidate; --no-start is install-only" ;;
      -h|--help) out "usage: zosma update [--version VERSION] [--yes]"; return 0 ;;
      *) usage_error "unknown update option: $1" ;;
    esac
    shift
  done
}

update_local() {
  load_lifecycle_config
  [ "$CFG_MODE" = "local" ] || usage_error "update mode must match the installed local mode"
  resolve_roots
  sha_tool_detect
  probe_os_arch
  probe_wsl
  probe_macos_version
  install_resolve_manifest || return "$?"
  [ "$ZM_MF_VERSION" = "$CFG_VERSION" ] || usage_error "candidate version changes require the staged update workflow"
  INSTALL_PORT=$CFG_PORT
  INSTALL_BIND=$CFG_BIND
  INSTALL_ALLOWED_HOST=$CFG_ALLOWED_HOST
  stage_root=$ZM_TRANSACTION_ROOT/update-stage
  mkdir -p "$stage_root"
  case "$PLATFORM_OS-$PLATFORM_ARCH" in
    linux-x64) arch_url=$ZM_MF_ARCH_LINUX_X64_URL ;;
    linux-arm64) arch_url=$ZM_MF_ARCH_LINUX_ARM64_URL ;;
    darwin-x64) arch_url=$ZM_MF_ARCH_DARWIN_X64_URL ;;
    darwin-arm64) arch_url=$ZM_MF_ARCH_DARWIN_ARM64_URL ;;
    *) verify_error "unsupported platform tuple" ;;
  esac
  sums_tmp=$stage_root/SHA256SUMS
  archive_tmp=$stage_root/$(archive_basename)
  cli_tmp=$stage_root/candidate-cli
  cli_curl_download "$ZM_MF_SUMS_URL" "$sums_tmp" || verify_error "failed to download update checksums"
  cli_curl_download "$arch_url" "$archive_tmp" || verify_error "failed to download update archive"
  ZFIX_ARCHIVE_SUMS=$sums_tmp
  verify_archive "$archive_tmp"
  validate_archive_members "$archive_tmp"
  extract_dir=$(mktemp -d "$stage_root/.extract.XXXXXX") || internal_error "cannot stage update archive"
  tar -xzf "$archive_tmp" -C "$extract_dir" || verify_error "failed to extract update archive"
  validate_runtime_tree "$extract_dir"
  cli_curl_download "$ZM_MF_CLI_URL" "$cli_tmp" || verify_error "failed to download update CLI"
  actual_cli=$(sha256_of "$cli_tmp")
  [ "$actual_cli" = "$ZM_MF_CLI_SHA256" ] || verify_error "update CLI checksum mismatch"
  sh -n "$cli_tmp" || verify_error "candidate CLI syntax is invalid"

  old_cli=$(readlink "$ZM_CLI_CURRENT" 2>/dev/null || true)
  old_runtime=$(readlink "$ZM_RUNTIME_CURRENT" 2>/dev/null || true)
  case "$old_cli" in /*) : ;; *) old_cli=$ZM_DATA_ROOT/cli/$old_cli ;; esac
  case "$old_runtime" in /*) : ;; *) old_runtime=$ZM_DATA_ROOT/runtime/$old_runtime ;; esac
  jrnl_reset
  JRNL_KIND=update
  JRNL_MODE=local
  JRNL_KEEP_CLI=0
  JRNL_OLD_CLI=$old_cli
  JRNL_OLD_RUNTIME=$old_runtime
  JRNL_STAGE=$stage_root
  cp "$ZM_CONFIG_ROOT/config" "$stage_root/config.backup"
  JRNL_OLD_CONFIG_BACKUP=$stage_root/config.backup
  jrnl_persist prepared

  runtime_versions=$ZM_RUNTIME_VERSIONS
  mkdir -p "$runtime_versions/$ZM_MF_VERSION/generations"
  rt_gen=$(new_generation_dir "$runtime_versions/$ZM_MF_VERSION/generations")
  rt_dir=$runtime_versions/$ZM_MF_VERSION/generations/$rt_gen
  mv "$extract_dir" "$rt_dir"
  mark_root_tree "$rt_dir" "$ZM_DATA_ROOT"
  replace_link "$rt_dir" "${ZM_RUNTIME_CURRENT%/*}" current || runtime_error "cannot activate update runtime"
  JRNL_NEW_RUNTIME=$rt_dir
  jrnl_persist runtime_switched

  cli_versions=$ZM_CLI_VERSIONS
  mkdir -p "$cli_versions/$ZM_MF_VERSION/generations"
  cli_gen=$(new_generation_dir "$cli_versions/$ZM_MF_VERSION/generations")
  cli_gen_dir=$cli_versions/$ZM_MF_VERSION/generations/$cli_gen
  mkdir -p "$cli_gen_dir"
  cp "$cli_tmp" "$cli_gen_dir/zosma"
  chmod 755 "$cli_gen_dir/zosma"
  mark_root_tree "$cli_gen_dir" "$ZM_DATA_ROOT"
  replace_link "$cli_gen_dir" "${ZM_CLI_CURRENT%/*}" current || runtime_error "cannot activate update CLI"
  JRNL_NEW_CLI=$cli_gen_dir
  jrnl_persist cli_switched

  ZM_MF_VERSION=$CFG_VERSION
  config_write_local
  install_activate_service
  jrnl_persist config_switched
  if [ "$CFG_SERVICE_MANAGER" = "none" ]; then
    health_installed || runtime_error "updated Cowork did not become healthy"
  else
    install_start_runtime || runtime_error "updated Cowork did not become healthy"
  fi
  jrnl_persist candidate_started
  chmod_install_roots
  jrnl_persist committed
  jrnl_remove
  rm -rf "$stage_root"
  out "Updated Cowork to $CFG_VERSION."
}

cmd_update() {
  parse_update_options "$@"
  [ "$opt_yes" -eq 1 ] || usage_error "update requires --yes when no terminal confirmation is available"
  recover_transaction
  update_local
}
parse_uninstall_options() {
  uninstall_yes=0
  uninstall_purge=0
  uninstall_dry=0
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --yes) uninstall_yes=1 ;;
      --purge-data) uninstall_purge=1 ;;
      --dry-run) uninstall_dry=1 ;;
      -h|--help) out "usage: zosma uninstall [--yes] [--purge-data] [--dry-run]"; return 0 ;;
      *) usage_error "unknown uninstall option: $1" ;;
    esac
    shift
  done
}

uninstall_cli_tree() {
  cli_parent=${ZM_CLI_CURRENT%/*}
  if [ -L "$ZM_CLI_CURRENT" ]; then
    target=$(readlink "$ZM_CLI_CURRENT") || runtime_error "cannot inspect cli/current"
    case "$target" in
      /*) case "$target" in "$ZM_CLI_VERSIONS"/*/generations/generation-*) : ;; *) runtime_error "refusing unexpected cli/current target" ;; esac ;;
      *) runtime_error "refusing relative cli/current target" ;;
    esac
    rm -f "$ZM_CLI_CURRENT"
  elif [ -e "$ZM_CLI_CURRENT" ]; then
    runtime_error "refusing unexpected cli/current artifact"
  fi
  if [ -L "$ZM_BIN_DIR/zosma" ]; then
    launcher_target=$(readlink "$ZM_BIN_DIR/zosma") || runtime_error "cannot inspect launcher"
    case "$launcher_target" in
      "$ZM_CLI_CURRENT/zosma"|"$ZM_CLI_VERSIONS"/*/generations/generation-*/zosma) rm -f "$ZM_BIN_DIR/zosma" ;;
      *) runtime_error "refusing unexpected launcher target" ;;
    esac
  elif [ -e "$ZM_BIN_DIR/zosma" ]; then
    runtime_error "refusing to remove a regular launcher"
  fi
  for version_dir in "$ZM_CLI_VERSIONS"/*; do
    [ -d "$version_dir" ] || continue
    is_marked_dir "$version_dir" || runtime_error "refusing unmarked CLI version directory"
    for generation_dir in "$version_dir"/generations/generation-*; do
      [ -d "$generation_dir" ] || continue
      is_marked_dir "$generation_dir" || runtime_error "refusing unmarked CLI generation"
      rm_generation_dir "$generation_dir"
    done
    rmdir "$version_dir/generations" 2>/dev/null || :
    rm -f "$version_dir/$MARKER_NAME"
    rmdir "$version_dir" 2>/dev/null || :
  done
  rmdir "$ZM_CLI_VERSIONS" 2>/dev/null || :
  rmdir "$cli_parent" 2>/dev/null || :
}

uninstall_runtime_tree() {
  if [ -L "$ZM_RUNTIME_CURRENT" ]; then
    runtime_target=$(readlink "$ZM_RUNTIME_CURRENT") || runtime_error "cannot inspect runtime/current"
    case "$runtime_target" in
      /*) case "$runtime_target" in "$ZM_RUNTIME_VERSIONS"/*/generations/generation-*) : ;; *) runtime_error "refusing unexpected runtime/current target" ;; esac ;;
      *) runtime_error "refusing relative runtime/current target" ;;
    esac
    rm -f "$ZM_RUNTIME_CURRENT"
  elif [ -e "$ZM_RUNTIME_CURRENT" ]; then
    runtime_error "refusing unexpected runtime/current artifact"
  fi
  for version_dir in "$ZM_RUNTIME_VERSIONS"/*; do
    [ -d "$version_dir" ] || continue
    is_marked_dir "$version_dir" || runtime_error "refusing unmarked runtime version directory"
    for generation_dir in "$version_dir"/generations/generation-*; do
      [ -d "$generation_dir" ] || continue
      is_marked_dir "$generation_dir" || runtime_error "refusing unmarked runtime generation"
      rm_generation_dir "$generation_dir"
    done
    rmdir "$version_dir/generations" 2>/dev/null || :
    rm -f "$version_dir/$MARKER_NAME"
    rmdir "$version_dir" 2>/dev/null || :
  done
  rmdir "$ZM_RUNTIME_VERSIONS" 2>/dev/null || :
  rmdir "${ZM_RUNTIME_CURRENT%/*}" 2>/dev/null || :
}

cmd_uninstall() {
  parse_uninstall_options "$@"
  resolve_roots
  if [ "$uninstall_dry" -eq 1 ]; then
    out "Uninstall allowlist (dry run):"
    out "  $ZM_CONFIG_ROOT/config"
    out "  $ZM_CONFIG_ROOT/secrets"
    out "  $ZM_CLI_VERSIONS and $ZM_RUNTIME_VERSIONS marked generations"
    out "  $ZM_BIN_DIR/zosma and expected service definitions"
    [ "$uninstall_purge" -eq 1 ] && out "  $ZM_DOCKER_PI_STATE (requires TTY confirmation)"
    return 0
  fi
  if [ "$uninstall_purge" -eq 1 ]; then
    tty_available || cancel_error "--purge-data requires an explicit terminal confirmation"
    tty_line "Purge the Docker Pi state at $ZM_DOCKER_PI_STATE? [y/N] "
    tty_read || cancel_error "purge cancelled"
    case "$TTY_LINE" in y|Y|yes|YES) : ;; *) cancel_error "purge cancelled" ;; esac
  fi
  if [ -f "$ZM_CONFIG_ROOT/config" ]; then
    parse_config_files "$ZM_CONFIG_ROOT/config" "$ZM_CONFIG_ROOT/secrets"
    case "$CFG_MODE" in
      local)
        case "$CFG_SERVICE_MANAGER" in
          systemd) require_manager; systemctl --user disable --now "$SYSTEMD_UNIT_BASENAME" 2>/dev/null || : ;;
          launchd) require_manager; launchctl bootout "gui/$(id -u)/$LAUNCH_AGENT_LABEL" 2>/dev/null || : ;;
          none) : ;;
        esac
        ;;
      docker) docker_prerequisites; docker_compose down || runtime_error "failed to stop Docker Cowork" ;;
    esac
    rm -f "$ZM_CONFIG_ROOT/config" "$ZM_CONFIG_ROOT/secrets" "$ZM_SYSTEMD_UNIT" "$ZM_LAUNCH_AGENT"
    rm -f "$ZM_DOCKER_ROOT/compose.yml"
  fi
  uninstall_cli_tree
  uninstall_runtime_tree
  if [ "$uninstall_purge" -eq 1 ] && [ -d "$ZM_DOCKER_PI_STATE" ] && is_marked_dir "$ZM_DOCKER_PI_STATE"; then
    rm -rf "$ZM_DOCKER_PI_STATE"
  fi
  out "Zosma Cowork uninstalled."
}

