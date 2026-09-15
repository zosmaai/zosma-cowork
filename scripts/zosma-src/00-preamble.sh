#!/bin/sh
# zosma — Zosma Cowork lifecycle CLI (POSIX sh, dependency-free).
#
# One assignment of the development version; Phase 4 release CI stamps this
# line when producing the versioned CLI asset.
# shellcheck disable=SC2034
ZOSMA_CLI_VERSION=v0.0.0-dev
ZOSMA_INSTALLER_SCHEMA=1

CONFIG_SCHEMA=1
TRANSACTION_SCHEMA=1
MARKER_NAME=.zosma-cowork-owned
MARKER_LINE=ZOSMA_COWORK_INSTALLER_SCHEMA=1
DEFAULT_WEB_PORT=30141
FIXED_DAEMON_PORT=64713
COMPOSE_PROJECT=zosma-cowork
LAUNCH_AGENT_LABEL=ai.zosma.cowork
SYSTEMD_UNIT_BASENAME=zosma-cowork.service
EXIT_OK=0
EXIT_INTERNAL=1
EXIT_USAGE=2
EXIT_PREREQ=3
EXIT_VERIFY=4
EXIT_RUNTIME=5
EXIT_CANCEL=6

set -eu

