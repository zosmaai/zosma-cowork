# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml* package-lock.yaml* ./
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate \
  && pnpm install --frozen-lockfile

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=30141
ENV HOSTNAME=0.0.0.0
ENV PI_WEB_HOSTNAME=0.0.0.0
ENV PI_CODING_AGENT_DIR=/data/pi-agent
ENV HOME=/home/user
RUN mkdir -p /home/user/workspace /home/user/Documents /home/user/Downloads \
  && echo "# Workspace" > /home/user/workspace/README.md \
  && echo "Welcome to Zosma Sandbox - your home is /home/user" > /home/user/README.md \
  && chmod -R 777 /home/user
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Fix standalone tracing miss: pi-coding-agent loads theme JSON dynamically
COPY --from=builder /app/node_modules/@earendil-works/pi-coding-agent/dist/modes ./node_modules/@earendil-works/pi-coding-agent/dist/modes
EXPOSE 30141
HEALTHCHECK --interval=10s --timeout=3s --retries=10 CMD wget -qO- http://127.0.0.1:30141/api/agent/running || exit 1
CMD ["node", "server.js"]
