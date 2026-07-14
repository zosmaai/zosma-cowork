# Changelog

All notable changes to Zosma Cowork are documented here.

## [unreleased]

### 🚀 Features

- *([#328](https://github.com/zosmaai/zosma-cowork/pull/328))* Surface actionable reason when a task fire cannot start a session
- *([#328](https://github.com/zosmaai/zosma-cowork/pull/328))* Reconcile interrupted task runs to failed on startup

### 🐛 Bug Fixes

- *(extensions)* Pin bundled npm global prefix to user home (EACCES / exit code 243) ([#331](https://github.com/zosmaai/zosma-cowork/pull/331))
- *([#328](https://github.com/zosmaai/zosma-cowork/pull/328))* Surface failed-run reason in RunDetailView (no-conversation case)
- *([#328](https://github.com/zosmaai/zosma-cowork/pull/328))* Propagate task-fire failures to scheduler so one-shots survive a failed fire
- Clippy for_kv_map lint

### 📖 Documentation

- Update Discord invite link across all READMEs ([#332](https://github.com/zosmaai/zosma-cowork/pull/332))
- Plan to close #328 failure-branch gap (callback failure propagation + retry cap)
- Before/after evidence for #328 failure-branch fix
- Comprehensive product roadmap + architecture diagrams ([#344](https://github.com/zosmaai/zosma-cowork/pull/344))

### ⚙️ Maintenance

- Update vendor.lock to real zosmaai/pi-routines v0.1.2 SHA
## [0.17.0] - 2026-07-08

### 🚀 Features

- *(slash-commands)* A2 built-in registry, HelpDialog, ModelSelector controlled open (#182, #322) ([#324](https://github.com/zosmaai/zosma-cowork/pull/324))

### 🐛 Bug Fixes

- Remove broken star-history section, move star CTA to bottom ([#321](https://github.com/zosmaai/zosma-cowork/pull/321))
- *(sidecar)* Auto-continue when model narrates mid-workflow ([#325](https://github.com/zosmaai/zosma-cowork/pull/325)) ([#326](https://github.com/zosmaai/zosma-cowork/pull/326))
- *(sessions)* Show conversation history even when context restore fails ([#323](https://github.com/zosmaai/zosma-cowork/pull/323))
- *(windows)* Bundle Node.js as node.exe so extensions/npm work ([#327](https://github.com/zosmaai/zosma-cowork/pull/327))

### ⚙️ Maintenance

- Switch npm package management to pnpm. added new install script ([#316](https://github.com/zosmaai/zosma-cowork/pull/316))
## [0.16.9] - 2026-07-06

### 🐛 Bug Fixes

- *(release)* Retry asset check with backoff for eventual consistency ([#318](https://github.com/zosmaai/zosma-cowork/pull/318))
## [0.16.8] - 2026-07-06

### 🐛 Bug Fixes

- *(ui)* New-chat chrome clipped at Large/Extra-Large font (zoom × 100vh overflow) ([#313](https://github.com/zosmaai/zosma-cowork/pull/313))
- *(windows)* Quote OAuth URL in open_url so cmd.exe can't truncate it ([#314](https://github.com/zosmaai/zosma-cowork/pull/314))
- *(extensions)* Install works with no system Node/npm (bare-machine verified) ([#317](https://github.com/zosmaai/zosma-cowork/pull/317))
- *(office-docs)* Correct OfficeCLI download URLs so doc creation actually works ([#315](https://github.com/zosmaai/zosma-cowork/pull/315))
## [0.16.7] - 2026-06-30

### 🐛 Bug Fixes

- *(gemini)* Skip provider registration when client secret is not configured ([#312](https://github.com/zosmaai/zosma-cowork/pull/312))

### ⚙️ Maintenance

- Format and lint all changed files via biome check --write ([#311](https://github.com/zosmaai/zosma-cowork/pull/311))
## [0.16.6] - 2026-06-26

### 🚀 Features

- Centered empty-state input + deterministic greeting (time/name/sessions) + top-pinned statusbar ([#310](https://github.com/zosmaai/zosma-cowork/pull/310))
## [0.16.5] - 2026-06-25

### 🐛 Bug Fixes

- *(chat)* Robust streaming + error handling, session-list race, configurable workspace dir ([#309](https://github.com/zosmaai/zosma-cowork/pull/309))

### 📖 Documentation

- Integrations roadmap — 33 connectors mapped across 7 departments ([#306](https://github.com/zosmaai/zosma-cowork/pull/306))
- Fumadocs website screenshots and content polish ([#308](https://github.com/zosmaai/zosma-cowork/pull/308))
## [0.16.4] - 2026-06-16

### 🚀 Features

- Apps platform — pi-native extensions + Discord + Google Workspace (scopes/BYO) with auto-install (#281,#296) ([#296](https://github.com/zosmaai/zosma-cowork/pull/296))
- *([#287](https://github.com/zosmaai/zosma-cowork/pull/287))* IA rename — Chats→Cowork, drop Templates, scaffold Tasks tab
- *([#288](https://github.com/zosmaai/zosma-cowork/pull/288))* Sidecar Tasks bridge — list/delete/set_enabled/run_now + change event
- *([#289](https://github.com/zosmaai/zosma-cowork/pull/289))* Tasks UI — TasksList + Task Detail page + first-run pi-routines setup
- *([#300](https://github.com/zosmaai/zosma-cowork/pull/300))* Task execution routing — Cowork fire handling + run history UI
- *(sidecar)* Vendor pi-routines by verified release tag, not a hardcoded SHA

### 🐛 Bug Fixes

- *([#300](https://github.com/zosmaai/zosma-cowork/pull/300))* Isolated per-run task sessions, persona/routines gating, live run UX
- *([#300](https://github.com/zosmaai/zosma-cowork/pull/300))* Vendor pi-routines fork into the sidecar bundle
- *([#300](https://github.com/zosmaai/zosma-cowork/pull/300))* Vendor pi-routines via fetch-vendor clone (gitignored vendor dir)
- *(security)* Bump vite 6.4.2 -> 6.4.3 to clear new dev-server advisories
- *(sidecar)* Bump pi-routines v0.1.0 -> v0.1.1 + harden Windows clone

### 📦 Other

- *([#286](https://github.com/zosmaai/zosma-cowork/pull/286))* Prove pi-routines durable cron fires into a live Cowork session

### 📖 Documentation

- *([#285](https://github.com/zosmaai/zosma-cowork/pull/285))* Spec Tasks tab via pi-routines ([#293](https://github.com/zosmaai/zosma-cowork/pull/293))
- *(tasks)* Correct stale pi-routines install comments ([#300](https://github.com/zosmaai/zosma-cowork/pull/300))
## [0.16.3] - 2026-06-14

### 🚀 Features

- Recent-chats sidebar UX + working custom instructions ([#277](https://github.com/zosmaai/zosma-cowork/pull/277))
- *(settings)* Grouped nav, Apps + merged Appearance, richer About ([#282](https://github.com/zosmaai/zosma-cowork/pull/282))
- *(google)* Backend OAuth token broker — no client secret on device ([#283](https://github.com/zosmaai/zosma-cowork/pull/283))
- *(google)* Branded OAuth callback page + hide Antigravity option ([#280](https://github.com/zosmaai/zosma-cowork/pull/280))
- *(oauth-broker)* Production broker + release-build wiring ([#284](https://github.com/zosmaai/zosma-cowork/pull/284))
## [0.16.2] - 2026-06-13

### 🚀 Features

- *([#271](https://github.com/zosmaai/zosma-cowork/pull/271))* In-app auto-update (Tauri v2 updater) ([#273](https://github.com/zosmaai/zosma-cowork/pull/273))

### 🔄 Refactor

- *([#272](https://github.com/zosmaai/zosma-cowork/pull/272))* Add missing @theme utilities + migrate exact inline token styles ([#275](https://github.com/zosmaai/zosma-cowork/pull/275))

### ⚙️ Maintenance

- *([#272](https://github.com/zosmaai/zosma-cowork/pull/272))* Add ratcheting guardrail for inline token-color styles ([#274](https://github.com/zosmaai/zosma-cowork/pull/274))
## [0.16.1] - 2026-06-13

### 🚀 Features

- *([#268](https://github.com/zosmaai/zosma-cowork/pull/268))* Always-on status line — tokens/cache/cost, context %, thinking level ([#270](https://github.com/zosmaai/zosma-cowork/pull/270))
- *([#267](https://github.com/zosmaai/zosma-cowork/pull/267))* Chat session management — deep search, rename, in-thread find, pin ([#269](https://github.com/zosmaai/zosma-cowork/pull/269))
## [0.16.0] - 2026-06-13

### 🚀 Features

- *([#263](https://github.com/zosmaai/zosma-cowork/pull/263))* Give Cowork self-knowledge (progressive disclosure) ([#266](https://github.com/zosmaai/zosma-cowork/pull/266))
- "Sign in with Google" provider for Gemini (Antigravity / Code Assist) ([#260](https://github.com/zosmaai/zosma-cowork/pull/260))

### 🐛 Bug Fixes

- *([#261](https://github.com/zosmaai/zosma-cowork/pull/261))* Count custom local providers in has_credentials ([#262](https://github.com/zosmaai/zosma-cowork/pull/262))

### 📖 Documentation

- Replace Made in India badge with Discord invite across all READMEs ([#210](https://github.com/zosmaai/zosma-cowork/pull/210))
- Fix stale 'failing' Release badge across all READMEs
- Add Platforms + Tauri badges, Citation section, and CITATION.cff
- Credit actual contributors in citation (CITATION.cff + BibTeX)
- Add Design Studio roadmap (adapt Open Design into Cowork) ([#259](https://github.com/zosmaai/zosma-cowork/pull/259))

### ⚙️ Maintenance

- *([#264](https://github.com/zosmaai/zosma-cowork/pull/264))* Gate npm audit via audit-ci with allowlist for esbuild GHSA ([#265](https://github.com/zosmaai/zosma-cowork/pull/265))
## [0.15.2] - 2026-06-10

### 🚀 Features

- *(201)* Wire steer / follow_up commands through sidecar + Tauri (PR 1)
- *([#201](https://github.com/zosmaai/zosma-cowork/pull/201))* Composer Enter=steer / Alt+Enter=follow-up while streaming (PR 2)
- *([#201](https://github.com/zosmaai/zosma-cowork/pull/201))* Show queued steer/follow-up bubbles + Ctrl+↑ edit queue (PR 3 of 3)
- *(ui)* Custom background wallpaper (Aurora / Color / Image) — #191
- Slash-command palette + built-in commands

### 🐛 Bug Fixes

- *([#201](https://github.com/zosmaai/zosma-cowork/pull/201))* Pi-style threaded queue + integrated composer + auto-focus
- *(extensions)* Defer to pi-managed npm packages, prevent duplicate drop-in
- *([#207](https://github.com/zosmaai/zosma-cowork/pull/207))* Add Custom Local LLM provider for OpenAI-compatible endpoints ([#208](https://github.com/zosmaai/zosma-cowork/pull/208))

### 🎨 Styling

- *([#201](https://github.com/zosmaai/zosma-cowork/pull/201))* Apply cargo fmt to clear_queue payload test assertion
## [0.15.1] - 2026-06-08

### 🚀 Features

- Render pi extension ctx.ui dialogs in the desktop UI
- Use Zosma (Delta Leonis) logo as desktop app icon
- *(store)* App-store style Extensions & Skills marketplaces
- *(integrations)* Author google_calendar pi-extension (B4 #188)
- *(integrations)* Author google_calendar pi-extension (B4 #188)
- Google OAuth auth broker with B2 config-routing and B3 setup UI (#186 #187)
- Google OAuth auth broker — B2 config-routing + B3 setup UI (#186 #187)
- *(ui)* Readable markdown, width switcher, brand logo & user avatars
- *(ui)* Add user-facing font size control (Small/Normal/Large/XL) in Theme settings
- *(ui)* Brand-matched (zosma.ai) glass theme variant — light + dark

### 🐛 Bug Fixes

- *(release)* Tolerate tag prefix in packaging; require v-tag to release
- *(calendar)* Replace scope.includes with split+exact match to resolve CodeQL alert
- Scope check uses split+exact match instead of .includes()
- *(ui)* Contain message bg to column, external links to browser, rework width presets
- *(security)* Use scheme allowlist for external links (CodeQL)

### 📖 Documentation

- *(ui)* Real built-app screenshots + live chat demo for brand-blue variant
- Refresh demo.gif/.mp4 with new recorded walkthrough

### ⚙️ Maintenance

- Vendor agent skill bundles for accurate Linguist stats
## [0.15.0] - 2026-06-06

### 🚀 Features

- *(sidecar)* Reload pi session on resume to pick up new extensions ([#164](https://github.com/zosmaai/zosma-cowork/pull/164))
- *(auth)* Inherit pi credentials when Cowork has none configured
- Per-session workspace folder instead of inherited process.cwd()
- Persist per-session workspace cwd; default workspace to home
- New session asks for a folder; show each session's path
- Render pi extension ctx.ui dialogs in the desktop UI
- *(extensions)* Bespoke Discord setup screen for pi-messenger-bridge
- *(chat)* Perplexity-style activity view ([#173](https://github.com/zosmaai/zosma-cowork/pull/173))

### 🐛 Bug Fixes

- *(ci)* Trigger AUR/Winget/Homebrew on Release workflow completion ([#158](https://github.com/zosmaai/zosma-cowork/pull/158))
- *(sidecar)* Restore usage/stopReason on session resume ([#162](https://github.com/zosmaai/zosma-cowork/pull/162))
- *(sidecar)* Share pi's extensions & skills (~/.pi/agent) — closes #147
- *(sidecar)* Load pi's disk/npm extensions in the bundle via virtualModules ([#147](https://github.com/zosmaai/zosma-cowork/pull/147))
- *(sidecar)* Regenerate lockfile to include optional transitive deps
- *(sidecar)* Don't block stdin loop on prompt so abort works mid-generation
- *(ui)* Show loading splash during startup instead of onboarding flash
- *(ui)* Detect Tauri via window.isTauri, not window.__TAURI__
- *(telemetry)* Persist consent (merge settings) and ask on first launch
- *(ipc)* Unique request ids so concurrent get_settings stop colliding
- *(onboarding)* Base has_credentials on authenticated providers, not model catalog
- *(ui)* Mirror engine model in selector + friendly per-message labels
- Never-ending "thinking" + wrong provider binding for colliding ids
- Prompt templates fill the composer instead of auto-sending
- *(chat)* Club one agent run into a single bubble + live activity ([#173](https://github.com/zosmaai/zosma-cowork/pull/173))

### 🎨 Styling

- *(tauri)* Satisfy cargo fmt in save_settings ([#169](https://github.com/zosmaai/zosma-cowork/pull/169))
- Cargo fmt new_session signature

### 🧪 Testing

- *(sidecar)* Extract promptScheduler + regression tests for mid-gen abort

### ⚙️ Maintenance

- *(dev)* Auto-generate Tauri bundle-resource stubs for `tauri dev`
- *(staging)* Skip PR sticky comment on fork PRs
- *(staging)* Make fork-PR staging notifications work via workflow_run
## [0.14.0] - 2026-06-04

### 🚀 Features

- Whole themeing rebranding

### 🐛 Bug Fixes

- *(tests)* Align tests with refactored MessageInput, ShareExport, SuggestedActions
- *(auth)* Stop hardcoding `opencode-go` when saving API keys ([#150](https://github.com/zosmaai/zosma-cowork/pull/150))

### ⚙️ Maintenance

- *(staging)* Trigger on PR `staging` label instead of push-to-main
- *(sidecar)* Drop unused pi-agent-core dep, document pi-ai subpath
## [0.13.1] - 2026-06-01

### 🐛 Bug Fixes

- *(ci)* Publish release only after all assets upload (closes #145)
## [0.13.0] - 2026-06-01

### 🚀 Features

- *(ci)* Staging build on every merge to main (closes #133)

### 🐛 Bug Fixes

- *(chat)* Enable auto-compaction (closes #135)
- *(branding)* Brand sidecar with a Zosma system prompt (closes #112)
- *(ci)* Skip staging Discord notification on cancelled runs (closes #138)
- *(windows)* Root-cause os error 232 release crash + observability
- Cargo fmt
- *(ci)* Staging-build collects bundles from workspace target dir (closes #143)

### ⚙️ Maintenance

- *(staging)* Switch notify channel from email (SMTP) to Discord webhook
- *(staging)* Linkify #N PR refs in the Discord embed description
## [0.12.2] - 2026-05-31

### 🚀 Features

- *(phase-6)* Remote phone access — embedded HTTP/WS server in sidecar
- *(phase-6)* Rust Tauri commands + Remote Access Settings UI
- *(phase-6.1)* Mobile web app with remote API + scroll fix
- Add AUR auto-update workflow on release
- Separate mobile OTP app at /m/ with glossy UI
- Add star history, contributors, and star-request banner to README
- Replace ASCII architecture diagram with Mermaid flowchart
- Replace Mermaid code block with rendered architecture image
- Center README titles, sync all 9 translated READMEs with English structure
- Add logo below title in all READMEs

### 🐛 Bug Fixes

- Sidebar tab bar hidden by long session list
- Mobile browser scroll + remote access docs
- Revert desktop layout breakage + fix mobile app JS syntax
- AI not responding via mobile + desktop layout + connection tracking
- *(mobile)* PIN keeps its value after verify, fix SSE URL with query params, fix status counting
- *(mobile)* Handle pi-agent SDK event format in handleEvent
- *(remote)* Persist remote session to shared store + render markdown on mobile
- Unbiased cryptographically secure PIN generation (fixes CodeQL warning)
- Quote on: key in AUR workflow to avoid YAML boolean parsing
- Add onKeyDown handler to mobile backdrop for a11y lint compliance
- Use printf instead of heredoc to avoid YAML block scalar breakage
- Use git clone instead of ssh clone for AUR
- Mobile CSS missing Tailwind + routing '/m' prefix too broad
- Mobile chat message + SSE event format + model switching
- Humble tone — no more 'first' claims, simpler star callout with spacing
- Remove comparison table, slop sections, and 'first' claims from README
- Language bar inside <div align=center> must use HTML <a> tags
- *(windows)* Make Vite ignore workspace-level target/ in dev
- *(windows)* Sidecar spawn, ZOSMA_DIR, open_url
- *(react)* Async-cleanup race fires OAuth browser open N times
- *(openai-codex)* Use 'codex_cli_rs' originator on OAuth

### 📖 Documentation

- Comprehensive CONTRIBUTING.md with dev setup, architecture, and troubleshooting

### 🎨 Styling

- Cargo fmt --all on Windows-cfg blocks

### 🧪 Testing

- *(agent-sidecar)* Add vitest infrastructure and TDD tests for extractChatMessages

### ⚙️ Maintenance

- Update package-lock.json for vite-plugin-pwa
- Update star-request banner image
## [0.12.1] - 2026-05-24

### 🐛 Bug Fixes

- *(sidecar)* Pass --use-system-ca to bundled Node so OAuth works behind corporate TLS interception
- Resolve Arch build failure, add version display, update tagline

### 🎨 Styling

- Fix cargo fmt in find_sidecar_path
## [0.12.0] - 2026-05-21

### 🚀 Features

- Add set-element tool for Office document generation
- Add batch-edit tool for Office document generation
- Add OfficeCLI binary resolver with auto-download
- Add OfficeCLI binary resolver with auto-download ([#91](https://github.com/zosmaai/zosma-cowork/pull/91))
- Add shared types, OfficeCLI executor, and tool parameter schemas
- Add shared types and OfficeCLI executor ([#92](https://github.com/zosmaai/zosma-cowork/pull/92))
- Add create_document tool for pi extension
- Add add_element tool for populating documents
- Add create_document tool ([#93](https://github.com/zosmaai/zosma-cowork/pull/93))
- Add add_element tool for populating documents
- Add add_element tool ([#94](https://github.com/zosmaai/zosma-cowork/pull/94))
- Add set-element-tool tool ([#95](https://github.com/zosmaai/zosma-cowork/pull/95))
- Add validate-document tool for Office document generation
- Add validate-document-tool tool ([#98](https://github.com/zosmaai/zosma-cowork/pull/98))
- Add read-document tool for Office document generation
- Add read-document-tool tool ([#97](https://github.com/zosmaai/zosma-cowork/pull/97))
- Add remove-element tool for Office document generation
- Add remove-element-tool tool ([#96](https://github.com/zosmaai/zosma-cowork/pull/96))
- Add batch-edit-tool tool ([#99](https://github.com/zosmaai/zosma-cowork/pull/99))
- Add preview-document tool for Office document generation
- Add preview-document-tool tool ([#100](https://github.com/zosmaai/zosma-cowork/pull/100))
- Register all 8 OfficeCLI tools as pi extension in sidecar
- Register all 8 OfficeCLI tools as pi extension in sidecar ([#101](https://github.com/zosmaai/zosma-cowork/pull/101))
- Add office-docs SKILL.md with design rules and workflow
- Add office-docs SKILL.md with design rules and workflow ([#102](https://github.com/zosmaai/zosma-cowork/pull/102))
- Add 4 Office document template packs with JSON schema
- Add 4 Office document template packs with JSON schema ([#104](https://github.com/zosmaai/zosma-cowork/pull/104))
- Add DocumentsPanel UI component
- Add DocumentsPanel UI component ([#105](https://github.com/zosmaai/zosma-cowork/pull/105))

### 🐛 Bug Fixes

- Update winget manifest generation to multi-file v1.12.0 format
- Satisfy Biome lint rules (useTemplate, noUnusedImports)
- Resolve CodeQL security alerts - use execFileSync
- Satisfy Biome lint rules (useTemplate, noUnusedImports)
- Resolve CodeQL security alerts in officecli-resolver - use execFileSync
- Satisfy Biome lint rules (useTemplate, noUnusedImports)
- Resolve CodeQL security alerts - use execFileSync
- Satisfy Biome lint rules (useTemplate, noUnusedImports)
- Resolve CodeQL security alerts - use execFileSync
- Satisfy Biome lint rules (useTemplate, noUnusedImports)
- Resolve CodeQL security alerts - use execFileSync
- Satisfy Biome lint rules (useTemplate, noUnusedImports)
- Resolve CodeQL security alerts - use execFileSync
- Satisfy Biome lint rules (useTemplate, noUnusedImports)
- Resolve CodeQL security alerts - use execFileSync
- Restore tool files dropped during rebase merge of stacked PRs
- Satisfy Biome lint rules (useTemplate, noUnusedImports)
- Resolve CodeQL security alerts - use execFileSync
- Restore tool files lost from stacked PR branches during merge
- *(sidecar)* Add prompt timeout and provider timeout to prevent hanging sessions
- *(v0.11)* Resolve all three OAuth sign-in regressions

### 📖 Documentation

- Add Phase 5 — Office Document Generation to MVP roadmap
- Add detailed shipping plan for Office Document Generation

### ⚙️ Maintenance

- Exclude agent-sidecar from Biome lint
- Exclude agent-sidecar from Biome lint
- Exclude agent-sidecar from Biome lint
- Exclude agent-sidecar from Biome lint
- Exclude agent-sidecar from Biome lint
- Exclude agent-sidecar from Biome lint
- Exclude agent-sidecar from Biome lint
- Exclude agent-sidecar from Biome lint
- Add src-tauri/binaries/node to gitignore
- Fetch bundled Node.js before the Tauri build check
## [0.11.3] - 2026-05-19

### 🐛 Bug Fixes

- Resolve Windows sidecar, code-signing, winget, and browser-download issues
- Pin dtolnay/rust-toolchain to @master (stable tag is stale)
- Replace dtolnay/rust-toolchain action with direct rustup install
- Remove unneeded return statements (clippy warning)
- Rewrite winget manifest generation to avoid YAML heredoc conflict

### 🎨 Styling

- Cargo fmt
## [0.11.2] - 2026-05-18

### 🐛 Bug Fixes

- Use vendored-openssl for git2 to enable macOS universal binary cross-compilation
## [0.11.1] - 2026-05-18

### 🐛 Bug Fixes

- Remove pnpm-lock.yaml to fix release build detection
## [0.11.0] - 2026-05-18

### 🚀 Features

- Telemetry & crash reporting (Aptabase + Sentry, opt-in) ([#71](https://github.com/zosmaai/zosma-cowork/pull/71))
- Switch to @sentry/react with React 19 error handler ([#72](https://github.com/zosmaai/zosma-cowork/pull/72))
- Prompt Templates sidebar panel ([#73](https://github.com/zosmaai/zosma-cowork/pull/73))
- Skills Search & Install panel with sidecar commands ([#74](https://github.com/zosmaai/zosma-cowork/pull/74))
- Inline response feedback with thumbs up/down ([#75](https://github.com/zosmaai/zosma-cowork/pull/75))
- In-app feedback submission dialog ([#76](https://github.com/zosmaai/zosma-cowork/pull/76))
- Conversation search in sidebar ([#77](https://github.com/zosmaai/zosma-cowork/pull/77))
- Custom instructions / persona in settings ([#78](https://github.com/zosmaai/zosma-cowork/pull/78))
- Share conversations and share the app ([#79](https://github.com/zosmaai/zosma-cowork/pull/79))
- Full-page settings with 3-tab sidebar ([#80](https://github.com/zosmaai/zosma-cowork/pull/80))
- Two-column settings layout, Solarized Dark default, 5 new themes, warmer Zosma Light ([#81](https://github.com/zosmaai/zosma-cowork/pull/81))
- Rich skill cards with ExtensionCard/ExtensionDetail, fix sidecar bundle ([#82](https://github.com/zosmaai/zosma-cowork/pull/82))
- Bundle Node.js binary via Tauri sidecar for self-contained distribution
- Migrate skill management to Rust with cross-directory scanning

### 🐛 Bug Fixes

- Replace broken tauri-plugin-aptabase with in-house analytics module
- .env loading, build.rs warning, and telemetry settings race condition
- Replace npx skills find/list with direct API + disk reads
- Search_skills returns bare array from Rust, frontend was expecting {results} wrapper
- Use Tauri shell.open() instead of <a target="_blank"> for external links
- Construct proper skills.sh URLs from API data, add error handling to openUrl
- Add URL scope to shell:allow-open capability
- Replace @tauri-apps/plugin-shell with invoke('open_url') to open external links
- Copy typebox alongside sidecar bundle so extension loading works
- Run prebuild.mjs in beforeDevCommand and register typebox as Tauri resource
- Prefer tsx in debug builds so typebox resolves from node_modules
- Skills search returns nothing - frontend/Rust data format mismatch ([#83](https://github.com/zosmaai/zosma-cowork/pull/83))
- Copy typebox in CI workflow for Tauri build check
- Create node_modules dir before copying typebox in CI workflow
- Use prebuild.mjs in CI instead of duplicating build logic
- Remove typebox from tauri resources and prebuild to fix CI
- Retry on 'closed' IPC error with exponential backoff to handle sidecar startup race
- Use ** operator instead of Math.pow to satisfy biome lint
- Resolve CI lint and clippy failures

### 🔄 Refactor

- Extract retryOnClosed to utils with resilient error matching

### ⚙️ Maintenance

- Configure env vars for Aptabase + Sentry (build.rs reads .env, CI secrets)
## [0.10.0] - 2026-05-15

### 🚀 Features

- Inline artifact previews with Open Folder action ([#64](https://github.com/zosmaai/zosma-cowork/pull/64))
- Quick File Picker with native OS dialog and file chip UI ([#66](https://github.com/zosmaai/zosma-cowork/pull/66))
- Suggested Actions quick-start cards on empty state ([#67](https://github.com/zosmaai/zosma-cowork/pull/67))
- Export actions per message (Copy, Save, Open Folder) ([#68](https://github.com/zosmaai/zosma-cowork/pull/68))
- Screenshot paste detection with image preview in composer ([#69](https://github.com/zosmaai/zosma-cowork/pull/69))
- Bundle pi-anthropic-messages bridge so Claude Pro/Max OAuth works
- Pi-anthropic-messages bridge for Claude Pro/Max OAuth ([#70](https://github.com/zosmaai/zosma-cowork/pull/70))

### 🐛 Bug Fixes

- Navigate to chat after OAuth, dismissible Connect modal, refined Skip/Continue affordance
- Pin @tauri-apps/api to ~2.10.0 to match Rust tauri crate version

### 📖 Documentation

- Telemetry design doc (Aptabase + Sentry, opt-in, single toggle)

### ⚙️ Maintenance

- Add .worktrees to gitignore
- Extract inline HomeView handlers in App.tsx into named useCallback functions ([#65](https://github.com/zosmaai/zosma-cowork/pull/65))
## [0.9.4] - 2026-05-14

### 🚀 Features

- Add India-first branding across README, app UI, and metadata
- Add demo video, Why section with comparison table, help-non-tech messaging
- Rename Demo → Gallery, link to website gallery instead of raw mp4

### 🐛 Bug Fixes

- Prevent keychain auto-lock during macOS universal builds
- Replace <video> tags with clickable screenshot thumbnails for reliable GitHub rendering
- Embed GIF demo (249KB) instead of HTML video tag for reliable GitHub rendering; remove Bengaluru from all README footers
- Replace <video> tags with inline GIF demo; remove Bengaluru from all README footers
- Full-width GIF demo, add screenshot back to Demo section across all READMEs
## [0.9.3] - 2026-05-14

### 🚀 Features

- Add Claude Pro/Max subscription (OAuth) as a provider
- Wire all 3 OAuth providers, redesign onboarding flow
## [0.9.2] - 2026-05-14

### ⚙️ Maintenance

- Switch to universal macOS build (--target universal-apple-darwin)
## [0.9.1] - 2026-05-14

### ⚙️ Maintenance

- Disable macOS-x64 build, keep only Apple Silicon
## [0.9.0] - 2026-05-13

### 🐛 Bug Fixes

- Auto-publish releases instead of draft
## [0.8.6] - 2026-05-13

### 🐛 Bug Fixes

- Update PKGBUILD to v0.8.3 with correct artifact names
- Update PKGBUILD sha256 for v0.8.3
- Release name should just be tag name
- Remove libjavascriptcoregtk-4.1 from PKGBUILD deps
- Properly extract .deb contents in PKGBUILD
- Disable notarization, only sign macos builds
- Find sidecar at /usr/lib/zosma-cowork/ on distro packages
- Re-enable notarization with 90min timeout
## [0.8.3] - 2026-05-13

### 🐛 Bug Fixes

- Add timeout-minutes to release builds, prevent stale jobs
## [0.8.2] - 2026-05-13

### 🐛 Bug Fixes

- Remove secrets reference from if: condition in release.yml
## [0.8.1] - 2026-05-13

### 🚀 Features

- Add certificate import step to release workflow

### 🐛 Bug Fixes

- Make homebrew dispatch gracefully handle 403 (homebrew-tap now uses cron)
- Disable macOS codesigning when no identity configured (use '-' to skip)
- Graceful homebrew dispatch + disable macOS codesigning when unconfigured ([#49](https://github.com/zosmaai/zosma-cowork/pull/49))
- Cargo fmt formatting in lib.rs

### ⚙️ Maintenance

- Fix macos issue. update agent-sidecar dependencies, remove unnecessary peer flags, and improve prebuild script logging
## [0.8.0] - 2026-05-12

### 🚀 Features

- Dispatch release events to homebrew-tap for automatic cask updates ([#45](https://github.com/zosmaai/zosma-cowork/pull/45))
- Add AUR PKGBUILD, update distribution guide with completed channels ([#46](https://github.com/zosmaai/zosma-cowork/pull/46))
- Add code signing support (macOS notarization + Windows signing) ([#47](https://github.com/zosmaai/zosma-cowork/pull/47))

### 🔄 Refactor

- Rename product to zosma-cowork (simplified naming) ([#48](https://github.com/zosmaai/zosma-cowork/pull/48))
## [0.7.0] - 2026-05-12

### 🚀 Features

- Extensions tab, theme system, streaming fix, tool rendering improvements

### 🐛 Bug Fixes

- Lint errors - a11y keyboard handlers, SVG title, optional chaining, template literals
- Cargo fmt formatting in lib.rs
## [0.6.0] - 2026-05-10

### 🐛 Bug Fixes

- TUI status, timer, session naming, Ctrl+O expand, and granular tool labels
## [0.5.1] - 2026-05-10

### 🐛 Bug Fixes

- Duplicate messages, model not applied, provider info in UI, AppImage build
- Onboarding screen shows every launch, add debug logging for model
- Clippy CI fails - inline package.json instead of bundling
## [0.5.0] - 2026-05-09

### 🐛 Bug Fixes

- Use node instead of sed for import_meta.url patch (BSD sed incompatibility)
## [0.4.6] - 2026-05-09

### 🐛 Bug Fixes

- Bundle agent-sidecar with esbuild into single self-contained CJS file
## [0.4.5] - 2026-05-09

### 🐛 Bug Fixes

- Bundle agent-sidecar dist and resolve path at runtime via resource_dir
- Copy sidecar into src-tauri/agent-sidecar/ for bundled resource
- Use agent-sidecar/* instead of agent-sidecar/** for Tauri resource glob
- Build agent-sidecar in CI tauri job too (resource glob validation needs dist files)
- Use node script for prebuild (cross-platform, works on Windows cmd)

### ⚙️ Maintenance

- Add assets/screenshot.png
## [0.4.4] - 2026-05-09

### 🐛 Bug Fixes

- Set shell:bash for version injection step (Windows uses PowerShell by default)
## [0.4.2] - 2026-05-09

### 🐛 Bug Fixes

- Use portable Node.js scripts instead of sed for version injection
## [0.4.1] - 2026-05-09

### 🐛 Bug Fixes

- Use release tag version in builds and settings UI
- Properly propagate sidecar error id to unblock pending requests
## [0.4.0] - 2026-05-08

### 🚀 Features

- Sidebar settings tab, remove broken header selector, fix edit diff via details.diff

### 🐛 Bug Fixes

- Restore session context into pi-mono session on load_session for agent continuity
## [0.3.2] - 2026-05-08

### 🚀 Features

- Flat tool timeline with side-by-side diff, compact thinking block, instant scroll
- Hide read content, collapse diff context, fix scroll on tool changes, new file single column
## [0.3.1] - 2026-05-08

### 🚀 Features

- Session sidebar, tool timeline v2, status bar, and settings persistence

### ⚙️ Maintenance

- Fix lint, fmt, and type errors
## [0.3.0] - 2026-05-08

### 🚀 Features

- Migrate from Rust pi_agent_rust to TypeScript pi-mono SDK ([#30](https://github.com/zosmaai/zosma-cowork/pull/30))
## [0.2.4] - 2026-05-03

### 🚀 Features

- Add Node.js sidecar for Pi extension compatibility (Phase 3) ([#25](https://github.com/zosmaai/zosma-cowork/pull/25))
- Add @zosmaai/zosma-slides native extension package (Phase 4) ([#26](https://github.com/zosmaai/zosma-cowork/pull/26))
- Phase 5 - integrate extension tools into MetaAgents with sidecar auto-discovery ([#28](https://github.com/zosmaai/zosma-cowork/pull/28))

### 🐛 Bug Fixes

- Populate model dropdown after saving API key ([#27](https://github.com/zosmaai/zosma-cowork/pull/27))
## [0.2.3] - 2026-05-02

### 🚀 Features

- Add opt-in anonymous telemetry integration ([#21](https://github.com/zosmaai/zosma-cowork/pull/21))
- Add slide generation engine + integration spec ([#22](https://github.com/zosmaai/zosma-cowork/pull/22))
- Add Rust extension installer backend (Phase 1) ([#23](https://github.com/zosmaai/zosma-cowork/pull/23))
- Add ExtensionManager UI (Phase 2) ([#24](https://github.com/zosmaai/zosma-cowork/pull/24))

### 🐛 Bug Fixes

- Update GitHub discussions link to zosma-cowork repo
## [0.2.2] - 2026-05-02

### 🚀 Features

- Onboarding flow + independent ~/.zosmaai/ config directory
- Complete rebrand from pi-cowork to Zosma Cowork

### 🐛 Bug Fixes

- Ci lint and format failures
- Remove pi CLI prerequisite and correct all data paths to ~/.zosmaai/
- Update release CI tag patterns and rename to Zosma Cowork

### 📦 Other

- Pi Cowork → Zosma Cowork
## [0.2.0] - 2026-05-01

### 🚀 Features

- *(phase-a)* Scaffold cargo workspace with metaagents engine crate
- *(phase-b)* Wire pi_agent_rust SDK into metaagents engine
- *(phase-c)* Implement metaagents engine skeleton
- *(phase-d)* Replace pi subprocess with in-process metaagents engine
- *(settings)* Add extensions section with loaded extension cards
- *(settings)* Add models section with expandable provider/model list
- *(composer)* Add model selector dropdown to message input
- *(app)* Wire providers hook and model selector to chat view

### 🐛 Bug Fixes

- *(clippy)* Resolve CI lint failures

### 📖 Documentation

- Add MetaAgents upgrade plan (pi-cowork → in-process pi_agent_rust SDK)
- Update all READMEs to reflect metaagents engine architecture
- Add Phase E implementation plan

### 🎨 Styling

- Cargo fmt --all
- Cargo fmt --all (CI formatting fix)

### ⚙️ Maintenance

- Run rust workflows from workspace root
## [0.1.6] - 2026-04-29

### 🚀 Features

- Premium chat UX — theme system, tool timeline, status bar, skeleton
## [0.1.5] - 2026-04-29

### 🚀 Features

- Add session store with JSONL persistence via @tauri-apps/plugin-fs
- Add useSessions hook
- Extract sidebar into reusable components (Sidebar, SessionList, SessionItem, NavIcons)
- Add ChatView, TasksView, SettingsView components
- Live RightPanel with tool calls + wire session persistence
- Add session store with JSONL persistence via @tauri-apps/plugin-fs
- Add useSessions hook
- Extract sidebar into reusable components (Sidebar, SessionList, SessionItem, NavIcons)
- Add ChatView, TasksView, SettingsView components
- Live RightPanel with tool calls + wire session persistence
- Session persistence, chat history, auto-scroll, collapsible tool calls
- Remove dead ActivityBar, improve composer, add keyboard shortcuts

### 🐛 Bug Fixes

- Rewrite usePiStream with useReducer to eliminate race conditions
- Stream completion (agent_end), session overwrite, load history on click
- Lint/type errors in tests, add DirEntry mocks, fix ChatMessage import
- Auto-create session ID on first send, use ref for persistence timing
- Stream handler bugs — toolcall_end crash, stderr deadlock, multi-turn, error handling
- Rewrite usePiStream with useReducer to eliminate race conditions
- Stream completion (agent_end), session overwrite, load history on click
- Lint/type errors in tests, add DirEntry mocks, fix ChatMessage import
- Auto-create session ID on first send, use ref for persistence timing
- Stream handler bugs — toolcall_end crash, stderr deadlock, multi-turn, error handling

### 🔄 Refactor

- Restructure App.tsx into 3-column layout with nav icons
- Restructure App.tsx into 3-column layout with nav icons

### 📖 Documentation

- Cowowrk MVP v1 design document
- MVP roadmap and Phase 0 implementation plan
- Cowowrk MVP v1 design document
- MVP roadmap and Phase 0 implementation plan
## [0.1.0] - 2026-04-28

### 🚀 Features

- Add Radix-based Tooltip primitive with full test coverage
- Streaming events, thinking/tool call UI, Claude-style layout

### 📖 Documentation

- Add AGENTS.md with engineering standards and TDD rules

### 🎨 Styling

- Rustfmt

### ⚙️ Maintenance

- Initial pi-cowork scaffold with Tauri v2 + React
- Add testing infra (Vitest) and CI/CD workflows
- Fix all lint errors, add biome ignores for React hook false positives
- Rename default branch master → main
- Fix rust-action → rust-toolchain in all workflows
- Add screenshot, LICENSE, CoC, CONTRIBUTING, SECURITY, DISTRIBUTION
