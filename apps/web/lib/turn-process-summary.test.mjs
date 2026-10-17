import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  classifyTool,
  countDiffLines,
  describeToolRow,
  formatTurnProcessSummary,
  getToolDiffStat,
  summarizeTurnProcess,
} = await jiti.import("./turn-process-summary.ts");

const call = (toolName, input, id = `${toolName}-${JSON.stringify(input)}`) => ({
  type: "toolCall",
  toolCallId: id,
  toolName,
  input,
});
const result = (block, extra = {}) => ({
  role: "toolResult",
  toolCallId: block.toolCallId,
  content: [{ type: "text", text: "ok" }],
  ...extra,
});
const resultsFor = (...entries) => new Map(entries.map(([block, extra]) => [block.toolCallId, result(block, extra)]));

test("classifies tools by what they do to the user's machine", () => {
  assert.equal(classifyTool("read"), "read");
  assert.equal(classifyTool("edit"), "edit");
  assert.equal(classifyTool("write"), "edit");
  assert.equal(classifyTool("mcp_str_replace_editor"), "edit");
  assert.equal(classifyTool("bash"), "command");
  assert.equal(classifyTool("grep"), "search");
  assert.equal(classifyTool("find"), "search");
  assert.equal(classifyTool("ls"), "search");
  assert.equal(classifyTool("web_search"), "search");
  assert.equal(classifyTool("something_custom"), "other");
});

test("counts added and removed lines in a diff, ignoring file headers", () => {
  const diff = ["--- a/x", "+++ b/x", "@@ -1 +1,2 @@", " keep", "-old", "+new", "+extra"].join("\n");
  assert.deepEqual(countDiffLines(diff), { additions: 2, deletions: 1 });
  assert.deepEqual(countDiffLines("+ 1 added\n- 2 removed\n  3 same"), { additions: 1, deletions: 1 });
});

test("reads edit stats from the result diff, and write stats from the written content", () => {
  const edit = call("edit", { path: "/a.ts" });
  assert.deepEqual(
    getToolDiffStat(edit, result(edit, { details: { diff: "+one\n+two\n-three" } })),
    { additions: 2, deletions: 1 },
  );
  const write = call("write", { path: "/b.ts", content: "a\nb\nc" });
  assert.deepEqual(getToolDiffStat(write, result(write)), { additions: 3, deletions: 0 });
  assert.equal(getToolDiffStat(edit, undefined), null);
  assert.equal(getToolDiffStat(edit, result(edit, { isError: true })), null);
  assert.equal(getToolDiffStat(call("bash", { command: "ls" }), result(call("bash", {}))), null);
});

test("summarises a turn by distinct files and command count", () => {
  const r1 = call("read", { path: "/a.ts" }, "r1");
  const r2 = call("read", { path: "/a.ts" }, "r2");
  const r3 = call("read", { path: "/b.ts" }, "r3");
  const e1 = call("edit", { path: "/a.ts" }, "e1");
  const e2 = call("edit", { path: "/a.ts" }, "e2");
  const b1 = call("bash", { command: "pnpm test" }, "b1");
  const g1 = call("grep", { pattern: "x" }, "g1");
  const summary = summarizeTurnProcess(
    [r1, r2, r3, e1, e2, b1, g1, { type: "text", text: "hi" }],
    resultsFor([e1, { details: { diff: "+a\n+b\n-c" } }], [e2, { details: { diff: "+d" } }]),
  );
  assert.deepEqual(summary, { filesRead: 2, filesEdited: 1, commands: 1, searches: 1, other: 0, additions: 3, deletions: 1 });
});

test("formats the collapsed one-line summary", () => {
  const base = { filesRead: 0, filesEdited: 0, commands: 0, searches: 0, other: 0, additions: 0, deletions: 0 };
  assert.equal(
    formatTurnProcessSummary({ ...base, filesRead: 4, filesEdited: 4, commands: 2 }),
    "Read 4 files, edited 4 files, ran 2 commands",
  );
  assert.equal(formatTurnProcessSummary({ ...base, filesRead: 1, commands: 1 }), "Read 1 file, ran 1 command");
  assert.equal(formatTurnProcessSummary({ ...base, searches: 3, other: 1 }), "3 searches, 1 other tool call");
  assert.equal(formatTurnProcessSummary(base), "");
});

test("describes a row with the target visible so nothing is hidden behind the summary", () => {
  assert.deepEqual(describeToolRow(call("bash", { command: "pnpm test" }), "success", "/repo"), { verb: "Ran", target: "pnpm test", kind: "command" });
  assert.deepEqual(describeToolRow(call("edit", { path: "/repo/src/a.ts" }), "success", "/repo"), { verb: "Edited", target: "a.ts", kind: "edit" });
  assert.deepEqual(describeToolRow(call("write", { path: "/repo/src/a.ts" }), "success", "/repo"), { verb: "Wrote", target: "a.ts", kind: "edit" });
  assert.deepEqual(describeToolRow(call("read", { path: "/repo/src/a.ts" }), "success", "/repo"), { verb: "Read", target: "a.ts", kind: "read" });
  assert.deepEqual(describeToolRow(call("grep", { pattern: "foo" }), "success", "/repo"), { verb: "Searched", target: "foo", kind: "search" });
  assert.deepEqual(describeToolRow(call("bash", { command: "ls" }), "running", "/repo"), { verb: "Run", target: "ls", kind: "command" });
  assert.deepEqual(describeToolRow(call("bash", { command: "ls" }), "error", "/repo"), { verb: "Failed", target: "ls", kind: "command" });
  assert.deepEqual(describeToolRow(call("custom_tool", { q: "z" }), "success", "/repo"), { verb: "Custom tool", target: "z", kind: "other" });
});
