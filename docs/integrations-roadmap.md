# Zosma Cowork — Integrations Roadmap

> **Status:** v0.3 | **Goal:** Make Cowork the universal hub for IT company workflows
>
> Every integration is a pi extension (npm package). Existing ones install today. Missing ones will live under `@zosmaai/pi-*` or community repos.

---

## How Integrations Work

Zosma Cowork loads pi extensions through the agent-sidecar. An extension = a TypeScript file exporting tools the LLM can call. They install via:

```bash
pi install npm:<package-name>
```

Or through the Cowork App Store (Settings → Extensions). Each gets a tile, config panel, and status chips in the footer.

**Existing pi extension pattern** (example: `pi-linear`):

```
package.json    → pi: { extensions: ["./index.ts"] }
index.ts        → export default (pi: ExtensionAPI) => { pi.registerTool({...}) }
```

**Cowork-internal extensions** ship as factory functions in `agent-sidecar/src/` and register via `extensionFactories` in `index.ts`.

---

## ✅ Already Available (install today)

These ship as community pi packages and work in Cowork immediately:

| Category | Integration | Package | Status |
|----------|-------------|---------|--------|
| **Project Mgmt** | Linear | [`pi-linear`](https://github.com/lucianojr/pi-linear) | ⭐ 9 tools: search, get, create, update, list teams/states/users, my issues, comments |
| **Messaging** | Telegram | [`pi-messenger-bridge`](https://github.com/tintinweb/pi-messenger-bridge) | Chat bridge with auth |
| **Messaging** | WhatsApp | `pi-messenger-bridge` | QR-auth bridge |
| **Messaging** | Slack | `pi-messenger-bridge` | Socket-mode bridge |
| **Messaging** | Discord | `pi-messenger-bridge` | Bot bridge |
| **Messaging** | Matrix/Element | `pi-messenger-bridge` | Bot bridge |
| **Office** | Google Drive | [`pi-google-workspace`](https://github.com/Geun-Oh/pi-google-workspace) | Drive, Docs, Sheets, Slides |
| **Office** | Gmail | [`@e9n/pi-gmail`](https://github.com/espennilsen/pi-gmail) | Read, search, compose, send |
| **Calendar** | Google Calendar | Cowork internal (`agent-sidecar/src/google-calendar/`) | Create, list, update events |
| **Documents** | OfficeCLI (docx/pptx) | Cowork internal (`agent-sidecar/src/office-docs/`) | Create, edit, preview |
| **Accounting** | TallyPrime | [`@zosmaai/pi-tally`](https://github.com/zosmaai/pi-tally) | Ledgers, vouchers, GST, reconciliation, bulk import |
| **Web** | Search & Fetch | [`pi-web-access`](https://github.com/nicobailon/pi-web-access) | Web search, URLs, GitHub repos, PDFs, YouTube |
| **Web** | Browser Harness | Cowork internal (`agent-sidecar/src/browser/`) | Agent browser: navigate, click, type, extract |
| **Scheduling** | Cron / Routines | [`pi-routines`](https://github.com/offbynan/pi-routines) | Scheduled prompts & tasks |
| **Memory** | LLM Wiki | [`@zosmaai/pi-llm-wiki`](https://github.com/zosmaai/pi-llm-wiki) | Knowledge base with auto-ingestion |
| **Memory** | Session Mgmt | [`pi-sessions`](https://github.com/thurstonsand/pi-sessions) | Session search, ask, handoff |
| **Memory** | Compaction | [`pi-blackhole`](https://github.com/k0valik/pi-blackhole) | Conversation compression |
| **Skills** | 25+ curated skills | Various | Frontend design, DevOps, Terraform, K8s, SEO, research, etc. |
| **Visuals** | Diagrams/Charts/Slides | [`@the-forge-flow/lumen`](https://github.com/the-forge-flow/lumen) | Mermaid, architecture diagrams, charts, slide decks |

---

## 🥇 Phase 1: Project Management & Development Tools

> **Target: Project Managers, Engineering Leads**
> Highest impact for the "project manager taking use of Cowork" goal.
> **Mostly zero competition** — no Jira/GitHub/Notion pi extensions exist today.

### 1.1 Jira 🚀 HIGHEST PRIORITY

**Why:** Most IT companies use Jira. No pi extension exists. PMs live in Jira.

**What to build (`@zosmaai/pi-jira`):**
- Search issues (JQL)
- Get issue details (status, assignee, sprint, priority, labels)
- Create / update issues
- Transition issues (move through workflow)
- Add comments
- List projects, boards, sprints
- List users (for assignment)
- Get sprint reports / velocity
- Create sprints

**Auth:** API token (Jira Cloud) or Basic Auth + PAT (Jira Data Center)
**Key deps:** None needed (REST API), or `jira.js` SDK optional

### 1.2 GitHub Issues & Projects 🚀

**Why:** `pi-web-access` has `gh` CLI wrappers for clone/fetch but ZERO project management tools. GitHub Issues + Projects = the highest-volume PM tool in open-source and many IT shops.

**What to build (`@zosmaai/pi-github`):**
- 🔥 **Issues:** Search, create, update, close/reopen, add labels, assign
- 🔥 **Projects v2:** List projects, add issues to projects, update project fields (status, sprint, priority)
- 🔥 **Pull Requests:** Search, review, merge, add reviewers, check CI status
- **Repos:** List repos for org, get details, manage branches
- **Actions:** List workflows, trigger runs, check status
- **Releases:** List, create, get release notes

**Auth:** GitHub PAT (`gh` CLI or direct API)
**Key deps:** None (REST + GraphQL API), or `@octokit/rest` + `@octokit/graphql`

### 1.3 Notion 🚀

**Why:** Popular for PM docs, wiki, roadmaps. No pi extension exists.

**What to build (`@zosmaai/pi-notion`):**
- Search pages/databases
- Read / create / update pages
- Query databases (filtered/sorted views)
- Create database items
- Add comments
- List users

**Auth:** Notion Internal Integration Token
**Key deps:** `@notionhq/client`

### 1.4 Confluence

**Why:** Doc-heavy orgs. Leverages existing google-workspace docs pattern.

**What to build (`@zosmaai/pi-confluence`):**
- Search pages (CQL)
- Read / create / update pages
- Add comments
- List spaces
- Attach files
- Get page hierarchy / breadcrumbs

**Auth:** API token or OAuth
**Key deps:** None (REST API) or `confluence.js`

### 1.5 GitHub Actions (skill → extension upgrade)

**Why:** The `github-actions-docs` skill only teaches _how_ to write workflows. A real extension would let Cowork _operate_ them.

**What to build (adds to `pi-github` or separate):**
- List workflows in a repo
- Trigger workflow_dispatch runs
- Check latest run status per workflow
- Cancel/re-run failed jobs
- View logs

### 1.6 Azure DevOps / Azure Boards

**Why:** Enterprise shops running Microsoft stack. No pi extension exists.

**What to build (`@zosmaai/pi-azure-devops`):**
- Work items (search, create, update, link)
- Boards, sprints, iterations
- Pull requests (create, review, complete)
- Pipelines (list, trigger, check status)
- Repos (list, branch operations)
- Wiki pages

**Auth:** AZURE_DEVOPS_PAT
**Key deps:** `azure-devops-node-api`

---

## 🥈 Phase 2: Communication & Collaboration

> **Target: All departments**
> Messaging is covered by `pi-messenger-bridge`. Missing: Teams + deeper Slack ops.

### 2.1 Microsoft Teams

**Why:** The one gap in messenger coverage. Huge enterprise adoption.

**What to build (`@zosmaai/pi-teams`):**
- Send messages to channels/users
- List channels, teams
- Read messages (search)
- Schedule meetings
- Manage tabs

**Auth:** Microsoft Graph API + OAuth
**Key deps:** `@microsoft/microsoft-graph-client`

### 2.2 Slack (deeper ops)

**Why:** `pi-messenger-bridge` covers chat bridge. Extend for ops.

**Build into or alongside:**
- Search messages (history)
- List channels, create channels, invite users
- Set channel topic/purpose
- Get user list + profiles
- Pin/unpin messages
- Create channel bookmarks

### 2.3 Email — Deeper Gmail + Outlook

**Why:** `@e9n/pi-gmail` is basic. Need labels, filters, threads, attachments.

**Gmail enhancements (`@zosmaai/pi-gmail-advanced` or contribute upstream):**
- Manage labels (create, apply, remove)
- Thread operations (reply all, forward)
- Download attachments
- Search with Gmail query syntax
- Auto-categorize / filter rules

**Outlook / Exchange (new extension):**
- Read, search, compose, send
- Calendar (meetings, availability)
- Contacts
- Mail folders

---

## 🥉 Phase 3: CRM, Sales & Customer Support

> **Target: Sales, Support, Account Management**
> Zero pi extensions in this category today.

### 3.1 HubSpot

**Why:** Most popular CRM for mid-market. No pi extension.
**What (`@zosmaai/pi-hubspot`):**
- Contacts (search, create, update)
- Companies (search, create, associate)
- Deals (create, move stage, update amount)
- Tickets (create, update, assign)
- Engagements (log calls, meetings, notes)
- Pipelines + stages
- Search all objects

**Auth:** HubSpot Private App Token
**Key deps:** None (REST API)

### 3.2 Salesforce

**Why:** Enterprise CRM standard.
**What (`@zosmaai/pi-salesforce`):**
- SOQL search
- CRUD on any object (Lead, Contact, Account, Opportunity, Case)
- Describe objects (get field lists)
- Run reports
- Manage tasks

**Auth:** JWT Bearer Flow or Username-Password + Security Token
**Key deps:** `jsforce`

### 3.3 Zendesk / Intercom / Freshdesk

**Why:** Support teams need ticket ops in their workflow.
**What (pick one, suggest Zendesk first):**
- Search tickets
- Create / update tickets
- Add comments (public/internal)
- View customer history
- Manage macros/triggers
- Satisfaction ratings

---

## 📊 Phase 4: Analytics & Observability

> **Target: DevOps, Engineering**
> Let Cowork check dashboards, query logs, investigate incidents.

### 4.1 Sentry

**Why:** `@sentry/react` already in Cowork dependencies. Extension for issue ops.
**What (`@zosmaai/pi-sentry`):**
- List unresolved issues
- Get issue details (events, stack traces, tags)
- Assign / resolve issues
- Create release tracking
- List projects, teams

**Auth:** Sentry Auth Token
**Key deps:** None (REST API)

### 4.2 Datadog / Grafana

**Why:** Engineers need to query observability without leaving the agent.
**What (`@zosmaai/pi-datadog` or `pi-grafana`):**
- Query metrics / dashboards
- List monitors, check alert status
- Mute/unmute monitors
- Search logs
- Create dashboards (basic)
- List SLOs, check burn rate

### 4.3 PagerDuty / Opsgenie

**Why:** On-call management for SRE teams.
**What:**
- List ongoing incidents
- Acknowledge / resolve incidents
- Trigger maintenance windows
- Check on-call schedules
- List services / escalation policies

---

## ☁️ Phase 5: Cloud & Infrastructure

> **Target: DevOps, Platform Engineering**
> Multiple skills exist (K8s, GKE, Terraform) but no pi extensions for cloud APIs.

### 5.1 AWS

**Why:** `@aws-sdk` already installed in pi's node_modules. Just need the extension.
**What (`@zosmaai/pi-aws`):**
- EC2: list instances, start/stop, check status
- S3: list buckets, list/upload/download objects
- Lambda: list functions, invoke, view logs
- CloudWatch: query logs, get metrics, set alarms
- ECS/EKS: list clusters, services, tasks
- IAM: list users, roles, policies

**Auth:** AWS credentials (env, ~/.aws/credentials, or IAM role)
**Key deps:** `@aws-sdk/client-ec2`, `@aws-sdk/client-s3`, etc. (already installed!)

### 5.2 GCP

**Why:** Some google-auth exists, need GCP-specific tools.
**What (`@zosmaai/pi-gcp`):**
- GKE: list clusters, get kubeconfig, check node pools
- Cloud Storage: list, upload, download
- Compute Engine: instances operations
- Cloud Run: list services, revisions
- IAM: list roles, members

**Auth:** Application Default Credentials (already flows from google-auth)
**Key deps:** `@google-cloud/*` SDKs

### 5.3 Kubernetes (extension upgrade from skill)

**Why:** `kubernetes-specialist` skill = teaching. Extension = operating.
**What (`@zosmaai/pi-k8s`):**
- List pods, deployments, services, namespaces
- Get pod logs (tail/follow)
- Describe resources
- Apply manifests
- Rollback deployments
- Port-forward (tunnel)
- Check rollout status

**Auth:** Current kubeconfig context
**Key deps: none** (kubectl exec or `@kubernetes/client-node`)

---

## 🗄️ Phase 6: Databases & Storage

> **Target: Engineering, Data Teams**
> `pg` (PostgreSQL) already in Cowork's dependencies!

### 6.1 PostgreSQL

**Why:** `postgres` npm package already in Cowork node_modules. Easiest win.
**What (`@zosmaai/pi-postgres`):**
- Run SQL queries (SELECT, INSERT, UPDATE, DELETE)
- List tables, describe schema
- Get table stats (row counts, sizes)
- Query EXPLAIN plans
- List running queries / kill queries
- Backup / export tables

**Auth:** Connection string (config in Cowork)
**Key deps:** `postgres` (already installed!)

### 6.2 MySQL / MariaDB

**What:**
- Same pattern as PostgreSQL
- Run queries, list tables, describe schema
- Manage databases, users

### 6.3 MongoDB

**What (`@zosmaai/pi-mongodb`):**
- List databases, collections
- Query documents (find, aggregate)
- Insert / update / delete documents
- Get index info
- Run explain plans

### 6.4 Redis

**What (`@zosmaai/pi-redis`):**
- GET / SET / DEL keys
- List keys by pattern
- Check memory usage, slow log
- Pub/Sub operations

### 6.5 Supabase

**Why:** Growing popularity for new projects.
**What (`@zosmaai/pi-supabase`):**
- SQL queries
- List tables, schemas
- Row-level security management
- Storage (buckets, upload, download)
- Auth (list users, manage)

---

## 🎨 Phase 7: Design & Creative

> **Target: Product, Design teams**

### 7.1 Figma

**Why:** Design handoff is a major PM/eng pain point. No pi extension.
**What (`@zosmaai/pi-figma`):**
- Get file metadata, pages, components
- Export frames as images/SVG
- Search in files
- List comments, add comments
- Get component sets, variants
- List projects, teams

**Auth:** Figma Personal Access Token
**Key deps:** None (REST API)

---

## 💰 Phase 8: Finance & Accounting (Expand)

> **Target: Finance, Operations**
> Tally is done. Add global alternatives.

### 8.1 QuickBooks Online

**Why:** US/global standard. No pi extension.
**What (`@zosmaai/pi-quickbooks`):**
- List customers, vendors, employees
- Create invoices, estimates
- Search transactions
- Get P&L, Balance Sheet reports
- Manage bills, payments
- Check sales tax

### 8.2 Xero

**What:**
- Contacts (customers, suppliers)
- Invoices (create, send, get status)
- Bank transactions, reconciliation
- Reports (P&L, Balance Sheet)
- Tax rates, tracking categories

### 8.3 Zoho Books / FreshBooks

**What:** Similar patterns to above. Follows Tally/QuickBooks template.

---

## 📝 Phase 9: Documentation & Knowledge

> **Target: All departments**

### 9.1 Notion (listed in Phase 1 — dual-use)

Handles both PM and company wiki.

### 9.2 GitBook / ReadMe / Docusaurus

**Why:** Engineering documentation platforms.
**What:**
- Read/search docs
- Create/update pages
- Manage versions, spaces

---

## 🔧 Phase 10: Platform & Tooling Infrastructure

> **Target: Platform Team**
> These are underlying capabilities that make integrations more powerful.

### 10.1 OAuth Gateway (exists, expand)

Cowork's `google-auth/` broker handles Google OAuth. Extend to:
- Microsoft (Teams, Outlook, Azure)
- Atlassian (Jira, Confluence)
- GitHub (OAuth app)
- Slack (OAuth)
- HubSpot, Salesforce

### 10.2 Credential Vault

A single encrypted store for all integration credentials:
- Environment variables per extension
- OAuth token refresh management
- UI for "Connect Service X" flow
- Encrypted at rest, decrypted at runtime
- Auto-loads into extension env on session start

### 10.3 Connector Scheduler

Bridge `pi-routines` with integrations:
- "Every morning: fetch Jira issues assigned to me, show in daily digest"
- "Weekly: send P&L from Tally to Slack channel"
- "Monitor: check Sentry errors hourly, alert if >5 new"

---

## 📋 Priority Matrix for Project Managers

Here's the focused view for the "PM takes use of Cowork" goal:

| # | Integration | PM Impact | Build Effort | Competition | Strategy |
|---|-------------|-----------|-------------|-------------|----------|
| 1 | **Jira** | 🔥🔥🔥🔥🔥 | Medium (REST API) | None | Build first — biggest PM need |
| 2 | **GitHub Issues/Projects** | 🔥🔥🔥🔥🔥 | Medium (API + GraphQL) | None | Build alongside Jira |
| 3 | **Notion** | 🔥🔥🔥🔥 | Medium (official SDK) | None | PM docs + wiki + roadmaps |
| 4 | **Confluence** | 🔥🔥🔥 | Medium (REST API) | None | For enterprise docs orgs |
| 5 | **GitHub Actions** | 🔥🔥🔥 | Low (adds to GitHub ext) | None | CI/CD visibility for PMs |
| 6 | **Azure DevOps** | 🔥🔥🔥🔥 | Medium (official SDK) | None | Enterprise .NET shops |
| 7 | **Sentry** | 🔥🔥🔥 | Low (REST API) | None | PM sees error trends |
| 8 | **PostgreSQL** | 🔥🔥 | Low (pg already installed!) | None | PM can query data directly |
| 9 | **Slack deep ops** | 🔥🔥🔥 | Low (bolt SDK installed) | Exists partial | Search history, channel mgmt |
| 10 | **HubSpot** | 🔥🔥🔥 | Medium (REST API) | None | Sales pipeline visibility |

---

## 🏗️ Strategy: Bundle CLIs, Don't Build Extensions

For most integrations, we do **not** build pi extensions. Instead:

1. **Bundle the CLI binary** with Cowork (same pattern as `fetch-node.mjs`)
2. **Inject PATH** in the agent-sidecar so the pi session finds them
3. **Build a Cowork App tile** (like Google and Discord already have) for auth + status
4. **The model uses the CLI directly** via the shell tool — no wrapper needed

This eliminates ~80% of the work and zero ongoing maintenance. The CLI handles auth, rate limits, pagination, and API changes — we just ship the binary.

### Where this applies

| Integration | CLI to Bundle | App Tile Needed? | Why No Extension |
|-------------|---------------|------------------|------------------|
| **GitHub** | `gh` CLI | ✅ Show orgs + accounts | `gh` wraps entire GitHub API — issues, PRs, projects, actions, repos |
| **Jira** | None (REST API) or `jira` CLI | ✅ Token-based auth | Model can call `curl` or `jira` CLI |
| **PostgreSQL** | `psql` CLI | ❌ Just needs config | Model can call `psql -c "SELECT..."` |
| **AWS** | `aws` CLI | ✅ Profile + status | `aws ec2 describe-instances` etc. |
| **Kubernetes** | `kubectl` CLI | ✅ Context + cluster | `kubectl get pods` etc. |

> **Note:** Some integrations like Notion, HubSpot, or Sentry don't have a CLI that wraps their full API. For those, a lightweight pi extension (or direct HTTP from the model) is the right call. But the default should always be: bundle a CLI first.

### Binary bundling pattern

Each binary gets a download script in `src-tauri/scripts/` following `fetch-node.mjs`:

```
src-tauri/
  scripts/
    fetch-node.mjs   ✓ (existing)
    fetch-git.mjs    → creates binaries/git/git
    fetch-gh.mjs     → creates binaries/gh/gh
    ...
  binaries/
    node
    node-arm64
    node-x64
    git/
    gh/
  tauri.conf.json → bundle.resources includes each
```

### PATH injection (one-time, in agent-sidecar)

```typescript
// In agent-sidecar/src/index.ts initAgent():
process.env.PATH = [
    bundledBinDir + "/git",
    bundledBinDir + "/gh",
    process.env.PATH
].join(path.delimiter);
```

### What new repos to create

We still publish **some** pi extensions for SDK-based integrations (Notion, HubSpot, etc.):

```
@zosmaai/pi-notion       # Notion SDK
@zosmaai/pi-hubspot      # HubSpot REST API
@zosmaai/pi-sentry       # Sentry REST API
```

But the bundling-approach tools live in the main Cowork repo — no separate pi package needed.

---

## 📐 Extension Pattern (template)

```
pi:
  extensions:
    - ./src/index.ts
```

**`src/index.ts`:**

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "jira_search",
    label: "Jira Search",
    description: "Search Jira issues using JQL",
    parameters: Type.Object({
      jql: Type.String({ description: "JQL query string" }),
      maxResults: Type.Optional(Type.Number({ default: 20 })),
    }),
    async execute(_toolCallId, params, _signal) {
      // ... API call
    },
  });
}
```

---

## 🧪 Testing Strategy

Each connector extension needs:
- **Unit tests** for auth/token refresh logic (vitest)
- **Integration tests** against sandbox/free-tier APIs (CI with mock or real creds)
- **Playwright E2E** in Cowork: install extension → configure → call tool → see UI
- **Rate limit handling**: every API client needs retry + backoff
- **Error messages**: meaningful messages surfaced to the user, not raw API errors

---

## 🚀 Quick-Win Implementation Plan

### Sprint 1: PM Superpack (2-3 weeks)
1. **Jira** — search, get issue, create, update, transition, comment — the "I can see my sprint" MVP
2. **GitHub** — search/create issues, list projects, add to project — PM views workload
3. **Notion** — search, read pages, query databases — knowledge base connector
4. **Release** as `@zosmaai/pi-jira`, `@zosmaai/pi-github`, `@zosmaai/pi-notion`

### Sprint 2: DevOps & Data (2 weeks)
5. **PostgreSQL** — query, schema, explain — uses already-installed `postgres` dep
6. **GitHub Actions** — workflow status, trigger runs — extends GitHub ext
7. **Sentry** — issue list, resolve, assign — quick REST API

### Sprint 3: Comms & CRM (2 weeks)
8. **Confluence** — search, read, create spaces/pages
9. **HubSpot** — contacts, deals, tickets
10. **Azure DevOps** — work items, PRs, pipelines

### Sprint 4: Cloud & Infrastructure (3 weeks)
11. **AWS** — EC2, S3, Lambda, CloudWatch
12. **Kubernetes** — pods, logs, deployments
13. **Teams** — messaging, meetings
14. **Figma** — designs, comments, export

### Sprint 5: Finance & Platform (2 weeks)
15. **QuickBooks** — invoices, reports, customers
16. **Datadog** — monitors, metrics, logs
17. **Credential Vault** — unified auth store
18. **Connector Scheduler** — cron + integrations

---

## 📊 Impact per Department

| Department | Integrations | Count |
|-----------|-------------|-------|
| **Project Management** | Jira, GitHub Issues/Projects, Notion, Confluence, Azure DevOps, Linear ✅ | **6** (5 new) |
| **Engineering** | GitHub PRs/CI, Sentry, PostgreSQL, MongoDB, K8s, AWS, GCP, Datadog, PagerDuty | **9** (all new) |
| **Sales / CRM** | HubSpot, Salesforce, Zendesk | **3** (all new) |
| **Finance / Ops** | Tally ✅, QuickBooks, Xero | **3** (2 new) |
| **Design** | Figma | **1** (new) |
| **Support** | Slack, Teams, Discord ✅, Telegram ✅, Zendesk | **5** (1 new) |
| **All Hands** | Gmail ✅, Google Calendar ✅, Google Drive ✅, OfficeCLI ✅, Notion, Confluence | **6** (2 new) |

**Total: 33 integrations** (17 existing + 16 new connectors to build)

---

## 🎯 First Actions

1. **Build Jira extension** (`@zosmaai/pi-jira`) — highest impact, zero competition, PMs need it
2. **Build GitHub extension** (`@zosmaai/pi-github`) — used by every dev team, complements Linear
3. **Build Notion extension** (`@zosmaai/pi-notion`) — the "second brain" connector
4. **Build PostgreSQL extension** (`@zosmaai/pi-postgres`) — trivial effort, huge value
5. **Publish all under @zosmaai namespace** on npm
6. **Add Cowork App Store tiles** for each (curated featured section)
7. **Write integration docs** showing PMs: "Connect Jira in 2 minutes"

---

> **Principle:** Bundle CLI tools with the desktop app. The pi model already knows how to call CLI tools. Auth and status live in Cowork's Apps tab. No pi extensions needed for connectors — just ship the binary and let the model use it.
