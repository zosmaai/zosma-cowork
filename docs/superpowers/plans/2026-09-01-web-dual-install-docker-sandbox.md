# Web Dual-Install: Direct + Docker Sandbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use /skill:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `web/` dashboard runs two ways — (1) directly on machine via `pnpm dev`/`pnpm start` and (2) inside a Docker container with isolated pi state and a single dashboard URL — with a one-command fresh-install test.

**Architecture:** `web/next.config.ts` already emits `output:"standalone"` (`.next/standalone/server.js`). Add a multi-stage `web/Dockerfile` that builds the standalone server, a `web/docker-compose.sandbox.yml` that runs it with an ephemeral `PI_CODING_AGENT_DIR` volume (delete volume = fresh `~/.pi/agent`), and a `web/scripts/docker-sandbox.sh` helper. Fix the stuck `authBaseUrl` default so Docker and native both hit the right backend (`https://router.zosma.ai` today, `https://auth.zosma.ai` when cowork endpoints move).

**Tech Stack:** Next.js 16.3.1 (standalone), Node 22, pnpm 10, Docker + Compose, `@earendil-works/pi-coding-agent` `getAgentDir()` (`PI_CODING_AGENT_DIR` env, default `~/.pi/agent`), `UFW` for LAN

**Roadmap:** None

**Phase:** Single-plan implementation

---

## File Structure

```
web/
├── Dockerfile                          # multi-stage: deps → builder → runner (standalone)
├── .dockerignore                       # ignore .next/cache, node_modules, .git
├── docker-compose.sandbox.yml          # one service `cowork`, port 30141, named volume pi-data -> /data/pi-agent
├── scripts/docker-sandbox.sh           # helper: build | up | logs | fresh | down
├── next.config.ts                      # fix DEFAULT authBaseUrl if needed + ensure standalone tracing
└── docs/plans/2026-09-01-*.md          # this plan
```

**Responsibilities:**
- `Dockerfile` — reproducible production image. No dev deps at runtime. Runs `node server.js` from `.next/standalone` (verified: entry at standalone root).
- `docker-compose.sandbox.yml` — declares port, volume, env (`PORT`, `PI_WEB_HOSTNAME=0.0.0.0`, `PI_CODING_AGENT_DIR=/data/pi-agent`, `PI_WEB_PASSWORD` optional). `down -v` wipes pi state = fresh install.
- `scripts/docker-sandbox.sh` — one entrypoint for `build`, `up`, `fresh`, `logs`, `down` so QA can do fresh test in one command.
- `next.config.ts` — already correct; only change if `DEFAULT_AUTH_BASE_URL` must move off `https://router.zosma.ai` (see Task 1 — decide with `../zosma-router` probe).

---

### Task 0: Pre-flight — confirm current web contract

**Files:**
- Read: `web/package.json:engines,scripts`
- Read: `web/next.config.ts`
- Read: `web/bin/pi-web.js`, `web/bin/pi-web-options.js`
- Read: `web/lib/zosma-auth/router-config.ts:DEFAULT_AUTH_BASE_URL`
- Check: `../zosma-router/src/app/v1/cowork/authorizations/route.ts` exists

- [ ] **Step 1: Verify standalone output already enabled**

Run:
```bash
grep -q 'output.*standalone' web/next.config.ts && echo "standalone OK" || echo "MISSING standalone"
ls web/.next/standalone 2>&1 | head -5
```

Expected: `standalone OK`. If `.next/standalone` missing, run `cd web && pnpm build` then re-check. `ls web/.next/standalone` should show `server.js` at top level (not `web/server.js`).

- [ ] **Step 2: Confirm pi agent dir env contract**

Run:
```bash
grep -n "ENV_AGENT_DIR\|getAgentDir" web/node_modules/@earendil-works/pi-coding-agent/dist/config.js | head -5
# Should print: ENV_AGENT_DIR = "PI_CODING_AGENT_DIR"
grep -n "DEFAULT_AUTH_BASE_URL" web/lib/zosma-auth/router-config.ts
```

Expected: `PI_CODING_AGENT_DIR` and default `https://router.zosma.ai` (or `https://auth.zosma.ai` after Task 1).

- [ ] **Step 3: Record host LAN IP and port availability**

Run:
```bash
ip addr | grep 192.168 | head -3
ss -ltn | grep 30141 || echo "30141 free"
sudo ufw status | grep 30141 || echo "ufw: 30141 not allowed"
```

Expected: LAN IP visible, decide if `pnpm dev:lan` / Docker `-p 30141:30141` reachable. If ufw missing rule, note to add `sudo ufw allow 30141/tcp`.

---

### Task 1: Fix auth/router base URL default (one-line, if probe says so)

**Files:**
- Modify: `web/lib/zosma-auth/router-config.ts:1-10`
- Test: `web/lib/zosma-auth/router-config.test.mjs` (existing)

**Context:** `../zosma-router` cowork endpoints live at Next.js (`auth.zosma.ai`), but prod `router.zosma.ai` is pure LiteLLM (`Dockerfile.router.prod` → 404 on `/v1/cowork/*`). If direct probe `curl -i https://router.zosma.ai/v1/cowork/authorizations` is 404 and `https://auth.zosma.ai/v1/cowork/authorizations` is 400/200, default is wrong.

- [ ] **Step 1: Run the probe (do this before editing)**

Run:
```bash
curl -s -i -m 8 -X POST https://router.zosma.ai/v1/cowork/authorizations -H "Content-Type: application/json" -d '{"client_id":"zosma-cowork","state":"x","code_challenge":"x","code_challenge_method":"S256","device_id":"cowork-x"}' | head -10
curl -s -i -m 8 -X POST https://auth.zosma.ai/v1/cowork/authorizations -H "Content-Type: application/json" -d '{"client_id":"zosma-cowork","state":"x","code_challenge":"x","code_challenge_method":"S256","device_id":"cowork-x"}' | head -10
```

Expected: one returns `404 {"detail":"Not Found"}` (LiteLLM), the other returns `400`/`200` (Next.js). Use the host that does NOT 404 as the new auth base.

- [ ] **Step 2: Update default if needed**

If probe shows `auth.zosma.ai` is correct, edit `web/lib/zosma-auth/router-config.ts`:

```ts
// before:
export const DEFAULT_AUTH_BASE_URL = "https://router.zosma.ai";
// after:
export const DEFAULT_AUTH_BASE_URL = "https://auth.zosma.ai";
```

If `router.zosma.ai` already serves cowork routes (both return 400/200), leave file unchanged and skip to Task 2.

- [ ] **Step 3: Run existing router-config tests**

Run:
```bash
cd web && node --experimental-strip-types --test lib/zosma-auth/router-config.test.mjs 2>&1 | tail -20
```

Expected: all pass. If a test asserts the old default string, update that assertion to the new host.

- [ ] **Step 4: Commit (only if changed)**

```bash
git add web/lib/zosma-auth/router-config.ts
git commit -m "fix(zosma-auth): point DEFAULT_AUTH_BASE_URL at auth host"
```

---

### Task 2: Add `web/Dockerfile` (multi-stage, standalone)

**Files:**
- Create: `web/Dockerfile`
- Create: `web/.dockerignore`

- [ ] **Step 1: Create `.dockerignore`**

Create `web/.dockerignore`:
```
node_modules
.next
.next/cache
.next/dev
.git
.gitignore
.llm-wiki
.pi
coverage
dist-server
*.log
.env.local
```

- [ ] **Step 2: Create `web/Dockerfile`**

Create `web/Dockerfile`:
```dockerfile
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
ENV PI_WEB_HOSTNAME=0.0.0.0
ENV PI_CODING_AGENT_DIR=/data/pi-agent
# On disk (verified 2026-09-01): .next/standalone/server.js at standalone root, not web/server.js
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 30141
HEALTHCHECK --interval=10s --timeout=3s --retries=10 CMD wget -qO- http://127.0.0.1:30141/api/agent/running || exit 1
CMD ["node", "server.js"]
```

Notes:
- Verified: `ls web/.next/standalone` shows `server.js` at top level (no `web/` prefix). Static and public must be copied to `./.next/static` and `./public` alongside `server.js`.

- [ ] **Step 3: Verify Dockerfile syntax**

Run:
```bash
cd web && docker build --check -f Dockerfile . 2>&1 | head -20 || echo "docker build --check not available, skipping"
cat Dockerfile | head -30
```

Expected: no syntax error, file present.

---

### Task 3: Add `web/docker-compose.sandbox.yml` + helper script

**Files:**
- Create: `web/docker-compose.sandbox.yml`
- Create: `web/scripts/docker-sandbox.sh`

- [ ] **Step 1: Create `web/docker-compose.sandbox.yml`**

Create `web/docker-compose.sandbox.yml`:
```yaml
services:
  cowork:
    build:
      context: .
      dockerfile: Dockerfile
    image: zosma-cowork:local
    ports:
      - "30141:30141"
    environment:
      PORT: "30141"
      PI_WEB_HOSTNAME: "0.0.0.0"
      PI_CODING_AGENT_DIR: "/data/pi-agent"
      PI_WEB_PASSWORD: "${PI_WEB_PASSWORD:-}"
      ZOSMA_AUTH_BASE_URL: "${ZOSMA_AUTH_BASE_URL:-}"
      ZOSMA_ROUTER_BASE_URL: "${ZOSMA_ROUTER_BASE_URL:-}"
    # Optional: add env_file: .env.sandbox.local for staging overrides without rebuilding
    volumes:
      - pi-data:/data/pi-agent
    restart: unless-stopped

volumes:
  pi-data:
```

- [ ] **Step 2: Create `web/scripts/docker-sandbox.sh`**

Create `web/scripts/docker-sandbox.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker-compose.sandbox.yml"
case "${1:-up}" in
  build) $COMPOSE build ;;
  up) $COMPOSE up -d --build; for i in $(seq 1 30); do curl -sf http://127.0.0.1:30141/api/agent/running && break || sleep 2; done; echo "→ http://$(hostname -I | awk '{print $1}'):30141  (http://127.0.0.1:30141 locally)" ;;
  logs) $COMPOSE logs -f cowork ;;
  fresh) $COMPOSE down -v; $COMPOSE up -d --build; for i in $(seq 1 30); do curl -sf http://127.0.0.1:30141/api/agent/running && break || sleep 2; done; echo "fresh pi state at /data/pi-agent (volume recreated)" ;;
  down) $COMPOSE down ;;
  *) echo "usage: $0 [build|up|logs|fresh|down]" >&2; exit 1 ;;
esac
```
Run:
```bash
chmod +x web/scripts/docker-sandbox.sh
```

- [ ] **Step 3: Validate compose file**

Run:
```bash
cd web && docker compose -f docker-compose.sandbox.yml config 2>&1 | head -40
```

Expected: no error, service `cowork` shows `ports: 30141:30141`, volume `pi-data`.

---

### Task 4: Build, smoke, and verify isolated pi state

**Files:**
- None (verification only)

- [ ] **Step 1: Build image**

Run:
```bash
cd web && docker build -f Dockerfile -t zosma-cowork:local . 2>&1 | tail -20
```

Expected: `BUILD` succeeds. If `pnpm install --frozen-lockfile` fails due to lockfile mismatch, replace with `pnpm install` in Dockerfile and rebuild.

- [ ] **Step 2: Inspect standalone entry path**

Run:
```bash
docker run --rm zosma-cowork:local ls -R /app 2>&1 | head -60
# expect one of: /app/web/server.js  or  /app/server.js
```

If entry is `/app/server.js`, edit `web/Dockerfile` `CMD` to `["node","server.js"]` and rebuild.

- [ ] **Step 3: Up and hit health endpoints**

Run:
```bash
cd web && ./scripts/docker-sandbox.sh up
# wait for HEALTHCHECK (or retry loop — sleep is flaky)
for i in $(seq 1 30); do curl -sf http://127.0.0.1:30141/api/agent/running && break || sleep 2; done
curl -s http://127.0.0.1:30141/api/auth/zosma/status | python3 -m json.tool
curl -s http://127.0.0.1:30141/api/agent/running | head -c 200; echo
```

Expected: `{"configured":..., "authBaseUrl":"https://auth.zosma.ai" (or router), "modelCount":...}` and `200` from `/api/agent/running`. If `configured:false`, pi state is fresh (correct) — configure via Models panel.

- [ ] **Step 4: Verify fresh-install wipes pi state**

Run:
```bash
# write a marker into the volume (use compose exec — container name varies: web-cowork-1 vs zosma-cowork-cowork-1)
docker compose -f docker-compose.sandbox.yml exec cowork sh -c 'echo hello > /data/pi-agent/_probe.txt && cat /data/pi-agent/_probe.txt'
cd web && ./scripts/docker-sandbox.sh fresh
for i in $(seq 1 30); do curl -sf http://127.0.0.1:30141/api/agent/running && break || sleep 2; done
docker compose -f docker-compose.sandbox.yml exec cowork sh -c 'ls /data/pi-agent/_probe.txt 2>&1 || echo "probe gone — fresh OK"'
curl -s http://127.0.0.1:30141/api/auth/zosma/status | python3 -m json.tool | head -20
```

Expected: `probe gone — fresh OK` and `modelCount:0, configured:false`.

- [ ] **Step 5: Teardown**

Run:
```bash
cd web && ./scripts/docker-sandbox.sh down
```

---

### Task 5: Wire native direct install (docs + one-liner verification)

**Files:**
- Modify: `web/README.md` (or `web/docs/dual-install.md` if you prefer a separate doc)
- Test: manual

- [ ] **Step 1: Document both install paths**

Add to `web/README.md` under a new `## Dual Install` section (keep existing Quick Start):

```markdown
## Dual Install

### 1. Direct (native)
Requires Node >=22.19.0.
```bash
cd web
pnpm install
pnpm dev          # loopback only → http://127.0.0.1:30141
# or
pnpm dev:lan      # LAN → http://<lan-ip>:30141  (needs: sudo ufw allow 30141/tcp)
pnpm build && pnpm start:lan  # production
```
Pi state: `~/.pi/agent` (or `$PI_CODING_AGENT_DIR`).

### 2. Docker sandbox (isolated, fresh each time)
```bash
cd web
./scripts/docker-sandbox.sh up      # build + run → http://<lan-ip>:30141
./scripts/docker-sandbox.sh logs    # follow
./scripts/docker-sandbox.sh fresh   # wipe pi state + restart (fresh install)
./scripts/docker-sandbox.sh down    # stop
# optional LAN password:
PI_WEB_PASSWORD='long-random' ./scripts/docker-sandbox.sh up
```
Pi state: Docker volume `pi-data` at `/data/pi-agent` (`down -v` wipes it).
```

- [ ] **Step 2: Verify native path still works**

Run:
```bash
cd web && pnpm build 2>&1 | tail -10
# smoke: start prod server and curl it
timeout 15 bash -c 'PORT=30142 pnpm start -- -p 30142 -H 127.0.0.1 & pid=$!; for i in $(seq 1 20); do curl -sf http://127.0.0.1:30142/api/agent/running && break || sleep 1; done; curl -s http://127.0.0.1:30142/api/agent/running | head -c 200; kill $pid; wait $pid 2>/dev/null; echo ok'
```

Expected: build succeeds, no regression.

- [ ] **Step 3: Commit**

```bash
git add web/Dockerfile web/.dockerignore web/docker-compose.sandbox.yml web/scripts/docker-sandbox.sh web/README.md
git commit -m "feat(web): dual-install — direct + Docker sandbox with isolated pi state"
```

---

### Task 6: Final gates — lint, build, fresh test

**Files:**
- None

- [ ] **Step 1: Run web gates**

Run:
```bash
cd web && pnpm lint 2>&1 | tail -10
cd web && pnpm build 2>&1 | tail -20
```

Expected: `lint` 0 warnings, `build` succeeds with `standalone` trace.

- [ ] **Step 2: One-command fresh test from zero**

Run:
```bash
cd web && ./scripts/docker-sandbox.sh fresh
curl -s http://127.0.0.1:30141/api/auth/zosma/status | python3 -m json.tool
curl -s http://127.0.0.1:30141/ | head -c 500 | grep -q "html" && echo "dashboard OK" || echo "dashboard failed"
```

Expected: `dashboard OK`, status shows `pending:false`. Open in browser: `http://127.0.0.1:30141` or `http://<lan-ip>:30141` → dashboard loads, no cached pi session.

- [ ] **Step 3: Push and handoff**

```bash
git push
```

Handoff: share `http://<lan-ip>:30141` with tester; tester does `fresh` for each clean-run test.

---

## Self-Review Checklist

- [ ] Task 1 probe decides auth host from real 404 vs 400 — no placeholder.
- [ ] Dockerfile uses `output:"standalone"` correctly — entry path verified in Task 4 Step 2.
- [ ] `PI_CODING_AGENT_DIR=/data/pi-agent` isolates pi state — `fresh` proves wipe.
- [ ] No new npm deps; uses `node:22-alpine`, `pnpm`, existing `next build`.
- [ ] Plan leaves project green: native `pnpm build` + `pnpm lint` still pass; Docker is additive.
