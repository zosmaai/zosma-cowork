# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d
ARG RUNTIME_IMAGE=debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171

FROM ${NODE_IMAGE} AS builder
ARG ZOSMA_VERSION
WORKDIR /src
RUN apt-get update \
  && apt-get install -y --no-install-recommends xz-utils \
  && rm -rf /var/lib/apt/lists/*
COPY . .
RUN corepack enable \
  && corepack prepare pnpm@10.33.2 --activate \
  && pnpm install --frozen-lockfile
RUN arch="$(node -p 'process.arch')" \
  && pnpm server:package --version "${ZOSMA_VERSION}" --output /tmp/server \
  && mkdir -p /opt/zosma \
  && tar -xzf "/tmp/server/zosma-cowork-server-${ZOSMA_VERSION}-linux-${arch}.tar.gz" \
    -C /opt/zosma

FROM ${RUNTIME_IMAGE} AS runtime
ARG ZOSMA_VERSION
ARG VCS_REF
LABEL org.opencontainers.image.title="Zosma Cowork" \
  org.opencontainers.image.description="Self-hosted Zosma Cowork web and daemon runtime" \
  org.opencontainers.image.source="https://github.com/zosmaai/zosma-cowork" \
  org.opencontainers.image.licenses="MIT" \
  org.opencontainers.image.version="${ZOSMA_VERSION}" \
  org.opencontainers.image.revision="${VCS_REF}"
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git tzdata \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 10001 zosma \
  && useradd --uid 10001 --gid 10001 --no-create-home \
    --home-dir /data/pi-agent --shell /usr/sbin/nologin zosma \
  && mkdir -p /workspace /data/pi-agent \
  && chown -R 10001:10001 /workspace /data/pi-agent
COPY --from=builder --chown=10001:10001 /opt/zosma /opt/zosma
ENV HOME=/data/pi-agent \
  PATH=/opt/zosma/runtime/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  PORT=30141 \
  PI_WEB_HOSTNAME=0.0.0.0 \
  PI_WEB_NO_OPEN=1 \
  PI_CODING_AGENT_DIR=/data/pi-agent \
  ZOSMA_DAEMON_DATA_DIR=/data/pi-agent/daemon \
  ZOSMA_DAEMON_PORT=64713
WORKDIR /workspace
USER 10001:10001
EXPOSE 30141
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 CMD ["/opt/zosma/runtime/bin/node", "/opt/zosma/supervisor/healthcheck.mjs"]
ENTRYPOINT ["/opt/zosma/runtime/bin/node", "/opt/zosma/supervisor/run-server.mjs"]