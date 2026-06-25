# Task: Public Documentation Site (Issue #175)

**Issue:** https://github.com/zosmaai/zosma-cowork/issues/175  
**Assignee:** Shanvit7  
**Label:** enhancement  
**Reference pattern:** `zosmaai/dhara` — `website/` + `docs/` split with Fumadocs

---

## Goal

Scaffold a public documentation site for Zosma Cowork following the same Fumadocs pattern as `dhara.zosma.ai`, targeted at `cowork.zosma.ai`. Users get searchable, screenshot-rich docs for install, configuration, and all core workflows.

---

## Tech Stack

| Concern | Choice | Note |
|---|---|---|
| Framework | **Next.js 16** | ⚠️ Use 16, NOT 15 (dhara uses 15 — upgrade here) |
| Docs engine | **Fumadocs** (`fumadocs-core`, `fumadocs-ui`, `fumadocs-mdx`) | Same versions as dhara unless 16-incompatible |
| Content | **MDX** | Lives in `docs/` at repo root |
| Syntax highlighting | **shiki** | Already used in dhara |
| Styling | **Tailwind CSS v4** + `fumadocs-ui` theme | Match the rest of cowork's stack |
| Deployment | **Vercel** (or Cloudflare Pages) | Target subdomain `cowork.zosma.ai` |
| Package manager | **pnpm** | Isolated from root npm workspace |

---

## Monorepo Layout

```
zosma-cowork/
├── docs/plans/                  # Internal planning docs (unchanged, not served by Fumadocs)
│
└── website/                     # Next.js 16 + Fumadocs app
    ├── package.json             # pnpm, packageManager: pnpm@10
    ├── next.config.mjs
    ├── source.config.ts         # dir: "./content"
    ├── postcss.config.mjs
    ├── tsconfig.json
    ├── mdx-components.tsx
    ├── next-env.d.ts
    ├── content/                 # MDX content (Fumadocs source)
    │   ├── _meta.json           # Top-level nav order
    │   ├── getting-started/
    │   │   ├── _meta.json
    │   │   └── index.mdx
    │   ├── features/
    │   │   ├── _meta.json
    │   │   ├── chat.mdx
    │   │   ├── sessions.mdx
    │   │   ├── models.mdx
    │   │   └── settings.mdx
    │   ├── guides/
    │   │   ├── _meta.json
    │   │   ├── extensions.mdx
    │   │   └── keyboard-shortcuts.mdx
    │   └── reference/
    │       ├── _meta.json
    │       ├── architecture.mdx
    │       └── ipc-protocol.mdx
    ├── public/
    │   └── screenshots/         # Annotated screenshots (add here)
    └── src/
        └── app/
            ├── globals.css
            ├── layout.config.tsx
            ├── layout.tsx
            ├── page.tsx         # Landing page
            ├── docs/
            │   ├── layout.tsx
            │   └── [[...slug]]/
            │       └── page.tsx
            ├── api/
            │   └── search/
            │       └── route.ts
            └── lib/
                └── source.ts
```

> **Note:** MDX content lives in `website/content/` (not `docs/`). This avoids cross-boundary module resolution issues with Turbopack in Next.js 16. `docs/` stays as internal planning-only directory.

---

## `website/package.json` (target)

```json
{
  "name": "zosma-cowork-docs",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "node .next/standalone/server.js",
    "postinstall": "fumadocs-mdx"
  },
  "dependencies": {
    "fumadocs-core": "^15.8.5",
    "fumadocs-mdx": "^12.0.3",
    "fumadocs-ui": "^15.8.5",
    "lucide-react": "^0.476.0",
    "next": "^16.0.0",
    "next-themes": "^0.4.4",
    "react": "^19.2.1",
    "react-dom": "^19.2.1",
    "shiki": "^3.15.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "tailwind-merge": "^3.0.2",
    "remark-gfm": "^4.0.1"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.1.14",
    "@tailwindcss/typography": "^0.5.16",
    "@types/node": "^22.0.0",
    "@types/react": "^19.2.2",
    "@types/react-dom": "^19.2.1",
    "postcss": "^8",
    "tailwindcss": "^4.1.14",
    "tailwindcss-animate": "^1.0.7",
    "typescript": "^5.7.0"
  }
}
```

> ⚠️ Verify fumadocs-core/ui v15 compatibility with Next.js 16 during scaffold. Bump to fumadocs v16 if a compatible release exists.

---

## `website/source.config.ts`

```ts
import { remarkHeading } from "fumadocs-core/mdx-plugins";
import { defineConfig, defineDocs } from "fumadocs-mdx/config";

export const docs = defineDocs({
  dir: "../docs",
});

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [remarkHeading],
  },
});
```

---

## `website/next.config.mjs`

```mjs
import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  pageExtensions: ["js", "jsx", "md", "mdx", "ts", "tsx"],
  output: "standalone",
  outputFileTracingRoot: process.cwd(),
};

export default withMDX(config);
```

---

## `docs/_meta.json` (nav order)

```json
{
  "getting-started": "Getting Started",
  "--- Features": { "type": "separator" },
  "features": "Features",
  "--- Guides": { "type": "separator" },
  "guides": "Guides",
  "--- Reference": { "type": "separator" },
  "reference": "Reference"
}
```

---

## Minimum Required Pages (Acceptance Criteria)

| Page | Path | Must Include |
|---|---|---|
| Getting Started | `docs/getting-started/index.mdx` | Install steps (macOS/Windows/Linux), first run, pick a provider, screenshot of Welcome screen |
| Chat | `docs/features/chat.mdx` | Message streaming, thinking blocks, tool call timeline — annotated screenshot |
| Sessions | `docs/features/sessions.mdx` | Folder picker → workspace-bound session, sidebar search/delete — GIF or screenshot |
| Models | `docs/features/models.mdx` | Provider selection, API key entry, model switching |
| Settings | `docs/features/settings.mdx` | Telemetry toggle, persona/custom instructions |
| Architecture | `docs/reference/architecture.mdx` | Tauri + sidecar diagram (ASCII or SVG), IPC flow |

---

## CI Check

Add a job to `.github/workflows/ci.yml`:

```yaml
docs-build:
  name: Docs Build
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
      with:
        version: 10
    - uses: actions/setup-node@v4
      with:
        node-version: 22
        cache: pnpm
        cache-dependency-path: website/pnpm-lock.yaml
    - run: cd website && pnpm install --frozen-lockfile
    - run: cd website && pnpm build
```

---

## README Update

Add to the top of `README.md`:

```md
📖 **Documentation:** [cowork.zosma.ai](https://cowork.zosma.ai)
```

---

## Implementation Steps

1. **Branch:** `feat/fumadocs-docs-site`
2. **Scaffold `website/`** — copy dhara's `website/` structure, swap Next.js version to 16
3. **Verify compatibility** — run `cd website && npm install && npm run build` locally; fix any Next.js 16 breaking changes
4. **Create MDX stubs** — all 6 minimum pages with front matter + placeholder body
5. **Wire nav** — `_meta.json` at each level
6. **Add screenshots** — export from running app, annotate with Figma or similar, save to `website/public/screenshots/`
7. **CI job** — add `docs-build` job
8. **README** — add docs link
9. **Vercel project** — create under `zosmaai` org, point to `website/`, set `Root Directory = website`, set `Install Command = pnpm install`, deploy to `cowork.zosma.ai`
10. **PR** — close issue #175 via `Closes #175` in description

---

## Acceptance Checklist

- [ ] `website/` scaffolded with Next.js **16** + Fumadocs
- [ ] `docs/` content directory with all 6 minimum pages
- [ ] `npm run build` passes locally inside `website/`
- [ ] CI `docs-build` job green
- [ ] At least 3 annotated screenshots in `website/public/screenshots/`
- [ ] Dark/light mode works (fumadocs-ui theme)
- [ ] `README.md` links to `cowork.zosma.ai`
- [ ] Deployed on Vercel at `cowork.zosma.ai` (or staging URL)
- [ ] PR closes issue #175
