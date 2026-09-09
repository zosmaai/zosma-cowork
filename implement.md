# Implement — Extensions / skills / prompts management over /api/v1

Scope of this commit: **install / check / update / search skill operations** on the
`/api/v1` boundary (ZOS-82, slice 2). The transport-neutral **skill listing**
boundary from slice 1 (`GET /api/v1/skills`) is the foundation this builds on.

## What the ticket is

The in-app skill management surface (`app/api/skills/install|update|check|search`)
is RPC/process-bound: it spawns `runNpx` to call `pi skills …`, imports
`getAgentDir()` from the SDK, and gates on filesystem `getAllowedFileRoots` /
`isExistingFilePathAllowed` via `NextResponse`. None of that is transport-neutral.
`/api/v1` has no route for a headless client to enumerate the skills installed for a
project.

The loader-backed enumeration already exists in
`web/lib/skills-service.ts` (`loadSkillsWithInstallInfo(cwd)` → `SkillsResponse`),
and it reports project-trust status in the response (does not deny). Reusing it is the
lowest-risk slice that lands cleanly on the transport-neutral boundary.

## Why we need it

- **Headless clients are skill-blind.** `pi-backend` knows the installed skills, but
  `/api/v1` exposes nothing to enumerate them.
- **Parity.** The UI lists skills via `web/lib/skills-service.ts` +
  `annotateSkillsWithInstallInfo`. The boundary must expose the same list.
- **Project scope.** Installed skills are cwd/project-scoped, like models.

## Effect

- A headless client can list installed skills (with install info, diagnostics, and the
  project-trust flag) over a clean HTTP boundary.
- `/api/v1` gains a real skill-management entry point; install/update/check/search +
  prompts follow.
- No UI coupling — the route depends only on the transport-neutral `pi-backend`.

## Implementation plan

1. **Contract types.** `web/packages/pi-backend/contracts.ts` gained
   `SkillsListInput` and re-exports the loader shapes `SkillInfo` / `SkillsResponse`
   (one-line re-export of `lib/api-types` types — keeps the wire contract
   transport-neutral; browser code reads the same shape without importing server
   runtime).
2. **Service.** New `web/packages/pi-backend/skills.ts`:
   `listSkillsFromServices(cwd?)` → `loadSkillsWithInstallInfo(cwd ?? process.cwd())`.
3. **Facade.** `web/packages/pi-backend/index.ts` — added
   `listSkills(input?: SkillsListInput): Promise<SkillsResponse>` to the `PiBackend`
   interface and impl, delegating to `listSkillsFromServices(input?.cwd)`.
4. **Route.** New `web/app/api/v1/skills/route.ts` (`dynamic = "force-dynamic"`):
   `GET` returns `apiSuccess(await getPiBackend().listSkills({ cwd }))`, `?cwd=`
   optional (parity with `GET /api/v1/models`). The loader reports trust in the
   response rather than probing/denying — no filesystem probe. Errors via
   `apiErrorResponse`.
5. **Client contract.** `web/lib/api-v1-client.ts` gained
   `listSkills(cwd?): Promise<SkillsResponse>` (GET; `?cwd=` when provided).
6. **Tests (TDD).** Facade-independent route test (`createV1Jiti` + facade stub) and a
   client test (decode + `ApiV1Error` error mapping). Keep the existing `.test.mjs`
   convention.

### Routes (this slice)

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/api/v1/skills` | List installed skills (optional `?cwd=`, trust reported) |
| `POST` | `/api/v1/skills/[op]` | `[op]` = `install | check | update | search` |
| `POST` | `/api/v1/sessions/[id]/model` | session model + thinking-level (ZOS-80) |

### Slice 2 — service

`web/packages/pi-backend/skills.ts` gained, on top of `listSkillsFromServices`:

- `installSkillFromServices` — project scope gated on `getAllowedFileRoots` +
  `isExistingFilePathAllowed` + `getProjectTrustStatus` (parity with
  `app/api/skills/install`); global scope runs without those checks; `runNpx`
  `skills add -y --agent pi`.
- `checkSkillUpdatesFromServices` — project scope gated on the file-access roots
  only; optional `package`/`scope` narrows to one install.
- `updateSkillFromServices` — project scope gated on the file-access roots;
  reloads install info after the `skills update`.
- `searchSkillsFromServices` — external `skills.sh` query with a `skills find`
  npx fallback; **no** project-trust gate (external catalog).

### Slice 2 — error contract

Six new `BackendError` codes mapped through `STATUS_BY_CODE` (`contracts.ts`,
`backend-error-response.ts`):

| Code | Status | Fired when |
|---|---|---|
| `cwd_required` | 400 | project op with no cwd |
| `skill_not_found` | 404 | update/check for a package not installed |
| `skill_install_failed` | 500 | `skills add` fails / no success regex |
| `skill_update_failed` | 500 | `skills update` fails |
| `skill_check_failed` | 500 | update-check network error |
| `skill_search_failed` | 500 | skills.sh down + no npx fallback results |

The route dispatches `invalid_request` (400) for an unknown `[op]` value.

### Deliverable

Skill-over-`/api/v1` listing + operations (install / check / update / search) and
client contract, backed by `web/lib/skills-service.ts`, `web/lib/skill-updates.ts`,
`web/lib/npx.ts`, `web/lib/file-access.ts`, `web/lib/project-trust.ts`.

## Ceiling (deliberate, follow-up)

Prompts management. Everything else — install / check / update / search — is in
this slice. Reuse the same scaffold (facade method → `getPiBackend()` →
transport-neutral route + `api-envelope` → client method → tests).

## Acceptance criteria

- [ ] Client can list installed skills via `/api/v1/skills` (parity with the in-app skill
      list, project-trust reported in the response, no filesystem probe).
- [ ] The route depends only on the transport-neutral `pi-backend`.
- [ ] Reads reflect installed skills + install info + diagnostics + trust flag.
- [ ] Errors surface with a wire `code` via the `api-error` envelope.
- [ ] No UI imports in the route handler or its call chain.

## Notes

- Repo: `zosma-cowork-headless-api`, branch `refactor/modular-pi-headless-api`.
- AGENTS.md TDD: write failing test first, watch it fail, implement minimal, watch it
  pass.
- Same shape as the streaming + session-model slices: facade method →
  `getPiBackend()` → transport-neutral route + `api-envelope` + client method.
- Test run: `node --experimental-strip-types --test "app/**/*.test.mjs"` (62 pass / 0
  fail) + `node --experimental-strip-types --test "packages/**/*.test.mjs"` (52 pass /
  0 fail) + `npx tsc --noEmit` (clean).
