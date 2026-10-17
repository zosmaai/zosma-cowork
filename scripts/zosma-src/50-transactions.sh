# ---------------------------------------------------------------------------
# Activation transaction journal
# ---------------------------------------------------------------------------

JRNL_KIND=
JRNL_MODE=
JRNL_PHASE=
JRNL_KEEP_CLI=0
JRNL_OLD_RUNNING=0
JRNL_OLD_CLI=
JRNL_NEW_CLI=
JRNL_OLD_RUNTIME=
JRNL_NEW_RUNTIME=
JRNL_OLD_CONFIG_BACKUP=
JRNL_STAGE=
JRNL_DOCKER_PREEXISTED=0
JRNL_OLD_IMAGE=
JRNL_NEW_IMAGE=

chmod_install_roots() {
  for d in "$ZM_DATA_ROOT" "$ZM_CONFIG_ROOT" "$ZM_STATE_ROOT" "$ZM_CACHE_ROOT" "$ZM_TRANSACTION_ROOT"; do
    if [ -d "$d" ]; then chmod 700 "$d"; fi
  done
}

jrnl_reset() {
  JRNL_KIND=
  JRNL_MODE=
  JRNL_PHASE=
  JRNL_KEEP_CLI=0
  JRNL_OLD_RUNNING=0
  JRNL_OLD_CLI=
  JRNL_NEW_CLI=
  JRNL_OLD_RUNTIME=
  JRNL_NEW_RUNTIME=
  JRNL_OLD_CONFIG_BACKUP=
  JRNL_STAGE=
  JRNL_DOCKER_PREEXISTED=0
  JRNL_OLD_IMAGE=
  JRNL_NEW_IMAGE=
}

jrnl_persist() {
  # $1 = phase; writes the journal atomically at TRANSACTION_JOURNAL.
  if [ ! -d "$ZM_TRANSACTION_ROOT" ]; then
    mkdir -p "$ZM_TRANSACTION_ROOT"
    chmod 700 "$ZM_TRANSACTION_ROOT"
  fi
  jtmp=$(mktemp -d "$ZM_TRANSACTION_ROOT/.journal.XXXXXX") || runtime_error "cannot create journal staging"
  {
    printf 'TRANSACTION_SCHEMA=%s\n' "$TRANSACTION_SCHEMA"
    printf 'INSTALL_KIND=%s\n' "$JRNL_KIND"
    printf 'MODE=%s\n' "$JRNL_MODE"
    printf 'PHASE=%s\n' "$1"
    printf 'KEEP_VERIFIED_CLI=%s\n' "$JRNL_KEEP_CLI"
    printf 'OLD_WAS_RUNNING=%s\n' "$JRNL_OLD_RUNNING"
    printf 'OLD_CLI_TARGET=%s\n' "$JRNL_OLD_CLI"
    printf 'NEW_CLI_TARGET=%s\n' "$JRNL_NEW_CLI"
    printf 'OLD_RUNTIME_TARGET=%s\n' "$JRNL_OLD_RUNTIME"
    printf 'NEW_RUNTIME_TARGET=%s\n' "$JRNL_NEW_RUNTIME"
    printf 'OLD_CONFIG_BACKUP=%s\n' "$JRNL_OLD_CONFIG_BACKUP"
    printf 'STAGE_ROOT=%s\n' "$JRNL_STAGE"
    printf 'DOCKER_STATE_PREEXISTED=%s\n' "$JRNL_DOCKER_PREEXISTED"
    printf 'OLD_IMAGE=%s\n' "$JRNL_OLD_IMAGE"
    printf 'NEW_IMAGE=%s\n' "$JRNL_NEW_IMAGE"
  } > "$jtmp/journal"
  chmod 600 "$jtmp/journal"
  mv -f "$jtmp/journal" "$ZM_TRANSACTION_ROOT/" 2>/dev/null || { rm -rf "$jtmp"; runtime_error "cannot persist journal"; }
  rmdir "$jtmp" 2>/dev/null || :
  # Test-only pause allows crash-recovery tests to kill at each persisted phase.
  if [ "${ZOSMA_TESTING:-0}" = "1" ] && [ -n "${ZOSMA_TEST_PHASE_DELAY:-}" ]; then
    sleep "$ZOSMA_TEST_PHASE_DELAY"
  fi
}

path_under() {
  # True when $1 is under $2 (prefix match on a path component).
  case "$1" in
    "$2"|"$2"/*) return 0 ;;
  esac
  return 1
}

is_generation_target() {
  # $1 = absolute path, $2 = cli|runtime; the path must be exactly
  # <root>/versions/<version>/generations/generation-<digits>.
  roots=$ZM_CLI_VERSIONS
  [ "$2" = "runtime" ] && roots=$ZM_RUNTIME_VERSIONS
  case "$1" in
    "$roots"/*/generations/generation-[0-9][0-9][0-9][0-9]*)
      rest=${1#"$roots/"}
      version=${rest%%/*}
      case "$version" in
        v[0-9]*.[0-9]*.[0-9]*) : ;;
        *) return 1 ;;
      esac
      gen=${rest#*/generations/}
      case "$gen" in
        generation-[0-9][0-9][0-9][0-9]*[!0-9]*) return 1 ;;
        generation-[0-9][0-9][0-9][0-9]*) return 0 ;;
        *) return 1 ;;
      esac
      ;;
    *) return 1 ;;
  esac
}

rm_generation_dir() {
  # Refuses every path that is not an exact installer generation directory.
  if is_generation_target "$1" cli; then
    rm -rf "$1"
    return 0
  fi
  if is_generation_target "$1" runtime; then
    rm -rf "$1"
    return 0
  fi
  err "error: refusing to remove unexpected path: $1"
  return 1
}

prune_runtime_empty() {
  # Removes only empty installer-owned runtime version containers and the
  # runtime/current link after a generation removal.
  if [ -n "$JRNL_NEW_RUNTIME" ]; then
    parent=${JRNL_NEW_RUNTIME%/*}
    version_dir=${JRNL_NEW_RUNTIME%/*/*}
    if is_generation_target "$JRNL_NEW_RUNTIME" runtime; then
      rmdir "$parent" 2>/dev/null || :
      rmdir "$version_dir" 2>/dev/null || :
      rmdir "$ZM_RUNTIME_VERSIONS" 2>/dev/null || :
      rmdir "${ZM_RUNTIME_VERSIONS%/*}" 2>/dev/null || :
    fi
  fi
  rm -f "$ZM_RUNTIME_CURRENT"
}

within_root() {
  # Lexically normalized containment: $1 (an absolute path, possibly with
  # '.'/'..' segments) must stay under $2. Returns 1 on any escape.
  case "$1" in
    "$2"|"$2"/*) : ;;
    *) return 1 ;;
  esac
  rel=${1#"$2"}
  case "$rel" in
    '') return 0 ;;
    /*) rel=${rel#/} ;;
    *) return 1 ;;
  esac
  depth=0
  while [ -n "$rel" ]; do
    seg=${rel%%/*}
    case "$seg" in
      ''|.) : ;;
      ..)
        depth=$((depth - 1))
        if [ "$depth" -lt 0 ]; then return 1; fi
        ;;
      *) depth=$((depth + 1)) ;;
    esac
    case "$rel" in
      */*) rel=${rel#*/} ;;
      *) rel= ;;
    esac
  done
  return 0
}

jrnl_validate_line() {
  # Validates one journal field at a time; exits 2 on tampering.
  key=$1
  value=$2
  case "$key" in
    TRANSACTION_SCHEMA) [ "$value" = "$TRANSACTION_SCHEMA" ] || return 1 ;;
    INSTALL_KIND) case "$value" in fresh|update|reinstall) : ;; *) return 1 ;; esac ;;
    MODE) case "$value" in local|docker) : ;; *) return 1 ;; esac ;;
    PHASE)
      case "$value" in
        prepared|old_stopped|runtime_switched|cli_switched|config_switched|candidate_started|committed) : ;;
        *) return 1 ;;
      esac ;;
    KEEP_VERIFIED_CLI|OLD_WAS_RUNNING|DOCKER_STATE_PREEXISTED)
      case "$value" in 0|1) : ;; *) return 1 ;; esac ;;
    OLD_CLI_TARGET|NEW_CLI_TARGET)
      [ -z "$value" ] || is_generation_target "$value" cli || return 1 ;;
    OLD_RUNTIME_TARGET|NEW_RUNTIME_TARGET)
      [ -z "$value" ] || is_generation_target "$value" runtime || return 1 ;;
    OLD_CONFIG_BACKUP|STAGE_ROOT)
      [ -z "$value" ] || within_root "$value" "$ZM_TRANSACTION_ROOT" || return 1 ;;
    OLD_IMAGE|NEW_IMAGE)
      [ -z "$value" ] || valid_digest_ref "$value" || return 1 ;;
    *) return 1 ;;
  esac
  return 0
}

jrnl_read() {
  # Parses and validates the journal into JRNL_* globals; exits 2 when a
  # field fails validation. Values are data, never shell.
  [ -f "$ZM_TRANSACTION_JOURNAL" ] || return 1
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    key=${line%%=*}
    value=${line#*=}
    jrnl_validate_line "$key" "$value" || {
      err "error: invalid transaction journal field: $key"
      exit "$EXIT_USAGE"
    }
    case "$key" in
      INSTALL_KIND) JRNL_KIND=$value ;;
      MODE) JRNL_MODE=$value ;;
      PHASE) JRNL_PHASE=$value ;;
      KEEP_VERIFIED_CLI) JRNL_KEEP_CLI=$value ;;
      OLD_WAS_RUNNING) JRNL_OLD_RUNNING=$value ;;
      OLD_CLI_TARGET) JRNL_OLD_CLI=$value ;;
      NEW_CLI_TARGET) JRNL_NEW_CLI=$value ;;
      OLD_RUNTIME_TARGET) JRNL_OLD_RUNTIME=$value ;;
      NEW_RUNTIME_TARGET) JRNL_NEW_RUNTIME=$value ;;
      OLD_CONFIG_BACKUP) JRNL_OLD_CONFIG_BACKUP=$value ;;
      STAGE_ROOT) JRNL_STAGE=$value ;;
      DOCKER_STATE_PREEXISTED) JRNL_DOCKER_PREEXISTED=$value ;;
      OLD_IMAGE) JRNL_OLD_IMAGE=$value ;;
      NEW_IMAGE) JRNL_NEW_IMAGE=$value ;;
      *) : ;;
    esac
  done < "$ZM_TRANSACTION_JOURNAL"
  return 0
}

jrnl_remove() {
  rm -f "$ZM_TRANSACTION_JOURNAL"
}

