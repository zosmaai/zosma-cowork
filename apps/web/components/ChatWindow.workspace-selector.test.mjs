import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("hero shows a workspace pill only when a cwd exists", () => {
  const heroAt = source.indexOf("function HeroView(");
  assert.notEqual(heroAt, -1, "hero view present");
  const heroBody = source.slice(heroAt, source.indexOf("interface ColumnProps", heroAt));
  assert.match(heroBody, /new-session-workspace/);
  assert.match(heroBody, /\{cwd \? \(/);
  assert.match(heroBody, />\{cwd\}<\/span>/);
});

test("surface keeps workspace wiring props (rail owns the picker)", () => {
  assert.match(source, /validatedProject\?: unknown;/);
  assert.match(source, /currentProjectKey\?: string \| null;/);
  assert.match(source, /onComposerWorkspaceSelect\?: \(cwd: string, root: string, key: string\) => void;/);
  assert.match(source, /onComposerAddFolder\?: \(\) => void;/);
});

test("single scroll container branches hero vs messages — never a layer swap", () => {
  assert.match(source, /isEmptyNew \? \(/);
  assert.match(source, /<HeroView/);
  assert.match(source, /<MessageColumn/);
  assert.doesNotMatch(source, /chat-stage-chat/);
  assert.doesNotMatch(source, /chat-stage-hero/);
  assert.doesNotMatch(source, /transition-opacity/);
});
