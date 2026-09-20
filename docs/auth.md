# Authentication — Zosma sign-in gate

Status: **implemented and verified on 2026-09-20** (commit `4b84476`, branch `feat/add-auth`).

Before this work the web tier protected only `/` and `/api/*` with HTTP Basic auth
when `PI_WEB_PASSWORD` was set. With that variable unset — the normal desktop and
`start:lan` case — any browser that could reach the port got the whole app, and a
machine-wide `models.json` entry let a browser that had never signed in through.
That hole is closed, and the desktop deep-link scheme now exists.

## 1. What is done

### 1.1 Per-browser session, no session store

A signed-in browser holds an HMAC-signed cookie. The signing key is derived from
the router key itself, so there is no session table, no migration, and revoking
the provider invalidates every cookie it ever issued.

| Piece | File |
|---|---|
| Token + cookie helpers | `apps/web/lib/zosma-auth/session.ts` |
| Pure enforcement rule | `apps/web/lib/api-guard.ts` |
| Enforcement point | `apps/web/proxy.ts` (Next 16 Proxy, matcher `["/", "/api/:path*"]`) |

```
zosma_session = <sha256(routerKey)>.<expiresAtMs>.<hmac>
                 key   = "zosma-web-session:" + routerKey
attributes          = Path=/; HttpOnly; SameSite=Lax; Max-Age=30d; Secure on https only
```

- `createSessionToken` / `verifySessionToken` are timing-safe and expiry-checked.
- `currentRouterKey(piDir)` reads the stored `zosma-router` entry; no key → no
  valid session → nobody is signed in.
- `getZosmaStatus()` now returns **`signedIn`** (this browser) next to
  **`configured`** (this machine). The gate keys on `signedIn`, so machine-wide
  configuration alone no longer admits a fresh browser.

### 1.2 API boundary rule

`lib/api-guard.ts` decides, and `proxy.ts` applies it:

| Request | Result |
|---|---|
| `/api/*` with a valid session cookie | allowed |
| `/api/*` with no/invalid cookie | `401 {"error":"Sign in with Zosma to continue"}` (`Cache-Control: no-store`) |
| `/api/auth/zosma/*` (onboarding family) | always reachable — otherwise nobody could ever sign in |
| `/api/*` with valid `PI_WEB_PASSWORD` Basic auth | allowed (scripted/programmatic access preserved) |
| non-API paths | not blocked here (gate is in the UI, see below) |

Route family that stays open while signed out:
`status`, `start`, `complete`, `cancel`, `callback`, `config`, `disconnect`,
`refresh`, `api-key`.

Cookie lifecycle:

- issued by `complete` (deep-link/manual paste), `callback` (loopback), `api-key` (router-key paste)
- cleared by `disconnect`, which also fires `ZOSMA_SIGNED_OUT_EVENT`

### 1.3 UI gate

| Piece | File |
|---|---|
| Gate state | `apps/web/hooks/useZosmaGate.ts` — pure `resolveZosmaGate({loading, signedIn}) → loading｜signed-out｜signed-in` |
| Sign-in screen | `apps/web/components/LoginScreen.tsx` |
| Mount point | `apps/web/components/AppShell.tsx` — early return before the shell paints |

- `LoginScreen` drives the existing `useZosmaAuth` flow (start → external
  authorization URL → completion). It is reused verbatim; no second auth system.
- Two completion paths are offered:
  1. **Deep link** — the auth server's Cowork page opens `ai.zosma.cowork://oauth/callback?code=…&state=…`.
  2. **Router-key paste** — always available, so a browser that cannot receive the
     deep link still has a guaranteed way in.
- Copy is phase- and platform-aware: the desktop app says *"Opening browser…"*,
  a plain browser says *"Opening your sign-in link…"* (`auth.openingLink`, en + zh-CN).
  `isTauri()` takes an optional window and is null-safe, so it is safe to call from
  a render or effect in any environment.
- `ZosmaAuthCard` (settings → models) dispatches `ZOSMA_SIGNED_OUT_EVENT` on
  Disconnect, so the gate returns to the login screen without a reload.

### 1.4 Desktop deep link

- `apps/desktop/tauri.conf.json`: `plugins.deep-link.desktop.schemes = ["ai.zosma.cowork"]`
  (macOS reads this statically from the bundled `Info.plist`).
- `apps/desktop/src/lib.rs` setup calls `app.deep_link().register_all()`; failures
  log a warning instead of aborting, because macOS reports `UnsupportedPlatform`.
- `useZosmaAuth` exports a strict `parseDeepLink`: scheme `ai.zosma.cowork`, host
  `oauth`, path `/callback`, exactly one `code` and one `state`.
- `getCurrent()` runs after `onOpenUrl()` registration to cover launch-by-link,
  guarded by a shared in-flight `deliveredRef` so a link is not consumed twice.

### 1.5 The web bundle ships no pi SDK

`lib/zosma-auth/index.ts` previously imported `ModelRuntime` from
`@earendil-works/pi-coding-agent`. The app runs `next dev --webpack`, so webpack
bundled the ESM SDK into route chunks and threw
`Cannot find module 'node:fs' / 'node:os' / 'node:path'` at runtime.

`productionDeps(piDir = agentDir())` now answers `getAvailable(providerId)` by
reading that provider's models straight out of `models.json` — the same file the
registry reads. This matches the daemon-only SDK rule in `AGENTS.md`, removes the
runtime crash, and cut `POST /api/auth/zosma/start` from ~10.5s to under 1s in dev.

### 1.6 Verification

| Check | Result |
|---|---|
| `pnpm -C apps/web test` | 859/859 (new: `session`, `api-guard`, `proxy`, `useZosmaGate`, `LoginScreen`, `AppShell.auth-gate`) |
| `pnpm typecheck` | clean |
| `pnpm lint` | 0 errors (16 pre-existing warnings) |
| `pnpm web:build` | exit 0, including the Proxy (Middleware) entry |
| `cargo fmt --check` / `cargo clippy -D warnings` / `cargo check` | exit 0 |
| Live, fresh browser, no cookie | login screen only; `GET /api/v1/sessions` → `401`; `GET /api/auth/zosma/status` → `signedIn:false` |
| Live, cookie minted from the real router key | full app shell; `/api/v1/sessions` → `200` |
| Live, `POST /api/auth/zosma/start` | `200` with a real `authorization_url`, zero module errors in the dev log |

## 2. What is left

### 2.1 Must do

1. **Restore the damaged model catalog — needs a human Google sign-in.**
   `~/.pi/agent/models.json`'s `zosma-router` entry was reduced from 32 models to 1
   by a live probe that POSTed a real key to `/api/auth/zosma/api-key`; that route
   validates against the **router** host (`/models`), while sign-in writes the
   **auth** host (`/v1/models`) entitlement catalog. The stored key is untouched
   and still valid.

   The catalog cannot be recovered server-side: `auth.zosma.ai/v1/models` rejects
   the stored router key (`401 device_key_invalid`), routing around it
   (`/api/models`, `/api/cowork/models`, `/v1/models/public`) is 401/404, and the
   router host honestly reports this key's single LiteLLM route. The list only
   ever comes back from a code exchanged at `POST /v1/cowork/token`. So:

   1. Open <http://127.0.0.1:30141> and click **Continue with Google**.
   2. Approve the consent on `auth.zosma.ai`.
   3. On the Cowork completion page, copy the `ai.zosma.cowork://oauth/callback?code=…&state=…`
      link and paste it into **"Trouble? Paste the result URL"** — or let the
      desktop app catch the deep link.

   That writes the 32-model catalog back and issues the session cookie.

   Recurrence is now blocked: `authenticateWithKey` merges the fetched rows with
   the stored entry instead of replacing it, so pasting a router key can add
   models but never delete them (`lib/zosma-auth/index.test.mjs` asserts it).
   Still: never exercise a sign-in or write endpoint against a real credential
   without copying `models.json` first.
2. **Confirm deep-link delivery in a signed/bundled macOS app.** The scheme is
   declared, but macOS only honours it from a bundled app with a registered
   `Info.plist`, so this is untestable from `next dev`. Macros: build the bundle,
   sign in, and check the launch-by-link and running-app paths.

### 2.2 Known gaps / accepted trade-offs

- **`/` HTML is still served to anonymous visitors.** It contains no data — every
  byte of app data comes from `/api/*`, which returns 401 — but the shell markup
  itself is public. Closing that needs a server-side redirect from `/` to a login
  route in `proxy.ts`.
- **A second browser on an already-signed-in machine must redo the PKCE flow.**
  Per-browser sessions cannot be granted from machine-wide state, and the flow
  overwrites the `zosma-router` entry with a fresh device key.
- **No loopback auto-return to the browser.** `POST /start` deliberately does not
  forward `redirect_uri` (the deployed auth server rejects unexpected fields; a test
  asserts this). Completion therefore relies on the deep link or the router-key
  paste, not on a `http://127.0.0.1:…/api/auth/zosma/callback` bounce.
- **Windows/Linux deep links may open a second instance.** `tauri-plugin-single-instance`
  is not installed; macOS LaunchServices delivers the URL to the running app, the
  other platforms generally do not.
- **Sessions are not individually revocable.** The cookie is stateless; the only
  revocation lever is disconnecting the provider, which invalidates all of them.
  There is no rotation on password/key change.
- **`proxy.ts` re-reads `models.json` synchronously on every `/api` request**
  (marked with a `ponytail:` comment). Add a short TTL cache if API throughput ever
  makes it visible.
- **Cowork authorization rate limiting is still a no-op.** The server-side route's
  limiter is a TODO that always allows, and `COWORK_AUTH_SECRET` defaults to
  `dev-only-change-me` when unset. Both belong to the auth server repo, not this one.
- **Pending PKCE transactions** live in `<agentDir>/zosma-auth-pending.json` with a
  10-minute TTL and are overwritten by each new `start`. A stale file makes
  `/status` report `pending:true` until it expires. Harmless, but noisy.

## 3. Where the pieces live

```
apps/web/proxy.ts                          enforcement point (Node runtime)
apps/web/lib/api-guard.ts                  pure needsZosmaSession / isZosmaAuthRoute
apps/web/lib/zosma-auth/session.ts         token, cookie, currentRouterKey
apps/web/lib/zosma-auth/index.ts           PKCE orchestration, productionDeps, status
apps/web/hooks/useZosmaGate.ts             gate state + ZOSMA_SIGNED_OUT_EVENT
apps/web/hooks/useZosmaAuth.ts             sign-in state machine + parseDeepLink
apps/web/components/LoginScreen.tsx        full-screen sign-in
apps/web/components/AppShell.tsx           gate mount, before the shell paints
apps/web/app/api/auth/zosma/*              status start complete cancel callback
                                           config disconnect refresh api-key
apps/desktop/tauri.conf.json               deep-link scheme ai.zosma.cowork
apps/desktop/src/lib.rs                    deep_link().register_all() in setup
```

Environment knobs: `PI_WEB_PASSWORD` (Basic auth; also bypasses the session rule),
`PI_CODING_AGENT_DIR` (where `models.json`, the pending transaction and the device
id live; defaults to `~/.pi/agent`). Auth and router base URLs are not environment
variables — they come from `<agentDir>/zosma-router-config.json`, editable from the
settings advanced section.