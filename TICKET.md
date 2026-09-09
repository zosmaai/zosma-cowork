Extensions / skills / prompts management over /api/v1

Goal

Expose installed-skill management on the versioned `/api/v1` boundary so a
headless client can enumerate the skills installed for a project, with parity
to the in-app skill surface (`web/lib/skills-service.ts`, `app/api/skills/*`).
Follow-on slices (install / update / check / search, and prompts) build on the
same transport-neutral scaffold.

Context

The `pi-backend` package (`web/packages/pi-backend/`) owns the transport-neutral
`/api/v1` boundary (`web/app/api/v1/`). The in-app skill management surface
(`app/api/skills/install|update|check|search`) is RPC/process-bound — it spawns
`runNpx` to call `pi skills …`, imports `getAgentDir()` from the SDK, and gates
on filesystem `getAllowedFileRoots` / `isExistingFilePathAllowed` via `NextResponse`.
None of that is transport-neutral, so a headless client cannot enumerate the
skills installed for a project over `/api/v1`.

The loader-backed skill enumeration already exists in
`web/lib/skills-service.ts` (`loadSkillsWithInstallInfo(cwd)` → `SkillsResponse`)
and reports project-trust status in the response without denying. Reusing that
is the lowest-risk slice that lands cleanly on the transport-neutral boundary.

Details / Implementation

* Skill listing (this slice):
  * Facade method `listSkills(input?: SkillsListInput)` in
    `web/packages/pi-backend/index.ts` delegating to a new service
    `web/packages/pi-backend/skills.ts` (`listSkillsFromServices`) that calls
    `loadSkillsWithInstallInfo(cwd ?? process.cwd())`.
  * Route `GET /api/v1/skills` (`web/app/api/v1/skills/route.ts`), `force-dynamic`,
    optional `?cwd=` query (parity with `GET /api/v1/models`); the loader reports
    trust in the response rather than probing/denying — no filesystem probe.
  * Client method `listSkills(cwd?)` in `web/lib/api-v1-client.ts`.
  * Contract types `SkillsListInput` + re-exported `SkillInfo` / `SkillsResponse`
    in `web/packages/pi-backend/contracts.ts`.
  * Tests (TDD): facade-independent route test (jiti + facade stub) and client
    test (decode + `ApiV1Error` error mapping).
* No UI imports — the route depends only on the transport-neutral `pi-backend`.

* Skill operations (slice 2): `POST /api/v1/skills/[op]` with `[op]` in
  `install | check | update | search`, all gated and spawn-bound inside the
  pi-backend service `web/packages/pi-backend/skills.ts`:
  * `installSkillFromServices` — project scope gated on `getAllowedFileRoots`
    + `isExistingFilePathAllowed` + `getProjectTrustStatus` (parity with
    `app/api/skills/install`); global scope runs without those checks.
  * `checkSkillUpdatesFromServices` — project scope gated on the file-access
    roots only; optional `package`/`scope` narrows to one install.
  * `updateSkillFromServices` — project scope gated on the file-access roots;
    reloads install info after the `skills update`.
  * `searchSkillsFromServices` — external `skills.sh` query with a
    `skills find` npx fallback; **no** project-trust gate.
  * Route `web/app/api/v1/skills/[op]/route.ts`, `force-dynamic`, dispatches to
    the facade; unknown op → `400 invalid_request`.
  * Client methods `installSkill / checkSkillUpdates / updateSkill /
    searchSkills` in `web/lib/api-v1-client.ts`.
  * Contract types `SkillInstallInput | SkillCheckInput | SkillUpdateInput |
    SkillSearchInput` (+ responses) in `contracts.ts`; re-exported install/
    search/update result types from `web/lib/api-types.ts`.
  * Six new `BackendError` codes: `cwd_required`, `skill_not_found`,
    `skill_install_failed`, `skill_update_failed`, `skill_check_failed`,
    `skill_search_failed` (mapped through `STATUS_BY_CODE`).
  * Tests (TDD): facade-independent route test (jiti + facade stub) covering
    install/check/search success + unknown-op 400, a client test (decode +
    `ApiV1Error`), and a service-level test exercising the file-access gate
    (`access_denied`) + arg validation without spawning.

Repo: `zosma-cowork-headless-api` (branch `refactor/modular-pi-headless-api`).

Deliverables

Skill-over-/api/v1 listing + operations (install / check / update / search)
and client contract, backed by `web/lib/skills-service.ts`,
`web/lib/skill-updates.ts`, `web/lib/npx.ts`, `web/lib/file-access.ts`,
`web/lib/project-trust.ts`.

Acceptance Criteria

- [ ] Client can list installed skills via `GET /api/v1/skills` (parity with the
      in-app skill list, reports project-trust in the response).
- [ ] Client can install / check-for-updates / update / search skills via
      `POST /api/v1/skills/[op]`, with project-scoped installs gated on the
      filesystem roots + project-trust (no trust-less install of project skills).
- [ ] The routes depend only on the transport-neutral `pi-backend` (the
      handler chain exposes no spawn / filesystem gate; the service does).
- [ ] Reads reflect the installed skills + install info + diagnostics + trust flag.
- [ ] No UI imports in the route handler or its call chain.
- [ ] Errors surface with a wire `code` (e.g. `access_denied`, `cwd_required`)
      via the `api-error` envelope.

Ceiling:

* Prompts management (`app/api/prompts*` / `lib/prompts-*`).
* Search parsing (`parseSearchOutput` / `parseInstallCount`) is the last
  remaining surface of slice 2 and is exercised only by the route + client
  tests; a dedicated search-parsing unit test is the only open micro-item.

