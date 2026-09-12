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

# Node must be the container's main process (PID 1) so it stays alive and
# handles signals. `exec` replaces this shell with node.
exec node server.js
