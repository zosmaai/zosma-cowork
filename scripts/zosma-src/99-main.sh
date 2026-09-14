# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

main() {
  [ $# -gt 0 ] || usage_error "no command given"
  cmd=$1
  shift
  case "$cmd" in
    version) cmd_version "$@" ;;
    help|-h|--help) print_help ;;
    install) recover_transaction; cmd_install "$@" ;;
    serve) recover_transaction; cmd_serve "$@" ;;
    start) recover_transaction; cmd_start "$@" ;;
    stop) recover_transaction; cmd_stop "$@" ;;
    restart) recover_transaction; cmd_restart "$@" ;;
    status) recover_transaction; cmd_status "$@" ;;
    logs) recover_transaction; cmd_logs "$@" ;;
    open) recover_transaction; cmd_open "$@" ;;
    doctor) recover_transaction; cmd_doctor "$@" ;;
    access) recover_transaction; cmd_access "$@" ;;
    update) recover_transaction; cmd_update "$@" ;;
    uninstall) recover_transaction; cmd_uninstall "$@" ;;
    *) usage_error "unknown command: $cmd" ;;
  esac
}

if [ "${ZOSMA_TESTING:-}" = "1" ] && [ "${ZOSMA_SOURCE_MODE:-}" = "1" ]; then
  # Sourced test mode: definitions only, the caller drives the pure helpers.
  :
else
  main "$@"
fi