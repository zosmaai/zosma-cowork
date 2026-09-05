import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("offers friendly rotating new-session titles", () => {
  for (const title of [
    "What’s on your mind?",
    "Let’s get started",
    "Bring an idea to life",
    "What can we create together?",
    "Start with an idea",
    "Your next idea starts here",
    "Let’s make something",
    "Ready when you are",
    "Turn thoughts into action",
    "A fresh start",
  ]) {
    assert.match(source, new RegExp(title.replace(/[?]/g, "\\$&")));
  }
  assert.match(source, /newSessionTitleKey/);
  assert.match(source, /newSessionTitlesRef/);
  assert.match(source, /setNewSessionTitle\(title\)/);
  assert.match(source, /new-session-title-text">\{newSessionTitle\}<\/span>/);
});
