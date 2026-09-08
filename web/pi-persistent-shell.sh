#!/bin/sh
# Shell used by Pi Web for project commands. The mutable Alpine root lives in
# the user's persistent home/PVC; proot maps that same home into the rootfs.
set -eu

ROOTFS="${PI_PERSISTENT_ROOTFS:-/persistent/rootfs}"
PERSISTENT_HOME="${PI_PERSISTENT_HOME:-/persistent/home}"
USER_BIN="$HOME/.local/bin"
USER_SHARE="$HOME/.local/share"
export NPM_CONFIG_PREFIX="$USER_SHARE/npm"
export PATH="$USER_SHARE/npm/bin:$USER_SHARE/venv/bin:$USER_BIN:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

if [ ! -f "$ROOTFS/.initialized" ]; then
  echo "Persistent shell root is not initialized: $ROOTFS" >&2
  exit 127
fi

case "$PWD" in
  "$HOME"|"$HOME"/*) workdir="$PWD" ;;
  *) workdir="$HOME/workspace" ;;
esac

exec proot \
  -R "$ROOTFS" \
  -b "$PERSISTENT_HOME:$HOME" \
  -w "$workdir" \
  /bin/sh "$@"
