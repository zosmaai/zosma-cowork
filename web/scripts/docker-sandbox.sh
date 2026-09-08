#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker-compose.sandbox.yml"
case "${1:-up}" in
  build) $COMPOSE build ;;
  up) $COMPOSE up -d --build; for i in $(seq 1 30); do curl -sf http://127.0.0.1:30141/api/agent/running && break || sleep 2; done; echo "→ http://$(hostname -I | awk '{print $1}'):30141  (http://127.0.0.1:30141 locally)" ;;
  logs) $COMPOSE logs -f zosma-cowork ;;
  fresh) echo "fresh no longer deletes host/PVC data; stop the sandbox and explicitly remove PI_PERSISTENT_DIR" >&2; exit 1 ;;
  down) $COMPOSE down ;;
  *) echo "usage: $0 [build|up|logs|fresh|down]" >&2; exit 1 ;;
esac
