recover_transaction() {
  resolve_roots
  [ -e "$ZM_TRANSACTION_JOURNAL" ] || return 0
  [ -f "$ZM_TRANSACTION_JOURNAL" ] || {
    err "error: transaction state is not a regular file; refusing to continue"
    exit "$EXIT_USAGE"
  }
  jrnl_read || return $?
  if [ "$JRNL_PHASE" = "committed" ]; then
    jrnl_remove
    if [ -n "$JRNL_STAGE" ]; then rm -rf "$JRNL_STAGE"; fi
    return 0
  fi
  # Non-committed rollback: restore the prior complete state. For a fresh
  # transaction this removes runtime/config/secrets/service activation and
  # may retain only the verified CLI generation/current launcher.
  if [ -n "$JRNL_NEW_RUNTIME" ]; then
    rm_generation_dir "$JRNL_NEW_RUNTIME" || exit "$EXIT_USAGE"
    prune_runtime_empty
  fi
  rm -f "$ZM_CONFIG_ROOT/config" "$ZM_CONFIG_ROOT/secrets"
  rm -f "$ZM_SYSTEMD_UNIT" "$ZM_LAUNCH_AGENT"
  if [ "$JRNL_KEEP_CLI" != "1" ] && [ -n "$JRNL_NEW_CLI" ]; then
    rm_generation_dir "$JRNL_NEW_CLI" || exit "$EXIT_USAGE"
  fi
  if [ -n "$JRNL_STAGE" ]; then
    if within_root "$JRNL_STAGE" "$ZM_TRANSACTION_ROOT"; then
      rm -rf "$JRNL_STAGE"
    else
      err "error: refusing to remove unexpected stage root: $JRNL_STAGE"
      exit "$EXIT_USAGE"
    fi
  fi
  jrnl_remove
  err "error: the previous installation attempt was incomplete; it was rolled back"
}

docker_prerequisites() {
  docker version >/dev/null 2>&1 || prereq_error "Docker Engine is unavailable"
  docker compose version >/dev/null 2>&1 || prereq_error "Docker Compose v2 is unavailable"
}

docker_verify_image() {
  valid_digest_ref "$ZM_MF_DOCKER_IMAGE" || verify_error "manifest does not contain an accepted Docker digest"
  docker pull "$ZM_MF_DOCKER_IMAGE" >/dev/null 2>&1 || runtime_error "failed to pull the pinned Docker image"
  inspected=$(docker image inspect "$ZM_MF_DOCKER_IMAGE" --format '{{.RepoDigests}}' 2>/dev/null) || verify_error "cannot inspect the pulled Docker image"
  case " $inspected " in
    *" $ZM_MF_DOCKER_IMAGE "*) : ;;
    *) verify_error "Docker RepoDigests did not contain the pinned image" ;;
  esac
}

docker_compose() {
  compose_file=$ZM_DOCKER_ROOT/compose.yml
  [ -f "$compose_file" ] || runtime_error "generated Docker Compose file is missing"
  compose_uid=${DOCKER_UID:-$(id -u 2>/dev/null || printf '1000')}
  compose_gid=${DOCKER_GID:-$(id -g 2>/dev/null || printf '1000')}
  ZOSMA_IMAGE="$CFG_IMAGE" \
  ZOSMA_UID="$compose_uid" \
  ZOSMA_GID="$compose_gid" \
  ZOSMA_PORT="$CFG_PORT" \
  ZOSMA_BIND_ADDRESS="$CFG_BIND" \
  ZOSMA_WORKSPACE="$CFG_WORKSPACE" \
  ZOSMA_PI_STATE="$ZM_DOCKER_PI_STATE" \
  PI_WEB_PASSWORD="$SEC_WEB_PASSWORD" \
  PI_WEB_ALLOWED_HOSTS="$CFG_ALLOWED_HOST" \
  ZOSMA_DAEMON_TOKEN="$SEC_DAEMON_TOKEN" \
  docker compose -p "$COMPOSE_PROJECT" -f "$compose_file" "$@"
}

install_fresh_docker() {
  resolve_roots
  assert_existing_roots || exit "$EXIT_INTERNAL"
  if [ -e "$ZM_DOCKER_PI_STATE" ] || [ -L "$ZM_DOCKER_PI_STATE" ]; then
    if [ ! -d "$ZM_DOCKER_PI_STATE" ] || ! is_marked_dir "$ZM_DOCKER_PI_STATE"; then
      internal_error "refusing unmarked Docker Pi state"
    fi
    JRNL_DOCKER_PREEXISTED=1
  fi
  install_resolve_manifest || return "$?"
  docker_prerequisites
  docker_verify_image
  DOCKER_UID=$(id -u 2>/dev/null) || DOCKER_UID=1000
  DOCKER_GID=$(id -g 2>/dev/null) || DOCKER_GID=1000
  SEC_WEB_PASSWORD=
  [ "$INSTALL_BIND" = "0.0.0.0" ] && SEC_WEB_PASSWORD=$(gen_hex 32)
  SEC_DAEMON_TOKEN=$(gen_hex 64)
  stage_root=$ZM_TRANSACTION_ROOT
  mkdir -p "$stage_root"
  cli_versions=$ZM_CLI_VERSIONS
  mkdir -p "$cli_versions/$ZM_MF_VERSION/generations"
  cli_gen=$(new_generation_dir "$cli_versions/$ZM_MF_VERSION/generations")
  cli_gen_dir=$cli_versions/$ZM_MF_VERSION/generations/$cli_gen
  mkdir -p "$cli_gen_dir"
  cp "$0" "$cli_gen_dir/zosma"
  chmod 755 "$cli_gen_dir/zosma"
  jrnl_reset
  JRNL_KIND=fresh
  JRNL_MODE=docker
  JRNL_KEEP_CLI=1
  JRNL_STAGE=$stage_root
  JRNL_NEW_CLI=$cli_gen_dir
  jrnl_persist prepared
  mark_root_tree "$cli_gen_dir" "$ZM_DATA_ROOT"
  cli_parent=${ZM_CLI_CURRENT%/*}
  mkdir -p "$cli_parent"
  replace_link "$cli_gen_dir" "$cli_parent" current || internal_error "cannot link cli/current"
  mkdir -p "$ZM_BIN_DIR"
  replace_link "$ZM_CLI_CURRENT/zosma" "$ZM_BIN_DIR" zosma || internal_error "cannot link launcher"
  jrnl_persist cli_switched
  config_write_docker
  CFG_IMAGE=$ZM_MF_DOCKER_IMAGE
  CFG_MODE=docker
  CFG_WORKSPACE=$opt_workspace
  CFG_BIND=$INSTALL_BIND
  CFG_PORT=$INSTALL_PORT
  CFG_ALLOWED_HOST=${opt_hostname:-127.0.0.1}
  CFG_SERVICE_MANAGER=none
  jrnl_persist config_switched
  if [ "$opt_no_start" -eq 1 ]; then
    out "Installed Docker image $ZM_MF_DOCKER_IMAGE (stopped)."
  else
    docker_compose up -d || runtime_error "failed to start Docker Cowork"
    health_installed || runtime_error "Docker Cowork did not become healthy"
    jrnl_persist candidate_started
    out "Installed Docker image $ZM_MF_DOCKER_IMAGE and healthy."
  fi
  chmod_install_roots
  jrnl_persist committed
  jrnl_remove
  rm -rf "$stage_root"
  install_cleanup_tmp
}

docker_update_existing() {
  install_resolve_manifest || return "$?"
  docker_prerequisites
  docker_verify_image
  CFG_IMAGE=$ZM_MF_DOCKER_IMAGE
  docker_compose down || runtime_error "failed to stop the previous Docker Cowork"
  docker_compose up -d || runtime_error "failed to start the updated Docker Cowork"
  health_installed || runtime_error "updated Docker Cowork did not become healthy"
  out "Updated Docker image $CFG_IMAGE."
}

