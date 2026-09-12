import { skillExpansionToCommand } from "./slash-display";
import type { SessionInfo } from "./types";

export interface ValidatedCwd {
  cwd: string;
  root: string;
  key: string;
}

export interface WorkspaceBrowserInput {
  key: string;
  root: string;
  cwd: string;
  sessions: SessionInfo[];
}

export interface WorkspaceBrowserRow extends WorkspaceBrowserInput {
  hasQueryMatch: boolean;
  contextOnly: boolean;
}

export interface WorkspaceSearchContext {
  selectedWorkspaceKey?: string | null;
  selectedSessionId?: string | null;
  runningSessionIds?: ReadonlySet<string>;
  unreadSessionIds?: ReadonlySet<string>;
}

/** Display/search title for a session: stored name, then collapsed first
 * message (capped), then a short id fallback. */
export function sessionSearchTitle(session: SessionInfo): string {
  const first = skillExpansionToCommand(session.firstMessage) ?? session.firstMessage;
  return session.name || first.slice(0, 50) || session.id.slice(0, 12);
}

/** The one transient validated folder, hidden once a session-derived
 * project with the same stable key exists. */
export function transientWorkspace(
  validated: ValidatedCwd | null,
  recent: readonly { key: string }[],
): Omit<WorkspaceBrowserInput, "sessions"> | null {
  if (!validated || recent.some((project) => project.key === validated.key)) return null;
  return { key: validated.key, root: validated.root, cwd: validated.cwd };
}

/** Clear the transient once its first session has been created (cwd match). */
export function consumeValidatedCwd(
  validated: ValidatedCwd | null,
  createdSessionCwd: string,
): ValidatedCwd | null {
  return validated?.cwd === createdSessionCwd ? null : validated;
}

/** Exact cwd for activating a workspace row: keep the current exact cwd
 * when the row is already selected, otherwise use the row's exact cwd. */
export function workspaceActivationCwd(
  row: Pick<WorkspaceBrowserInput, "key" | "cwd">,
  selectedWorkspaceKey: string | null,
  currentCwd: string | null,
): string {
  return row.key === selectedWorkspaceKey && currentCwd ? currentCwd : row.cwd;
}

/** Filter workspaces/sessions by query while preserving hierarchy and
 * selected/running/unread context. Pure: inputs are not mutated. */
export function searchWorkspaces(
  workspaces: readonly WorkspaceBrowserInput[],
  query: string,
  context: WorkspaceSearchContext = {},
): WorkspaceBrowserRow[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return workspaces.map((workspace) => ({
      ...workspace,
      hasQueryMatch: true,
      contextOnly: false,
    }));
  }

  const rows: WorkspaceBrowserRow[] = [];
  for (const workspace of workspaces) {
    const idToSession = new Map<string, SessionInfo>();
    for (const session of workspace.sessions) idToSession.set(session.id, session);

    const matched = new Set<string>();
    const contextOnlyIds = new Set<string>();
    let rootMatch = false;
    if (workspace.root.toLowerCase().includes(normalized) || workspace.cwd.toLowerCase().includes(normalized)) {
      rootMatch = true;
      for (const session of workspace.sessions) matched.add(session.id);
    }
    for (const session of workspace.sessions) {
      if (sessionSearchTitle(session).toLowerCase().includes(normalized)) {
        matched.add(session.id);
      }
    }

    const addContext = (sessionId: string | null | undefined) => {
      if (!sessionId) return;
      if (idToSession.has(sessionId)) contextOnlyIds.add(sessionId);
    };
    addContext(context.selectedSessionId);
    for (const id of context.runningSessionIds ?? []) addContext(id);
    for (const id of context.unreadSessionIds ?? []) addContext(id);

    const isSelectedWorkspace = context.selectedWorkspaceKey === workspace.key;

    if (!rootMatch && matched.size === 0 && contextOnlyIds.size === 0 && !isSelectedWorkspace) {
      continue;
    }

    // Include ancestors of every included session (cycle-guarded).
    const included = new Set<string>(matched);
    for (const id of contextOnlyIds) included.add(id);
    const walk = (id: string) => {
      let cursor: string | undefined = id;
      const seen = new Set<string>();
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        const parent: string | undefined = idToSession.get(cursor)?.parentSessionId;
        if (!parent || !idToSession.has(parent)) break;
        included.add(parent);
        cursor = parent;
      }
    };
    for (const id of matched) walk(id);
    for (const id of contextOnlyIds) walk(id);

    rows.push({
      ...workspace,
      sessions: workspace.sessions.filter((session) => included.has(session.id)),
      hasQueryMatch: rootMatch || matched.size > 0,
      contextOnly: !(rootMatch || matched.size > 0),
    });
  }
  return rows;
}
