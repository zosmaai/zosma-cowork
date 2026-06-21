# GitHub Integration: Bundle, Auth & Apps Tab

> **Simpler than it sounds.** No new pi extension. Just ship `git` + `gh`, make the user auth once, and show their orgs in the UI.

---

## The Whole Thing in One Diagram

```
┌─────────────────────────────────┐
│       Zosma Cowork App          │
│                                 │
│  ┌───────────────────────────┐  │
│  │  Settings → Apps          │  │
│  │                           │  │
│  │  ┌─ GitHub ────────────┐  │  │
│  │  │  Status: ✅ Connected│  │  │
│  │  │  ─────────────────   │  │  │
│  │  │  @arjun              │  │  │
│  │  │  @zosmaai   ★        │  │  │
│  │  │  @my-corp   (3 orgs) │  │  │
│  │  └──────────────────────┘  │  │
│  └───────────────────────────┘  │
│                                 │
│  process.env.PATH includes:     │
│    binaries/git/                │
│    binaries/gh/                 │
│    (system PATH appended)       │
│                                 │
│  pi child process inherits PATH │
│  → `git clone`, `gh issue` etc  │
│    work transparently            │
└─────────────────────────────────┘
```

---

## Step 1: Bundle Git + GitHub CLI (binary download)

Both use the exact same pattern as [`fetch-node.mjs`](../../../src-tauri/scripts/fetch-node.mjs) which already downloads Node.js per-platform.

### `src-tauri/scripts/fetch-git.mjs`

Downloads a portable Git binary per platform:

| Platform | What to Download |
|----------|-----------------|
| **Windows x64** | [Git for Windows portable](https://github.com/git-for-windows/git/releases) — extract `mingw64/bin/git.exe` + required DLLs into `src-tauri/binaries/git/` |
| **macOS (arm64 + x64)** | Check `/usr/bin/git` first. If missing, download a static build from [git-scm.com](https://git-scm.com/download/mac). |
| **Linux x64** | Check system `git` first. If missing, download [static build](https://github.com/paulirish/git-archive) (~4MB). |

**Shipped size:** ~5-30 MB depending on platform (Windows is the largest).

### `src-tauri/scripts/fetch-gh.mjs`

Downloads the official GitHub CLI binary per platform:

| Platform | GitHub CLI Asset |
|----------|-----------------|
| **Windows x64** | `gh_*_windows_amd64.zip` → `src-tauri/binaries/gh/gh.exe` |
| **macOS arm64** | `gh_*_macOS_arm64.tar.gz` → `src-tauri/binaries/gh/gh` |
| **macOS x64** | `gh_*_macOS_amd64.tar.gz` → `src-tauri/binaries/gh/gh` |
| **Linux x64** | `gh_*_linux_amd64.tar.gz` → `src-tauri/binaries/gh/gh` |

Source: https://github.com/cli/cli/releases (current: v2.92.0)

**Shipped size:** ~10 MB per platform.

### Register in Tauri bundle

```jsonc
// src-tauri/tauri.conf.json
"bundle": {
  "resources": [
    "agent-sidecar/index.cjs",
    "binaries/node",
    "binaries/node-arm64",
    "binaries/node-x64",
    "binaries/git/**",
    "binaries/gh/**"
  ]
}
```

---

## Step 2: PATH Injection in Agent-Sidecar

The agent-sidecar (`agent-sidecar/src/index.ts`) sets `process.env.PATH` once during `initAgent()`, before any pi session starts. Adds bundled binary dirs first, then appends the system PATH.

```typescript
// In agent-sidecar/src/index.ts, near the top of initAgent():

function bundledBinDir(): string {
    // In dev: resolves to <repo>/src-tauri/binaries/
    // In packaged: resolves to <bundle>/binaries/
    return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src-tauri", "binaries");
}

function buildPath(): string {
    const bin = bundledBinDir();
    const parts: string[] = [];
    const gitDir = join(bin, "git");
    const ghDir = join(bin, "gh");
    if (existsSync(gitDir)) parts.push(gitDir);
    if (existsSync(ghDir)) parts.push(ghDir);
    if (process.env.PATH) parts.push(process.env.PATH);
    return parts.join(path.delimiter);
}

process.env.PATH = buildPath();
```

That's it. Every tool call that shells out to `git` or `gh` now finds them. The pi session inherits this PATH automatically. No code change in any tool.

---

## Step 3: GitHub App in Cowork's Apps Tab

### New sidecar commands

In the agent-sidecar command switch (`agent-sidecar/src/index.ts`, the `handleCommand` function), add two new IPC commands:

```typescript
// ── gh_auth_status ─────────────────────────────
case "gh_auth_status": {
    try {
        const status = execFileSync("gh", ["auth", "status", "--show-token", "--json"], {
            encoding: "utf-8",
            timeout: 5000,
        });
        const data = JSON.parse(status);
        send({ type: "result", id: cmd.id, data: { connected: true, hosts: data.hosts } });
    } catch {
        send({ type: "result", id: cmd.id, data: { connected: false } });
    }
    break;
}

// ── gh_organizations ──────────────────────────
case "gh_organizations": {
    try {
        const orgs = execFileSync("gh", ["api", "user/memberships/orgs", "--jq", "[.[] | {login: .organization.login, role: .role}]"], {
            encoding: "utf-8",
            timeout: 5000,
        });
        const user = execFileSync("gh", ["api", "user", "--jq", "{login, name, avatar_url}"], {
            encoding: "utf-8",
            timeout: 5000,
        });
        send({
            type: "result", id: cmd.id, data: {
                user: JSON.parse(user),
                orgs: JSON.parse(orgs),
            }
        });
    } catch {
        send({ type: "error", id: cmd.id, message: "Not authenticated" });
    }
    break;
}

// ── gh_start_auth ─────────────────────────────
// Runs `gh auth login` in a subprocess, captures the
// device code, and starts polling for completion.
case "gh_start_auth": {
    // Spawn gh in a PTY or subprocess
    // Capture the device code from stdout
    // Send back: { code, url }
    // Then poll gh_auth_status every 3s until connected
    break;
}
```

### Frontend: GitHub App tile + page

New files following the exact pattern of `GoogleApp` / `DiscordApp`:

| File | Purpose |
|------|---------|
| `src/components/settings/GithubIntegration.tsx` | Launcher card in Apps list — shows Connected/Disconnected status |
| `src/components/settings/GithubApp.tsx` | Full-page GitHub setup — auth flow + org list |

### `GithubIntegration.tsx` (launcher tile)

```tsx
export function GithubIntegration({ onOpen }: { onOpen: () => void }) {
    const [connected, setConnected] = useState(false);
    const [user, setUser] = useState<string | null>(null);

    useEffect(() => {
        invoke("gh_auth_status").then((r: any) => {
            setConnected(r.connected);
            if (r.connected) {
                const gh = r.hosts?.["github.com"];
                setUser(gh?.user ?? null);
            }
        }).catch(() => setConnected(false));
    }, []);

    return (
        <button type="button" onClick={onOpen}
            className="glass w-full text-left px-3.5 py-3 flex items-center gap-3 ...">
            <span className="w-8 h-8 rounded-lg flex items-center justify-center text-[13px] font-bold shrink-0"
                style={{ background: "#24292F", color: "white" }}>G</span>
            <span className="flex-1 min-w-0">
                <span className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold">GitHub</span>
                    {connected && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-primary/10 text-primary">
                            <Check className="w-2.5 h-2.5" />
                            {user}
                        </span>
                    )}
                </span>
                <span className="block text-[11px] text-muted-foreground mt-0.5">
                    {connected ? `${orgCount} organization(s)` : "Connect your GitHub account"}
                </span>
            </span>
            <ChevronRight className="w-4 h-4 text-muted-foreground/60 shrink-0" />
        </button>
    );
}
```

### `GithubApp.tsx` (full-page setup) — Two states:

**State 1: Not connected — Device code auth**

```
┌──────────────────────────────────────────┐
│  ← Back to Apps                          │
│                                          │
│  ┌─ GitHub ───────────────────────────┐  │
│  │                                     │  │
│  │  Connect your GitHub account to     │  │
│  │  unlock issue/PR/action access      │  │
│  │  from your agent.                   │  │
│  │                                     │  │
│  │  [Connect with GitHub]              │  │
│  │                                     │  │
│  │  ── or use a Personal Access Token ─│  │
│  │  Token: [________________________]  │  │
│  │  [Verify Token]                     │  │
│  └─────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

When "Connect with GitHub" is clicked:
1. Sidecar spawns `gh auth login --web` in the background
2. Captures the device code from gh's output
3. UI shows a modal:

```
  ┌─── Authenticate with GitHub ───────────┐
  │                                        │
  │  1. Copy your one-time code:           │
  │                                        │
  │     ┌──────────────────────┐           │
  │     │   ABCD-1234          │           │
  │     └──────────────────────┘           │
  │     [Copy Code]                        │
  │                                        │
  │  2. Open this URL in your browser:     │
  │     https://github.com/login/device    │
  │     [Open in Browser ──▶]              │
  │                                        │
  │  3. Enter the code and authorize       │
  │                                        │
  │  ⏳ Waiting for authentication...       │
  │  ─────────────────────────────────     │
  │  [Cancel]                              │
  └────────────────────────────────────────┘
```

4. Sidecar polls `gh auth status` every 3s
5. When connected, modal closes, UI refreshes to state 2

**State 2: Connected — Account & org listing**

```
┌──────────────────────────────────────────┐
│  ← Back to Apps                          │
│                                          │
│  ┌─ GitHub ───────────────────────────┐  │
│  │  Status: ✅ Connected              │  │
│  │  [Disconnect]                      │  │
│  │                                     │  │
│  │  ── Personal Account ──             │  │
│  │  ┌───────────────────────────────┐  │  │
│  │  │ [avatar] @arjun               │  │  │
│  │  │         arjun@example.com     │  │  │
│  │  │         Repos: 47             │  │  │
│  │  └───────────────────────────────┘  │  │
│  │                                     │  │
│  │  ── Organizations (3) ──            │  │
│  │  ┌───────────────────────────────┐  │  │
│  │  │ [logo] @zosmaai     ★ Owner   │  │  │
│  │  │         github.com/zosmaai   │  │  │
│  │  │         Repos: 12             │  │  │
│  │  ├───────────────────────────────┤  │  │
│  │  │ [logo] @my-corp     Member   │  │  │
│  │  │         github.com/my-corp   │  │  │
│  │  │         Repos: 8             │  │  │
│  │  └───────────────────────────────┘  │  │
│  └─────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

The orgs + avatar URLs come from:
```bash
gh api user/memberships/orgs --jq '[.[] | {login: .organization.login, role: .role, avatar: .organization.avatar_url}]'
gh api user --jq '{login, name, avatar_url, email}'
```

Avatar images are < 100 bytes each (JSON URL) — Cowork's React renders them as `<img src={avatar_url}>`.

### Register in Apps.tsx

```tsx
// In src/components/settings/Apps.tsx, add:
import { GithubIntegration } from "./GithubIntegration";
import { GithubApp } from "./GithubApp";

type AppView = "list" | "discord" | "google" | "github";

// In the render:
<GithubIntegration onOpen={() => setView("github")} />
```

---

## Step 4: No pi Extension Needed

Once `git` and `gh` are on PATH:

| pi tool/skill | What it can do now |
|---------------|-------------------|
| **Bash (any tool)** | `git clone`, `git push`, `gh issue list` — works transparently |
| **pi-web-access** | GitHub repo cloning via `gh` CLI (already checks `checkGhAvailable()`) |
| **`linear-cli` skill** | Not git-related, but model learns `gh` is available via any `gh *` tool call |
| **`kubernetes-specialist` skill** | No change, unrelated |
| **Any future skill** | If it needs git, it has it |

`gh` is particularly powerful as a CLI because it wraps nearly the entire GitHub API:

```bash
# Issues
gh issue list --repo owner/repo --json number,title,state,labels
gh issue create --repo owner/repo --title "Fix bug" --body "Details"
gh issue view 123 --repo owner/repo --json assignees,projectItems

# Pull Requests
gh pr list --repo owner/repo --state open --json number,title,author
gh pr review 456 --repo owner/repo --approve
gh pr merge 456 --repo owner/repo --squash

# Projects v2
gh project list --org my-org --json number,title
gh project item-list 1 --org my-org --json title,status

# Actions
gh workflow list --repo owner/repo
gh workflow run build.yml --repo owner/repo --ref main

# Auth / Status
gh auth status --show-token --json
gh api user/memberships/orgs
gh api user --jq '{login, name}'
```

The model (pi) can call any of these via the shell tool. No dedicated pi extension wraps them. The user just needs to say _"list my open GitHub issues"_ and the model will know to use `gh issue list`.

---

## Step 5: What the User Sees End-to-End

1. **Installs Cowork** (fresh Windows machine)
2. Opens **Settings → Apps**
3. Sees **GitHub** tile in the app list
4. Clicks **GitHub** → sees "Connect your GitHub account"
5. Clicks **"Connect with GitHub"** → sees device code + URL
6. Opens browser, enters code, authorizes
7. Cowork UI refreshes → shows **@arjun** + **3 organizations** with avatars
8. **Done.** The pi session already has `git` and `gh` on PATH
9. User opens a chat: _"show my open issues in @zosmaai/code-review repo"_ → model runs `gh issue list --repo zosmaai/code-review` → returns results
10. No extension install, no token management, no configuration files

---

## Effort Summary

| Task | Files | Effort |
|------|-------|--------|
| `fetch-git.mjs` | 1 new script | ~3h |
| `fetch-gh.mjs` | 1 new script | ~2h |
| Register binaries in `tauri.conf.json` | 1 edit | 5min |
| PATH injection in `agent-sidecar/src/index.ts` | 1 edit (~10 lines) | 30min |
| `gh_auth_status` IPC command | 1 edit (~15 lines) | 30min |
| `gh_organizations` IPC command | 1 edit (~15 lines) | 30min |
| `GithubIntegration.tsx` | 1 new component | ~2h |
| `GithubApp.tsx` | 1 new component | ~4h |
| Register in `Apps.tsx` | 1 edit (~5 lines) | 15min |

**Total: ~13 hours / ~2 days**

---

## Comparison: Extension vs No-Extension

| Concern | Building pi extension | Just bundle git+gh |
|---------|---------------------|-------------------|
| **Curated tools** | 20+ hand-written tool wrappers | Zero — `gh` CLI is the API |
| **pi skills needed** | None needed | None needed — `gh` does everything |
| **Auth management** | Must handle token refresh ourselves | `gh` CLI handles it |
| **Rate limiting** | Must implement retry + backoff | `gh` CLI handles it |
| **Pagination** | Must implement cursor logic | `gh` CLI handles it with `--limit` |
| **Future API changes** | Must update extension | Just update `gh` binary |
| **npm publish** | Must package + version | Nothing to publish |
| **Cowork Store tile** | Must be featured | Not needed — it's an App, not an extension |
| **Maintenance** | Ongoing code to maintain | Zero — `gh` is the abstraction |
| **Works without PATH** | N/A (would need gh anyway) | PATH injection required once |

**Conclusion:** The "just bundle gh" approach saves ~80% of the work and eliminates ongoing maintenance.

---

> **Next:** After GitHub, **Jira** and **Notion** would follow the same pattern: bundle a CLI tool (or use REST API directly through the pi session's shell tool) + Cowork App tile for auth + status display. No pi extensions needed for any of them either.
