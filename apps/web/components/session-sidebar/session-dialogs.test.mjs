import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const url = (p) => new URL(`./session-dialogs/${p}`, import.meta.url);
const shell = await readFile(url("dialog-shell.tsx"), "utf8");
const rename = await readFile(url("rename-session-dialog.tsx"), "utf8");
const del = await readFile(url("delete-session-dialog.tsx"), "utf8");

test("each dialog is a react-call Callable that resolves a value", () => {
  assert.match(rename, /createCallable<RenameProps, string \| null>/);
  assert.match(rename, /call\.end\(trimmed\)/);
  assert.match(rename, /call\.end\(null\)/);
  assert.match(del, /createCallable<DeleteProps, boolean>/);
  assert.match(del, /call\.end\(true\)/);
  assert.match(del, /call\.end\(false\)/);
});

test("dialogs are tailwind-classed, not inline-styled panels", () => {
  // backdrop + panel chrome live in DialogShell and use Tailwind classes
  assert.match(shell, /className="fixed inset-0 z-1000 flex items-center justify-center bg-black\/35"/);
  assert.match(shell, /className="w-100 max-w-\[calc\(100vw-16px\)\] overflow-hidden rounded-\[10px\] border border-\(--border\) bg-\(--bg\)/);
  // no style={{ position: "fixed", inset: 0 ... }} panel style in the dialogs
  assert.doesNotMatch(rename, /style=\{\{.*position: "fixed"/s);
});

test("rename trims and only saves a changed, non-empty name", () => {
  assert.match(rename, /const trimmed = value\.trim\(\);/);
  assert.match(rename, /const canSave = trimmed\.length > 0 && trimmed !== initialName;/);
  assert.match(rename, /if \(canSave\) call\.end\(trimmed\);/);
});
