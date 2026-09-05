import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  consumeValidatedCwd,
  searchWorkspaces,
  sessionSearchTitle,
  transientWorkspace,
  workspaceActivationCwd,
} = await jiti.import("./workspace-browser.ts");

function session(overrides = {}) {
  const id = overrides.id ?? "s1";
  const base = {
    id,
    path: `${id}.jsonl`,
    cwd: overrides.cwd ?? "/repo/a",
    projectRoot: overrides.projectRoot ?? "/repo/a",
    projectKey: overrides.projectKey ?? "/repo/a",
    created: overrides.created ?? "2026-08-22T00:00:00Z",
    modified: overrides.modified ?? "2026-08-22T00:00:00Z",
    messageCount: overrides.messageCount ?? 1,
    firstMessage: overrides.firstMessage ?? "first message for " + id,
  };
  if (overrides.name !== undefined) base.name = overrides.name;
  if (overrides.parentSessionId !== undefined) base.parentSessionId = overrides.parentSessionId;
  return base;
}

function workspace(overrides = {}) {
  return {
    key: overrides.key ?? "/repo/a",
    root: overrides.root ?? "/repo/a",
    cwd: overrides.cwd ?? "/repo/a",
    sessions: overrides.sessions ?? [],
  };
}

test("blank query returns all workspaces and sessions without mutation", () => {
  const workspaces = [
    workspace({ sessions: [session({ id: "a" }), session({ id: "b" })] }),
    workspace({ key: "/repo/b", root: "/repo/b", cwd: "/repo/b" }),
  ];
  const snapshot = JSON.parse(JSON.stringify(workspaces));
  const rows = searchWorkspaces(workspaces, "   ");
  assert.deepEqual(rows.map((row) => row.key), ["/repo/a", "/repo/b"]);
  assert.equal(rows[0].sessions.length, 2);
  assert.equal(rows[0].hasQueryMatch, true);
  assert.equal(rows[0].contextOnly, false);
  assert.deepEqual(workspaces, snapshot, "inputs must not be mutated");
});

test("workspace-root match returns all sessions", () => {
  const rows = searchWorkspaces(
    [workspace({ sessions: [session({ id: "a" }), session({ id: "b", name: "unrelated" })] })],
    "/repo/a",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sessions.length, 2);
  assert.equal(rows[0].hasQueryMatch, true);
  assert.equal(rows[0].contextOnly, false);
});

test("stored session name wins over collapsed first message; first message wins over id", () => {
  const withName = session({ id: "x", name: "Stored name", firstMessage: "different text" });
  assert.equal(sessionSearchTitle(withName), "Stored name");
  const withFirst = session({ id: "y", firstMessage: "different text" });
  assert.equal(sessionSearchTitle(withFirst), "different text");
  const fallback = session({ id: "verylongid12345", firstMessage: "" });
  assert.equal(sessionSearchTitle(fallback), "verylongid12345".slice(0, 12));

  const rows = searchWorkspaces([workspace({ sessions: [withName, withFirst] })], "STORED");
  assert.deepEqual(rows[0].sessions.map((s) => s.id), ["x"]);
});

test("child-session match includes its available parent chain in original hierarchy order", () => {
  const child = session({ id: "child", name: "leaf match", parentSessionId: "mid" });
  const mid = session({ id: "mid", name: "middle", parentSessionId: "root-s" });
  const root = session({ id: "root-s", name: "root branch" });
  const input = [child, mid, root];
  const rows = searchWorkspaces([workspace({ sessions: input })], "leaf match");
  assert.deepEqual(rows[0].sessions.map((s) => s.id), ["child", "mid", "root-s"]);
});

test("selected, running, and unread sessions plus ancestors remain as context-only results", () => {
  const child = session({ id: "c", name: "quiet child", parentSessionId: "p" });
  const parent = session({ id: "p", name: "quiet parent" });
  const rows = searchWorkspaces(
    [workspace({ sessions: [child, parent] })],
    "zzz-no-match",
    { runningSessionIds: new Set(["c"]) },
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].sessions.map((s) => s.id), ["c", "p"]);
  assert.equal(rows[0].contextOnly, true);
  assert.equal(rows[0].hasQueryMatch, false);

  const selected = searchWorkspaces(
    [workspace({ sessions: [child, parent] })],
    "zzz-no-match",
    { selectedSessionId: "p" },
  );
  assert.deepEqual(selected[0].sessions.map((s) => s.id), ["p"]);
  assert.equal(selected[0].contextOnly, true);

  const unread = searchWorkspaces(
    [workspace({ sessions: [child, parent] })],
    "zzz-no-match",
    { unreadSessionIds: new Set(["p"]) },
  );
  assert.deepEqual(unread[0].sessions.map((s) => s.id), ["p"]);
});

test("selected empty workspace remains context-only", () => {
  const rows = searchWorkspaces(
    [workspace({ key: "/empty", root: "/empty", cwd: "/empty" }), workspace()],
    "nope",
    { selectedWorkspaceKey: "/empty" },
  );
  assert.deepEqual(rows.map((row) => row.key), ["/empty"]);
  assert.equal(rows[0].contextOnly, true);
  assert.equal(rows[0].sessions.length, 0);
});

test("hasQueryMatch is false when only context remains, enabling actionable empty treatment", () => {
  const rows = searchWorkspaces(
    [workspace({ sessions: [session({ id: "a", name: "alpha" })] })],
    "beta",
    { selectedSessionId: "a" },
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hasQueryMatch, false);
  assert.equal(rows[0].contextOnly, true);
  assert.equal(rows.some((row) => row.hasQueryMatch), false);
});

test("transient row carries exact cwd and disappears when a recent project has the same key", () => {
  const validated = { cwd: "/repo/a/worktrees/feature", root: "/repo/a", key: "/repo/a" };
  const row = transientWorkspace(validated, [{ key: "/repo/a" }, { key: "/repo/b" }]);
  assert.equal(row, null, "suppressed when a recent project has the same key");

  const lone = transientWorkspace(validated, [{ key: "/repo/b" }]);
  assert.deepEqual(lone, {
    key: "/repo/a",
    root: "/repo/a",
    cwd: "/repo/a/worktrees/feature",
  });
  assert.equal(transientWorkspace(null, []), null);
});

test("consumeValidatedCwd clears only when the created session cwd matches", () => {
  const validated = { cwd: "/repo/a/worktrees/feature", root: "/repo/a", key: "/repo/a" };
  assert.equal(consumeValidatedCwd(validated, "/repo/a/worktrees/feature"), null);
  assert.deepEqual(consumeValidatedCwd(validated, "/repo/a"), validated);
  assert.equal(consumeValidatedCwd(null, "/repo/a"), null);
});

test("workspaceActivationCwd preserves current exact cwd for the already-selected key and returns row cwd for another key", () => {
  const row = { cwd: "/repo/a/worktrees/feature", key: "/repo/a" };
  assert.equal(
    workspaceActivationCwd(row, "/repo/a", "/repo/a/other-cwd"),
    "/repo/a/other-cwd",
    "already-selected key keeps the current exact cwd",
  );
  assert.equal(workspaceActivationCwd(row, "/repo/b", "/repo/a/other-cwd"), "/repo/a/worktrees/feature");
  assert.equal(workspaceActivationCwd(row, null, null), "/repo/a/worktrees/feature");
});

test("inputs are not mutated", () => {
  const workspaces = [
    workspace({
      key: "/a",
      root: "/a",
      cwd: "/a",
      sessions: [
        session({ id: "hit", name: "needle", cwd: "/a", projectRoot: "/a", projectKey: "/a" }),
        session({ id: "miss", name: "other", cwd: "/a", projectRoot: "/a", projectKey: "/a" }),
      ],
    }),
  ];
  const snapshot = JSON.parse(JSON.stringify(workspaces));
  searchWorkspaces(workspaces, "needle", {
    selectedWorkspaceKey: "/a",
    selectedSessionId: "miss",
    runningSessionIds: new Set(["miss"]),
    unreadSessionIds: new Set(["hit"]),
  });
  assert.deepEqual(workspaces, snapshot);
});
