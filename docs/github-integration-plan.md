# Immediate Integration Sprint: Git, GitHub & PM Toolkit

> **Branch:** `docs/integrations-roadmap`
> **Worktree:** `/home/arjun/code/zosmaai/zosma-cowork-integrations-docs`

---

## What Must Ship Immediately

These are the integrations that give project managers the most value **today** — zero competition, high impact, and (for some) almost trivial effort because deps are already present.

| Priority | Integration | Why Now | Build Time | Deps Ready? |
|----------|-------------|---------|------------|-------------|
| 🔥 P0 | **GitHub Issues & Projects** | PMs + devs need issue/PR ops. `gh` + git bundling unlocks everything. | 1 week | Need git + gh bundled |
| 🔥 P0 | **Git bundling** | Prerequisite for ALL git-based workflows. Windows users blocked without it. | 3 days | `git2` (libgit2) in Cargo.toml |
| 🔥 P0 | **GitHub CLI bundling** | Prerequisite for GitHub extension. Auth + org listing. | 2 days | Same pattern as node fetch |
| 🔥 P1 | **Jira** | The #1 PM tool in IT. No pi ext exists. | 1-2 weeks | Nothing needed |
| 🔥 P1 | **Notion** | PMs use it for docs, roadmaps, wikis. | 1 week | `@notionhq/client` SDK |
| 🔥 P1 | **PostgreSQL** | Engineering data queries. `postgres` dep already installed. | 2-3 days | ✅ Already in Cowork! |
| 🔥 P1 | **Sentry** | PMs + eng see error trends. `@sentry/react` already in deps. | 2 days | ✅ Already in Cowork! |

---

## 1. Bundling Git with Zosma Cowork

### Problem

On a fresh Windows install, `git` is not on PATH. The pi session (and many tools like `simple-git`, `pi-web-access`, etc.) shell out to `git` and fail with `ENOENT`. The user had to manually install Git for Windows.

### Solution: Three-Layer Git Availability

#### Layer 1: Bundled Portable Git Binary (all platforms)

Following the exact pattern of [`fetch-node.mjs`](../../../src-tauri/scripts/fetch-node.mjs) which downloads Node.js v24 LTS per-platform:

**New script: `src-tauri/scripts/fetch-git.mjs`**

Downloads portable Git for each target platform:

| Triple | Source | Binary Path |
|--------|--------|-------------|
| `x86_64-pc-windows-msvc` | [Git for Windows portable](https://github.com/git-for-windows/git/releases) (~30MB) | `src-tauri/binaries/git/git.exe` + `usr/bin/*.dll` |
| `x86_64-apple-darwin` | [Apple Git](https://git-scm.com/download/mac) or system check | `src-tauri/binaries/git` |
| `aarch64-apple-darwin` | same | `src-tauri/binaries/git` |
| `x86_64-unknown-linux-gnu` | System check or static binary | `src-tauri/binaries/git` |

**On macOS/Linux**: First check if system git exists (`/usr/bin/git`). If yes, skip download. If not, download a static build.

**On Windows**: Always download Git for Windows portable. Include the essential `usr/bin/*.dll` and `mingw64/bin/*.dll` that git needs.

**Tauri bundle registration** (`tauri.conf.json`):
```json
"resources": [
    "agent-sidecar/index.cjs",
    "binaries/node",
    "binaries/node-arm64",
    "binaries/node-x64",
    "binaries/git/**",
    "binaries/gh/**"
]
```

#### Layer 2: PATH Injection in Agent-Sidecar

In `agent-sidecar/src/index.ts`, during `initAgent()`, construct a merged PATH that puts bundled binaries first:

```typescript
function buildBundledPath(): string {
    const bundledDir = join(dirname(fileURLToPath(import.meta.url)), "..", "binaries");
    const gitDir = join(bundledDir, "git");
    const ghDir = join(bundledDir, "gh");
    
    const pathParts: string[] = [];
    // Bundled binaries first
    if (existsSync(gitDir)) pathParts.push(gitDir);
    if (existsSync(ghDir)) pathParts.push(ghDir);
    // System PATH appended
    if (process.env.PATH) pathParts.push(process.env.PATH);
    
    return pathParts.join(path.delimiter);
}

// Before any session starts:
process.env.PATH = buildBundledPath();
```

This is set once at process start before `createAgentSession()` is called, so the pi session inherits the enriched PATH transparently. Tools that shell out to `git` or `gh` find them without any code changes.

#### Layer 3: libgit2 (Rust-side, already present)

The `git2` crate with `vendored-openssl` is already in `Cargo.toml`. This means:
- Rust-side git operations (clone, status, diff) can use libgit2 directly — no git binary needed
- Candidate for future "clone a repo" features in the Tauri backend
- Already works today for any Rust-level git operations

---

## 2. Bundling GitHub CLI (`gh`)

### Problem

`pi-web-access` and the proposed GitHub extension use `gh` for API operations. The CLI handles auth (OAuth device flow), org listing, issue/PR management, and Actions. Without it, users need to get a PAT manually.

### Solution: `fetch-gh.mjs`

**New script: `src-tauri/scripts/fetch-gh.mjs`**

Downloads the official GitHub CLI binary for each platform from `https://github.com/cli/cli/releases`:

| Triple | GitHub CLI Asset | Size |
|--------|-----------------|------|
| `x86_64-pc-windows-msvc` | `gh_*_windows_amd64.zip` | ~10MB |
| `x86_64-apple-darwin` | `gh_*_macOS_amd64.tar.gz` | ~10MB |
| `aarch64-apple-darwin` | `gh_*_macOS_arm64.tar.gz` | ~10MB |
| `x86_64-unknown-linux-gnu` | `gh_*_linux_amd64.tar.gz` | ~10MB |

**Binary location**: `src-tauri/binaries/gh/gh` (or `gh.exe` on Windows)

### Auth Flow

GitHub CLI already has a robust device-flow auth:

```bash
gh auth login --web
# OR non-interactive for automation:
gh auth login --with-token < ~/.config/gh/token
```

**Cowork's GitHub Auth UX** (settings panel flow):

```
┌──────────────────────────────────────────┐
│  GitHub Connection                        │
│                                          │
│  Status: ⚪ Not connected                │
│                                          │
│  [Connect with GitHub]                   │
│                                          │
│  ── or ──                                │
│                                          │
│  Personal Access Token: [______________] │
│  [Verify & Save]                         │
└──────────────────────────────────────────┘
```

**Option A: Device Flow (recommended)** — Cowork calls `gh auth login --web` in an interactive terminal/URL flow. User opens URL, enters code, browser auth completes. No token ever touches Cowork storage.

**Option B: PAT Flow** — User enters a GitHub PAT in Cowork settings. Cowork runs `gh auth login --with-token` once, then deletes the token file. All subsequent operations use `gh`'s own credential store (`~/.config/gh/hosts.yml`).

**Option C: OAuth App Flow** — Cowork acts as a GitHub OAuth app. User clicks "Connect", browser opens to authorize, Cowork receives callback token, writes it to `gh`'s credential store. This is the most seamless UX but requires registering Cowork as a GitHub OAuth app.

### Probes: Connected Status

**Current state** (check via `gh auth status`):
```bash
gh auth status --show-token     # Shows current user + orgs
# Returns: ✓ Logged in to github.com as <user> (<token>)
# ✓ Git operations for github.com configured to use https protocol.
# ✓ Token: ghp_***************
```

**New command for Cowork**: `get_github_status` in the agent-sidecar command switch:

```typescript
case "get_github_status": {
    try {
        const result = execFileSync("gh", ["auth", "status"], { encoding: "utf-8" });
        // Parse: extract username, accounts, orgs
        const hosts = JSON.parse(execFileSync("gh", ["auth", "status", "--show-token", "--json"], { encoding: "utf-8" }));
        send({ type: "result", id: cmd.id, data: { connected: true, ...hosts } });
    } catch {
        send({ type: "result", id: cmd.id, data: { connected: false } });
    }
}
```

The `gh auth status --json` output includes:
```json
{
  "hosts": {
    "github.com": {
      "user": "arjun",
      "oauth_token": "gho_...",
      "git_protocol": "https",
      "token_scope": "repo,workflow,read:org,admin:org_hook"
    }
  }
}
```

---

## 3. GitHub pi Extension (`@zosmaai/pi-github`)

### Architecture

```
@zosmaai/pi-github/
├── package.json       → pi: { extensions: ["./src/index.ts"] }
├── src/
│   ├── index.ts       → registers all tools
│   ├── auth.ts        → gh auth check, status probe
│   ├── issues.ts      → issue CRUD
│   ├── projects.ts    → Projects v2 (beta) operations
│   ├── pulls.ts       → PR listing, review, merge
│   ├── actions.ts     → GitHub Actions workflows
│   ├── repos.ts       → repo listing, branch ops
│   └── types.ts       → shared schemas
├── README.md
└── LICENSE
```

### Tools

**Auth & Status:**
| Tool | Description |
|------|-------------|
| `gh_status` | Show connected accounts, orgs, token scope |
| `gh_organizations` | List all orgs the user belongs to |
| `gh_repos` | List repos (by org, by user, starred) |

**Issues:**
| Tool | Description |
|------|-------------|
| `gh_issue_search` | Search issues across repos (state, label, milestone, assignee) |
| `gh_issue_get` | Get full issue details |
| `gh_issue_create` | Create issue (title, body, labels, assignees, milestone, project) |
| `gh_issue_update` | Update issue (title, body, state, labels, assignees, milestone) |
| `gh_issue_comment` | Add comment to issue |

**Projects v2:**
| Tool | Description |
|------|-------------|
| `gh_project_list` | List projects for an org/user/repo |
| `gh_project_items` | List items in a project (with field values) |
| `gh_project_add_item` | Add an issue/PR to a project |
| `gh_project_update_item` | Update project field values (status, sprint, priority) |

**Pull Requests:**
| Tool | Description |
|------|-------------|
| `gh_pr_list` | List PRs (state, base branch, author, labels) |
| `gh_pr_get` | Get PR details (files changed, status checks, mergeable state) |
| `gh_pr_create` | Create PR with title, body, reviewers |
| `gh_pr_review` | Add review comment or approve/request-changes |
| `gh_pr_merge` | Merge PR (merge/squash/rebase) |
| `gh_pr_checks` | Get CI status for a PR |

**Actions:**
| Tool | Description |
|------|-------------|
| `gh_workflow_list` | List workflows in a repo |
| `gh_workflow_run` | Trigger a workflow_dispatch |
| `gh_workflow_status` | Get latest run(s) status for a workflow |
| `gh_workflow_logs` | Get logs for a workflow run |
| `gh_workflow_cancel` | Cancel a running workflow |

**Repos:**
| Tool | Description |
|------|-------------|
| `gh_repo_get` | Get repo details (stars, forks, issues, language) |
| `gh_branch_list` | List branches for a repo |
| `gh_release_list` | List releases |

### Implementation Pattern (uses `gh` CLI)

```typescript
import { execFileSync } from "node:child_process";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function gh(args: string[], opts?: { json?: boolean }): string {
    const cmd = opts?.json ? [...args, "--json", ...(opts.json === true ? [] : [opts.json])] : args;
    return execFileSync("gh", cmd, { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });
}

export default function (pi: ExtensionAPI) {
    // ── Status ──
    pi.registerTool({
        name: "gh_status",
        label: "GitHub Status",
        description: "Show connected GitHub accounts, organizations, and token scope",
        parameters: Type.Object({}),
        async execute(_toolCallId, _params, _signal) {
            try {
                const raw = JSON.parse(gh(["auth", "status", "--show-token", "--json"]));
                return { success: true, ...raw };
            } catch (e) {
                return { success: false, error: "Not connected to GitHub. Run 'gh auth login' or set a PAT." };
            }
        },
    });

    // ── Search Issues ──
    pi.registerTool({
        name: "gh_issue_search",
        label: "GitHub Issue Search",
        description: "Search GitHub issues across repos with filters",
        parameters: Type.Object({
            q: Type.String({ description: "Search query" }),
            repo: Type.Optional(Type.String({ description: "Limit to owner/repo" })),
            state: Type.Optional(Type.Union([Type.Literal("open"), Type.Literal("closed"), Type.Literal("all")])),
            label: Type.Optional(Type.String({ description: "Filter by label" })),
            limit: Type.Optional(Type.Number({ default: 20 })),
        }),
        async execute(_toolCallId, params, _signal) {
            const query = [
                params.q,
                params.repo ? `repo:${params.repo}` : "",
                params.state && params.state !== "all" ? `state:${params.state}` : "",
                params.label ? `label:"${params.label}"` : "",
            ].filter(Boolean).join(" ");
            const json = JSON.parse(gh(["issue", "list", "--search", query, "--limit", String(params.limit ?? 20), "--json", "number,title,state,url,labels,assignees,updatedAt"]));
            return { success: true, issues: json };
        },
    });

    // ── Create Issue ──
    pi.registerTool({
        name: "gh_issue_create",
        label: "GitHub Issue Create",
        description: "Create a new GitHub issue in a repo",
        parameters: Type.Object({
            repo: Type.String({ description: "owner/repo" }),
            title: Type.String({ description: "Issue title" }),
            body: Type.Optional(Type.String({ description: "Issue body (Markdown)" })),
            label: Type.Optional(Type.String({ description: "Comma-separated labels" })),
            assignee: Type.Optional(Type.String({ description: "Comma-separated usernames" })),
            project: Type.Optional(Type.String({ description: "Project title or ID" })),
            milestone: Type.Optional(Type.String({ description: "Milestone title or number" })),
        }),
        async execute(_toolCallId, params, _signal) {
            const args = ["issue", "create", "--repo", params.repo, "--title", params.title];
            if (params.body) args.push("--body", params.body);
            if (params.label) args.push("--label", params.label);
            if (params.assignee) args.push("--assignee", params.assignee);
            if (params.milestone) args.push("--milestone", params.milestone);
            const output = gh(args);
            return { success: true, url: output.trim() };
        },
    });
}
```

### Auth Check + UI Status Chip

The extension's `export default` function probes auth on init and calls `pi.ctx.ui.setStatus()`:

```typescript
export default async function (pi: ExtensionAPI) {
    try {
        const status = JSON.parse(gh(["auth", "status", "--show-token", "--json"]));
        const user = status?.hosts?.["github.com"]?.user ?? "unknown";
        const orgs = Object.keys(status?.hosts ?? {});
        pi.ctx.ui.setStatus("gh", `gh: ✓ ${user} (${orgs.length} host(s))`);
    } catch {
        pi.ctx.ui.setStatus("gh", "gh: ⚪ not connected");
    }
    // ... register tools ...
}
```

This makes the connection status appear in Cowork's StatusLine footer automatically.

---

## 4. GitHub OAuth vs `gh` CLI Auth

### Option Comparison

| Approach | UX | Persistence | Complexity |
|----------|----|-------------|------------|
| **A: `gh auth login --web`** (device code) | User clicks button → gets code → opens URL → browser auth | `~/.config/gh/hosts.yml` | Low — call `gh` CLI once |
| **B: PAT in Cowork settings** | User pastes PAT → Cowork runs `gh auth login --with-token` | `~/.config/gh/hosts.yml` | Low — one-time token injection |
| **C: GitHub OAuth App** | "Sign in with GitHub" → browser → callback → Cowork stores token | `~/.config/gh/hosts.yml` or Cowork vault | Medium — need OAuth app + callback endpoint |

**Recommendation**: Start with **Option A** (device flow via `gh` CLI) for v1, then add **Option C** (GitHub OAuth App) for seamless UX in v2. Option A is literally:

```
gh auth login --web
# User visits https://github.com/login/device
# Enters 8-character code
# Auths in browser
# Done
```

### "Show all Organizations and Personal Accounts"

The `gh api` command lists organizations:

```bash
gh api user/memberships/orgs --jq '.[].organization.login'
# → zosmaai, my-company, personal-project
```

And `gh auth status --json` shows all authenticated hosts (including GitHub Enterprise instances):

```json
{
  "hosts": {
    "github.com": { "user": "arjun", ... },
    "gitlab.example.com": { "user": "arjun", ... }
  }
}
```

For the extension, add a `gh_organizations` tool:

```typescript
pi.registerTool({
    name: "gh_organizations",
    label: "GitHub Organizations",
    description: "List all organizations the user belongs to",
    parameters: Type.Object({}),
    async execute() {
        const orgs = JSON.parse(gh(["api", "user/memberships/orgs", "--jq", "[.[].organization.login]"]));
        const repos = JSON.parse(gh(["api", "user/repos", "--jq", "[.[].full_name]", "--limit", "100"]));
        return { success: true, organizations: orgs, totalRepos: repos.length };
    },
});
```

And in the Cowork Settings UI, a **GitHub Accounts** panel listing:

```
┌──────────────────────────────────────┐
│  GitHub Connected Accounts           │
├──────────────────────────────────────┤
│                                      │
│  github.com                          │
│  ┌─ @arjun (personal) ───────────┐  │
│  │ Repos: 47                      │  │
│  │ Token scope: repo, workflow,   │  │
│  │   read:org, admin:org_hook     │  │
│  └────────────────────────────────┘  │
│  ┌─ @zosmaai ─────────────────────┐  │
│  │ Organization (Owner)           │  │
│  │ Repos: 12                      │  │
│  └────────────────────────────────┘  │
│                                      │
│  [Connect another account...]        │
└──────────────────────────────────────┘
```

---

## 5. Implementation Timeline

| Day | What |
|-----|------|
| **1** | Create `fetch-git.mjs` — download portable Git for each platform. Test on Windows. |
| **2** | Create `fetch-gh.mjs` — download gh CLI for each platform. Register in tauri.conf.json bundle.resources. |
| **3** | Add PATH injection in `agent-sidecar/src/index.ts` — `buildBundledPath()` + set `process.env.PATH`. Verify git/gh found by spawned tools. |
| **4** | Create `@zosmaai/pi-github` repo — scaffold, auth probe + status tool. Verify status chip renders in Cowork. |
| **5** | Build `gh_issue_search`, `gh_issue_get`, `gh_issue_create`, `gh_issue_comment` tools. |
| **6** | Build `gh_project_list`, `gh_project_items`, `gh_project_add_item` tools (Projects v2 support). |
| **7** | Build `gh_pr_list`, `gh_pr_get`, `gh_pr_create` tools. |
| **8** | Build `gh_organizations` + `gh_repos` tools. Cowork Settings UI for GitHub status display. |
| **9** | Polish: error messages, token expiry handling, rate-limit handling, tests. |
| **10** | Ship: Publish `@zosmaai/pi-github` to npm, add Cowork Store tile, write README/docs. |

**Total: ~10 days** for the full GitHub integration + git/gh bundling.

---

## 6. Immediate Next Actions (today)

1. **Create `fetch-git.mjs`** in `src-tauri/scripts/` — copy `fetch-node.mjs`, adapt for Git
2. **Create `fetch-gh.mjs`** in `src-tauri/scripts/` — download GitHub CLI binary
3. **Add binaries to `bundle.resources`** in `tauri.conf.json`
4. **Add PATH injection** in `agent-sidecar/src/index.ts`
5. **Scaffold `@zosmaai/pi-github`** repo under `github.com/zosmaai/`
6. **Build auth probe** — first tool showing connected status + orgs
7. **Release v0.1.0** of `@zosmaai/pi-github` to npm
8. **Add Store tile** — Settings → Extensions features it as curated

---

## Cost-Benefit (Why GitHub First)

| Factor | Score |
|--------|-------|
| **PM impact** | 🔥🔥🔥🔥🔥 Issues + Projects + PRs = full PM lifecycle |
| **User base** | Every developer has a GitHub account. No new signup needed. |
| **Build speed** | Fast — `gh` CLI does 90% of the work. Extension is thin wrappers. |
| **Zero competition** | No pi GitHub extension exists. |
| **Bundling synergy** | Git + gh bundled together. Both needed for full dev workflow. |
| **Self-reinforcing** | Cowork's own repos could be managed through the extension = dogfooding. |

---

> **Next:** After GitHub ships, immediately start **Jira** (`@zosmaai/pi-jira`) and **Notion** (`@zosmaai/pi-notion`) in parallel. Both have the same auth+status+CRUD pattern. See the [full roadmap](integrations-roadmap.md) for the complete plan.
