#!/bin/sh
# Entrypoint for the zosma-cowork sandbox container.
# Starts the Tailscale daemon before handing off to the app so the container
# can reach hosts on the tailnet. Needs NET_ADMIN + SYS_ADMIN and
# /dev/net/tun (see docker-compose.sandbox.yml).
set -e

# Allow the operator to override the container timezone via $TZ (IANA zone
# name, e.g. America/New_York). tzdata is installed in the image; symlink
# /etc/localtime + /etc/timezone so system time and most libs honor it.
if [ -n "$TZ" ] && [ -f "/usr/share/zoneinfo/$TZ" ]; then
  ln -sf "/usr/share/zoneinfo/$TZ" /etc/localtime
  echo "$TZ" > /etc/timezone
  export TZ="$TZ"
  echo "[entrypoint] timezone set to $TZ"
fi

if [ -x /usr/sbin/tailscaled ]; then
  echo "[entrypoint] starting tailscaled ..."
  mkdir -p /var/lib/tailscale /var/run/tailscale
  # Background so it doesn't block the app. Logs stream to the entrypoint
  # stdout, which docker compose captures.
  tailscaled &
  sleep 2
  echo "[entrypoint] tailscale status:"
  tailscale status || echo "[entrypoint] tailscale not authenticated yet"
else
  echo "[entrypoint] tailscaled not found — skipping tailnet setup" >&2
fi

# ── One persistent mount/PVC ─────────────────────────────────────────────────
# /persistent owns three lifecycle domains: user home, mutable system root,
# and migration metadata. /home/user is only a stable visible alias.
PERSISTENT_HOME="${PI_PERSISTENT_HOME:-/persistent/home}"
ROOTFS="${PI_PERSISTENT_ROOTFS:-/persistent/rootfs}"
STATE_DIR=/persistent/state
mkdir -p "$PERSISTENT_HOME" "$ROOTFS" "$STATE_DIR"
rm -rf "$HOME"
ln -s "$PERSISTENT_HOME" "$HOME"

USER_BIN="$HOME/.local/bin"
USER_SHARE="$HOME/.local/share"
mkdir -p "$HOME/workspace" "$HOME/Documents" "$HOME/Downloads" \
  "$HOME/.config" "$USER_BIN" "$USER_SHARE/npm"
[ -f "$HOME/README.md" ] || echo "Welcome to Zosma Sandbox - your home is $HOME" > "$HOME/README.md"
[ -f "$HOME/workspace/README.md" ] || echo "# Workspace" > "$HOME/workspace/README.md"
[ -f "$STATE_DIR/schema-version" ] || echo "1" > "$STATE_DIR/schema-version"

# Initialize the mutable Alpine root once. All later system installs directly
# modify this PVC directory, so replacement pods perform no package restore.
if [ ! -f "$ROOTFS/.initialized" ]; then
  echo "[entrypoint] initializing persistent Alpine root at $ROOTFS ..."
  tar -xzf /opt/alpine-minirootfs.tar.gz -C "$ROOTFS"
  mkdir -p "$ROOTFS/home/user"
  touch "$ROOTFS/.initialized"
fi
cp /etc/resolv.conf "$ROOTFS/etc/resolv.conf"
cat "$ROOTFS/etc/alpine-release" > "$STATE_DIR/rootfs-version"

# Keep standalone user binaries visible to the host runtime and inner rootfs.
for b in "$USER_BIN"/*; do
  [ -e "$b" ] || continue
  ln -sf "$b" "/usr/local/bin/$(basename "$b")"
done

[ -d "$USER_SHARE/venv" ] || python3 -m venv "$USER_SHARE/venv"
export NPM_CONFIG_PREFIX="$USER_SHARE/npm"
export PATH="$USER_SHARE/npm/bin:$USER_SHARE/venv/bin:$USER_BIN:$PATH"

# Node must be the container's main process (PID 1) so it stays alive and
# handles signals. `exec` replaces this shell with node.
exec node server.js
