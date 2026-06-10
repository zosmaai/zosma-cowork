# Zosma Cowork — Design Studio Roadmap

> Adapting the best ideas from [Open Design](https://github.com/nexu-io/open-design) (`nexu-io/open-design`, Apache 2.0) into Zosma Cowork.
>
> Status: **Proposal / RFC** · Owner: TBD · Last updated: 2026-06-11

---

## 1. Executive summary

Open Design (OD) is "the open-source Claude Design alternative" — a desktop app that turns a coding agent into a **design studio**: type a brief, pick a brand + a skill, and stream out a real-CSS prototype / deck / image, previewed live in a sandboxed iframe and exported to HTML / PDF / PPTX / MP4.

The single most important finding: **OD has no proprietary design model and no proprietary engine.** Its daemon literally spawns whatever coding-agent CLI you have (Claude Code / Codex / Gemini / …) and feeds it a composed prompt:

```
BASE_SYSTEM_PROMPT  (output contract: wrap result in <artifact>, real CSS, no fences)
  + active DESIGN.md   (the brand contract — palette / type / layout)
  + craft/*.md         (universal, brand-agnostic "don't make AI slop" rules)
  + active SKILL.md    (the workflow for this artifact type)
```

The agent writes files; OD renders them in a sandboxed iframe and wires export. **That's the whole trick.** Everything that makes OD feel magical decomposes into portable pieces:

| OD asset | Nature | Portability into Cowork |
|---|---|---|
| 100+ **skills** (`SKILL.md`) | Markdown + frontmatter | **Drop-in** — same format pi/Cowork already load |
| ~150 **design systems** (`DESIGN.md`) | Markdown (9-section schema) | **Drop-in** content |
| **craft** references | Markdown | **Drop-in** content |
| **Prompt composition** | A convention | Re-implementable in the sidecar (~1 file) |
| `<artifact>` **streaming + iframe preview** | Frontend feature | **Cowork already has `ArtifactPreview` + sandboxed iframe** |
| **Export** (HTML/PDF/PPTX) | Pipelines | **Cowork already has** `preview_export` (PDF/HTML/PNG) + `office-docs` (PPTX) |
| MP4 / HyperFrames | Headless render pipeline | The only true gap — defer |

**Strategic conclusion: absorb, don't embed.** Bundling OD's 1.4 GB Electron+Next.js daemon next to Cowork (or bridging to its MCP server — pi has no native MCP client) is heavy and a poor product direction. Because OD's value is deliberately open and structurally identical to how Cowork already works, Cowork can natively own ~90% of OD's perceived capability. The net-new engineering is small and mostly **content + prompt-composition + UI polish on primitives that already exist.**

This document is the roadmap to do that.

---

## 2. What Open Design actually is (decomposed)

### 2.1 Topology
OD = Next.js 16 web app + local Node/Express daemon (+ optional Electron shell). The daemon:
- scans skills from `./.claude/skills/`, `./skills/`, `~/.claude/skills/` (precedence in that order);
- resolves the active `DESIGN.md`;
- spawns the detected agent CLI with `cwd` = the artifact dir, system = composed prompt;
- streams stdout → SSE → the `<artifact>` parser → sandboxed iframe;
- owns the export pipeline (puppeteer → PDF, pptxgenjs → PPTX, archiver → ZIP).

Artifacts are **plain files on disk** (`./.od/artifacts/<slug>/index.html` + `artifact.json` metadata + append-only `history.jsonl`) — deliberately git-reviewable, no SQLite for artifacts.

### 2.2 The four modes (each = a skill type + workflow shape)
| Mode | Output | Skill type | Time-to-first-result |
|---|---|---|---|
| **Prototype** | single editable screen (`index.html` / `.jsx`) | `prototype-skill` | 60–120 s |
| **Deck** | multi-slide HTML deck (+ `slides.json` for PPTX) | `deck-skill` | 90–180 s |
| **Template** | populated copy of a curated template | `template-skill` | 20–40 s |
| **Design System** | a `DESIGN.md` + sample-component preview | `design-system-skill` | 60–180 s |

Modes compose: run **Design System** once → every Prototype/Deck/Template afterwards reads `./DESIGN.md`.

### 2.3 The skills protocol (the part worth copying exactly)
Base format is Claude Code's `SKILL.md` **verbatim**. OD adds an optional `od:` frontmatter block:

```yaml
od:
  mode: deck                       # prototype | deck | template | design-system
  preview: { type: html, entry: index.html, reload: debounce-100 }
  example_prompt: "Create a magazine-style web deck."
  design_system: { requires: true, sections: [color, typography] }   # prune injected DESIGN.md
  craft: { requires: [typography, color, anti-ai-slop] }
  inputs:        # typed form fields rendered in the sidebar
    - { name: title, type: string, required: true }
    - { name: slide_count, type: integer, default: 8, min: 4, max: 20 }
  parameters:    # live sliders that re-prompt after first generation
    - { name: accent_hue, type: hue, default: 18, range: [0, 360] }
  outputs: { primary: index.html, secondary: [slides.json] }
  capabilities_required: [surgical_edit, file_write]
```

**Zero-config compatibility:** a skill with no `od:` block still works (mode inferred from name/body, preview type sniffed from output files). A plain Claude Code skill runs in OD unchanged; an OD skill that uses no extensions runs in plain Claude Code. We keep this promise.

### 2.4 The DESIGN.md schema (9 sections, from `awesome-claude-design`)
1. Visual Theme & Atmosphere · 2. Color Palette & Roles · 3. Typography Rules · 4. Component Stylings · 5. Layout Principles · 6. Depth & Elevation · 7. Do's and Don'ts · 8. Responsive Behavior · 9. Agent Prompt Guide.

Not invented by OD — adopting it gives instant ecosystem compatibility (68+ already exist upstream).

### 2.5 The craft axis (the underrated gem)
`craft/typography.md`, `craft/color.md`, `craft/anti-ai-slop.md` — **universal** rules true regardless of brand ("ALL CAPS needs ≥0.06em letter-spacing", "`#6366f1` is the AI-default tell", "`var(--accent)` ≤2× per screen"). Injected **between** DESIGN.md and the skill body; brand tokens win on conflict. This is what separates "looks AI-generated" from "looks crafted."

### 2.6 Refinement surfaces
- **Comment mode** — click a preview element (`[data-od-id]`) → popover → surgical edit of just that element (requires agent `surgicalEdit` capability).
- **Sliders** — `od.parameters` become live controls that re-prompt with only the parameter, no full regen.
- **Multi-frame** — desktop / tablet / phone preview widths.

---

## 3. Where Zosma Cowork stands today (gap analysis)

Cowork is a Tauri v2 + React desktop app over pi (`@earendil-works/pi-coding-agent`) via an esbuild-bundled `agent-sidecar`. Crucially, **several OD primitives already exist:**

| Capability | Cowork today | Source |
|---|---|---|
| Skills loaded from `~/.pi/agent/skills` | ✅ (shared with pi; same `SKILL.md` format) | sidecar |
| Skills catalog injected into system prompt | ✅ (pi behavior) | pi SDK |
| Sandboxed iframe artifact preview | ✅ `ArtifactPreview.tsx` (`<iframe sandbox="allow-scripts" srcDoc>`) — **but capped at `max-h-[400px]` inline** | `src/components/ArtifactPreview.tsx` |
| Artifact type detection (html/svg/image/code) | ✅ `lib/artifacts.ts` | `detectArtifactType()` |
| Load artifact from disk | ✅ `useArtifactLoader.ts` (Tauri fs) | hook |
| File-path extraction from tool results | ✅ `extractFilePaths()` ("Written to …", diff headers) | `lib/artifacts.ts` |
| Right-side panel | ✅ `RightPanel.tsx` | component |
| Streaming tool-call feed | ✅ `ToolCallTimeline.tsx` | component |
| PDF / HTML / PNG export | ✅ `preview_export` | pi tool |
| PPTX / DOCX | ✅ `office-docs` extension | sidecar |
| Extensions via `extensionFactories` (build-time) | ✅ | `disk-extension-loader.ts` |

**What's missing vs OD (the actual work):**
1. **Design-system layer** — no `DESIGN.md` store, picker, or injection into the prompt.
2. **craft references** — none.
3. **Mode concept** — no Prototype/Deck/Template/Design-System framing.
4. **Design skill corpus** — no `web-prototype`, `saas-landing`, `dashboard`, `simple-deck`, `guizang-ppt`, etc.
5. **Prompt composition path** — no "fold active DESIGN.md + craft + skill body into the session" for a deliberate design run (pi only injects the *catalog*, not full bodies).
6. **Studio preview pane** — the iframe exists but is a small inline chat preview, not a full-height pane with **live hot-reload**, **multi-frame (desktop/tablet/phone)**, and **JSX** support.
7. **Refinement** — no comment-to-edit, no parameter sliders.
8. **Design-System generation** — no DESIGN.md-from-brief/screenshot/URL flow.
9. **Design-grade export UX** — primitives exist but aren't wired into a "save/export design" affordance.
10. **`od:` frontmatter awareness** — Cowork doesn't read mode/preview/inputs/parameters.

> Net: Cowork has the hard frontend primitive (sandboxed iframe) and the export backends. The roadmap is mostly **content import + a sidecar prompt-composition path + UI assembly**, not greenfield engineering.

---

## 4. Strategic decision

**Adopt "Absorption" (Path B). Reject "Embed OD" (Path A) as the product direction.**

- **Path A — interop.** OD ships an MCP server (`od mcp install <agent>`), but pi has **no native MCP client** (it's an extension/package concern), and running OD's heavyweight daemon beside Cowork means two apps, two updaters, 1.4 GB. Acceptable only as a throwaway demo. *Optional, deferred: a thin MCP-client extension if a customer specifically needs OD's MP4/media generation.*
- **Path B — absorption.** Import the open content (skills, design systems, craft — all permissively licensed), replicate the prompt-composition convention in the sidecar, and assemble a **Design Studio mode** on top of Cowork's existing iframe + export primitives. One owned product, no external runtime.

**Provenance note:** pull skills/design-systems from the *original upstreams* (`VoltAgent/awesome-design-md` / `awesome-claude-design`, `bergside/awesome-design-skills`, `op7418/guizang-ppt-skill`) rather than re-vendoring OD's aggregation, to keep licensing/attribution clean. OD itself is Apache 2.0; upstream skills carry their own licenses (mostly MIT/Apache) — record each in a `NOTICE`/`THIRD_PARTY` file.

---

## 5. Target architecture — "Zosma Design Studio"

A new **Design** surface in Cowork (peer to chat), built from existing parts.

```
┌──────────────────────── Cowork (Tauri + React) ────────────────────────┐
│  Design Studio view                                                     │
│  ┌───────────────┐  ┌──────────────────────────────────────────────┐   │
│  │ Composer      │  │ Studio preview pane (RightPanel, full-height) │   │
│  │  • Mode pick  │  │  • iframe sandbox (HTML)   [from ArtifactPreview] │
│  │  • Skill pick │  │  • JSX via React+Babel standalone (new)       │   │
│  │  • Design-sys │  │  • multi-frame desktop/tablet/phone (new)     │   │
│  │  • inputs[]   │  │  • live hot-reload on file write (new)        │   │
│  │  • prompt     │  │  • comment-to-edit overlay (new, later)       │   │
│  │  • params[]   │  │  • export: HTML / PDF / PPTX / ZIP            │   │
│  └──────┬────────┘  └───────────────▲──────────────────────────────┘   │
│         │ Tauri invoke              │ useArtifactLoader (disk watch)    │
└─────────┼──────────────────────────┼──────────────────────────────────┘
          ▼                          │
   agent-sidecar (pi SDK)            │  writes index.html / *.jsx
   ┌─────────────────────────────┐   │
   │ design-context composer     │   │   project artifact dir
   │  active DESIGN.md (pruned)   │───┘   (~/.zosmaai/cowork/projects/<id>/)
   │  + craft/*.md                │
   │  + active SKILL.md body      │  → createAgentSession({ systemPrompt … })
   │  registry: skills + DS scan  │
   └─────────────────────────────┘
```

### 5.1 Prompt composition (sidecar)
Mirror OD's `apps/daemon/src/prompts/system.ts`. When a design run starts, the sidecar composes:

```
<base design output-contract>
+ <active DESIGN.md, pruned to od.design_system.sections>
+ <craft bodies for od.craft.requires>
+ <active SKILL.md body>
```

and passes it to `createAgentSession({ systemPrompt, ... })` (or prepends to the first user message, since local-CLI parity means no separate system channel). The agent writes `index.html` into the project dir; Cowork's existing `useArtifactLoader` + `ArtifactPreview` render it.

### 5.2 Storage & registry
- **Design systems:** `~/.zosmaai/cowork/design-systems/<slug>/DESIGN.md` (+ `tokens.json`, `preview.html`). Curated defaults seeded on first run.
- **Skills:** continue using `~/.pi/agent/skills` (shared) **plus** a curated `design/` subset Cowork ships; respect `od:` frontmatter.
- **craft:** `~/.zosmaai/cowork/craft/*.md`, seeded defaults.
- **Artifacts:** per-project dir, plain files (align with OD's git-reviewable philosophy). Reuse Folder-import semantics if present.

### 5.3 Reused vs new
- **Reuse:** `ArtifactPreview`, `useArtifactLoader`, `lib/artifacts.ts`, `RightPanel`, `ToolCallTimeline`, `preview_export`, `office-docs`, extension/skill loaders.
- **New:** design-context composer (sidecar), DESIGN.md/craft registries + scanners, `od:` frontmatter parser, Design Studio composer UI (mode/skill/DS pickers + inputs/params), preview-pane upgrades (full-height, hot-reload, multi-frame, JSX), comment-to-edit, design-system generation mode, export UX wiring.

---

## 6. Epics & tickets

Labels: `epic`, `enhancement`, `design-studio` (new label to add). Sizes: S ≤1d, M 2–3d, L 4–6d, XL >1wk.

### EPIC 0 — Spike & foundations *(do first)*
- **0.1 (M)** Spike: prove the composition end-to-end. Manually drop 3 skills (`web-prototype`, `dashboard`, `simple-deck`) + 2 design systems into local dirs, hand-compose `BASE+DESIGN.md+craft+SKILL.md`, run through the sidecar, confirm pi emits a clean self-contained `index.html` that renders in `ArtifactPreview`. **Acceptance:** screenshot of a brand-skinned prototype rendered in Cowork. No code shipped — validates the thesis.
- **0.2 (S)** Add `design-studio` GitHub label + this roadmap merged to `docs/`.
- **0.3 (M)** Decide artifact/project storage location & path-safety (reuse pi/Cowork resource-dir conventions; sandbox writes). ADR in `docs/`.
- **0.4 (S)** Licensing: `THIRD_PARTY_DESIGN.md` listing each imported skill/design-system + upstream + license.

### EPIC 1 — Design corpus (content import)
- **1.1 (M)** Import & curate **prototype skills**: `web-prototype`, `saas-landing`, `dashboard`, `pricing-page`, `docs-page`, `blog-post`, `mobile-app`. Normalize frontmatter; add `od:` blocks where missing.
- **1.2 (M)** Import **deck skills**: `simple-deck`, `guizang-ppt` (magazine-web-ppt, with `assets/` + `references/`). Verify side-file path resolution (absolute skill-root preamble).
- **1.3 (M)** Import **design systems**: seed ~20 curated `DESIGN.md` from `awesome-claude-design` (spread across categories). Add a `sync-design-systems` script to refresh from upstream.
- **1.4 (S)** Author **craft** references: `typography.md`, `color.md`, `anti-ai-slop.md` (port from OD/upstream, attribute).
- **1.5 (S)** Build a tiny **registry scanner test** asserting all imported skills parse and declare a valid `mode`.

### EPIC 2 — Design-context composition (sidecar)
- **2.1 (L)** `design-context.ts` in the sidecar: compose `DESIGN.md (pruned by od.design_system.sections) + craft (od.craft.requires) + skill body` and inject via `createAgentSession`. Unit tests for pruning + ordering (brand tokens after craft).
- **2.2 (M)** `od:` frontmatter parser + skill record extension (mode, preview, design_system, craft, inputs, parameters, outputs, capabilities_required) with **zero-config defaults** (infer mode, sniff preview type).
- **2.3 (M)** Design-system + craft **registries** (scan dirs, watch for changes, expose over the sidecar↔frontend bridge).
- **2.4 (S)** Base **output-contract** prompt (self-contained HTML, inline CSS, real fonts, no code fences, write to `index.html`).
- **2.5 (M)** Tauri commands / bridge: `list_design_systems`, `list_design_skills`, `set_active_design_system`, `start_design_run({mode, skill, designSystem, inputs, prompt})`.

### EPIC 3 — Design Studio UI (composer)
- **3.1 (L)** Design Studio view scaffold (new route/tab) with three-pane layout reusing `RightPanel`.
- **3.2 (M)** **Mode picker** (Prototype / Deck / Template / Design System) — filters skills by `od.mode`.
- **3.3 (M)** **Skill picker** (grouped by mode, shows `· default`, localized name/description).
- **3.4 (M)** **Design-system picker** (dropdown + "active" state, thumbnail/preview).
- **3.5 (M)** **Typed inputs form** from `od.inputs` (string/integer/boolean/enum) rendered in the composer.
- **3.6 (S)** Mode inference from free-text prompt ("deck"/"slides"→Deck, "design system"/"brand"→Design System, else Prototype).
- **3.7 (S)** Keyboard affordances (⌘↵ generate, Esc cancel, ⌘E export).

### EPIC 4 — Studio preview pane (upgrade existing primitive)
- **4.1 (M)** Promote `ArtifactPreview` to a **full-height Studio pane** (remove 400px cap; dedicated layout in `RightPanel`).
- **4.2 (M)** **Live hot-reload**: watch the artifact file (Tauri fs watch / poll) → debounced `srcdoc` replace as the agent streams writes.
- **4.3 (M)** **Multi-frame** toggle: desktop / tablet / phone widths.
- **4.4 (L)** **JSX preview**: vendored React 18 + Babel standalone bootstrap inside the sandboxed iframe (mirror Open CoDesign approach) for `.jsx` artifacts.
- **4.5 (S)** Preview error surface: JSX/HTML parse error → show raw code + annotation instead of blank iframe.
- **4.6 (S)** "Primary output" resolution from `od.outputs.primary` (which file the pane loads).

### EPIC 5 — Refinement surfaces
- **5.1 (L)** **Comment-to-edit**: tag preview elements (`data-zd-id`), click → popover → surgical-edit instruction back to the agent (gate on capability; fall back to full-file regen with "only change X").
- **5.2 (M)** **Parameter sliders** from `od.parameters` (hue/spacing/font-scale/opacity) → re-prompt with parameter only (fast path), no full regen.
- **5.3 (S)** "Regenerate" / "resume" affordances on timeout or partial artifact.

### EPIC 6 — Export & delivery
- **6.1 (S)** **Self-contained HTML** export (inline CSS, data-URI assets) — wire to existing `preview_export`.
- **6.2 (S)** **PDF** export via `preview_export`.
- **6.3 (M)** **PPTX** export: deck skills emit `slides.json` → route through `office-docs`; fallback to page-capture when absent (document per-skill).
- **6.4 (S)** **ZIP** of the artifact dir.
- **6.5 (S)** "Save to disk" / "Open folder" / "Copy path" (extend the actions already in `ArtifactPreview`).

### EPIC 7 — Design System generation mode
- **7.1 (M)** `design-system-from-brief` skill + run path → writes `DESIGN.md` + `preview.html` sample components.
- **7.2 (M)** `design-system-from-screenshot` / `-from-url` (vision-capable models) — gate on model capability.
- **7.3 (M)** Split-view editor: editable `DESIGN.md` (left) + live sample-components preview (right).
- **7.4 (S)** "Set as active design system" → writes to the registry and selects it for subsequent runs.

### EPIC 8 — (Optional, deferred) OD interop bridge
- **8.1 (L)** Spike: MCP-client extension for the sidecar so Cowork can consume an external OD MCP server on demand (only if a customer needs OD's MP4/media generation). Do **not** bundle OD's daemon. Decision-gated; likely won't ship in v1.

---

## 7. Phasing & sequencing

The roadmap is sequenced so each phase ships something demoable on its own.

| Phase | Epics | Outcome | Rough size |
|---|---|---|---|
| **P0 — Proof** | EPIC 0 | Thesis validated: a brand-skinned prototype renders in Cowork from composed prompt | ~3 days |
| **P1 — Generative core** | EPIC 1 + 2 + minimal 3 (mode+skill+DS pickers) + 4.1 | "Design mode": pick skill+brand+prompt → `index.html` renders full-pane | ~2 weeks |
| **P2 — Studio feel** | EPIC 4 (hot-reload, multi-frame, JSX) + 3 (inputs, inference) | Feels like a studio: live preview, responsive frames, typed inputs | ~2 weeks |
| **P3 — Export & decks** | EPIC 6 + deck skills (1.2) | Deliverables: HTML/PDF/PPTX/ZIP, deck mode | ~1.5 weeks |
| **P4 — Refinement** | EPIC 5 | Comment-to-edit + sliders | ~1.5 weeks |
| **P5 — Brand authoring** | EPIC 7 | Generate `DESIGN.md` from brief/screenshot/URL | ~1.5 weeks |
| **P6 — (opt) Interop** | EPIC 8 | OD MCP bridge if demanded | gated |

**Critical path:** EPIC 2 (sidecar composition) is the spine — everything generative depends on it. EPIC 4.1 (full-pane preview) is the cheapest high-impact UI win because the iframe primitive already exists. Do P0→P1 before anything else; they prove and unlock the rest.

### Minimum lovable demo (end of P1)
User opens Design mode → picks `dashboard` skill + `Linear-ish` design system → types "analytics dashboard for a logistics startup" → watches tool calls stream → a branded dashboard renders full-height in the right pane → clicks Save. No comment mode, no sliders, no PPTX yet. **This alone matches the core OD experience.**

---

## 8. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| pi folds system prompt differently than OD's local-CLI path | Composed prompt may not take effect | Spike (0.1) validates injection via `createAgentSession`; fall back to prepending to first user message |
| Bundled sidecar can't load disk skills (jiti/node_modules) — see `zosma-cowork-pi-extension-loading-constraint` | Design skills invisible to model | Design context is composed **explicitly** by our sidecar code, not via pi's disk loader — sidesteps the constraint entirely |
| Model emits markdown fences / chatty text instead of a clean artifact | Preview fails | Strict output-contract prompt (2.4) + tolerant parser; fall back to file-on-disk detection (already in `lib/artifacts.ts`) |
| Large DESIGN.md + craft + skill blows context on small models | Truncation | `od.design_system.sections` pruning (2.1); per-skill `max_slides`/token budgeting |
| JSX-in-iframe security | XSS into host | Keep `sandbox="allow-scripts"` only, **never** `allow-same-origin` (already the case) |
| Licensing drift across imported skills | Legal | `THIRD_PARTY_DESIGN.md` (0.4); import from upstreams, not OD's re-vendor |
| Scope creep (trying to match OD 1:1) | Never ships | Phase gates; MP4/HyperFrames explicitly out of v1 |

---

## 9. Explicitly out of scope (v1)

- **MP4 / HyperFrames** motion graphics (headless render pipeline — large, defer).
- Hosted skill/design-system **marketplace** (git/local only).
- **Figma** export.
- **Collaborative / multi-user** editing.
- **Automation** page (OD's scheduled workflows) — Cowork already has `prompt-scheduler.ts`; revisit later.
- Auto mode-switching mid-session.

---

## 10. Success metrics

- **Time-to-first-artifact** < 2 min for a prototype on a mid-tier model.
- **Brand fidelity:** generated output visibly reflects the chosen `DESIGN.md` (palette, type, spacing) — eyeball + token-presence check.
- **Artifact validity:** ≥90% of runs produce a renderable `index.html` without manual fixup.
- **Reuse ratio:** ≥60% of the feature built on existing Cowork primitives (iframe, export, skill loader) vs net-new code.
- **Zero external runtime:** no OD daemon process required.

---

## 11. Appendix — file-level pointers

### Cowork (reuse / extend)
| Path | Role |
|---|---|
| `src/components/ArtifactPreview.tsx` | sandboxed iframe preview — **extend** to full-pane (EPIC 4) |
| `src/hooks/useArtifactLoader.ts` | disk → artifact data — **extend** with file-watch (4.2) |
| `src/lib/artifacts.ts` | type detection + path extraction — reuse |
| `src/components/RightPanel.tsx` | host for the Studio pane (EPIC 3/4) |
| `src/components/ToolCallTimeline.tsx` | streaming tool feed — reuse in Studio |
| `agent-sidecar/src/index.ts` | session creation / `extensionFactories` — add design-context composer |
| `agent-sidecar/src/extension-manager.ts` | parses skill/command capabilities — extend for `od:` frontmatter |
| `agent-sidecar/src/office-docs/*` | PPTX/DOCX backend — wire to deck export (6.3) |
| `preview_export` (pi tool) | PDF/HTML/PNG export (EPIC 6) |

### Open Design (reference implementations to mirror)
| OD path | What to copy the shape of |
|---|---|
| `apps/daemon/src/prompts/system.ts` | prompt composition order (DESIGN.md → craft → skill) |
| `apps/daemon/src/skills.ts` | `SKILL.md` + `od:` frontmatter parser, zero-config defaults |
| `apps/daemon/src/design-systems.ts` | DESIGN.md loader / 9-section parse |
| `apps/daemon/src/craft.ts` | craft slug resolution + silent fallback |
| `apps/web/src/artifacts/` | streaming `<artifact>` parser (optional — Cowork uses file-on-disk) |
| `apps/web/src/runtime/` | iframe srcdoc + JSX (React+Babel) bootstrap |
| `docs/skills-protocol.md`, `docs/modes.md`, `docs/architecture.md` | the canonical spec we're adapting |

### Upstream content sources (import, attribute)
- `VoltAgent/awesome-claude-design` — DESIGN.md systems (9-section schema).
- `VoltAgent/awesome-design-md` / `bergside/awesome-design-skills` — design skills.
- `op7418/guizang-ppt-skill` — magazine-web-ppt deck skill.

---

## 12. TL;DR for reviewers

Open Design proved that "AI design tool" = **agent + brand contract (DESIGN.md) + workflow (SKILL.md) + craft rules + sandboxed-iframe preview + export.** Cowork already has the agent, the iframe, and the export backends. We need to import the open content, add one prompt-composition path in the sidecar, and assemble a Design Studio UI on primitives that already exist. **Absorb the ideas; don't embed the app.** Start with the P0 spike — it's three days to a working brand-skinned prototype rendered inside Cowork.