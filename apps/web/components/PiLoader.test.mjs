import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { PiLoader, PI_LOADER_FRAMES } = await jiti.import("./PiLoader.tsx");

test("pi loader uses pi-tui's braille frames", () => {
  assert.deepEqual(PI_LOADER_FRAMES, ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]);
});

test("pi loader renders as an aria-hidden spinning indicator", () => {
  const html = renderToStaticMarkup(React.createElement(PiLoader));
  assert.match(html, /data-pi-loader/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /⠋/);
});

test("composer uses the pi loader instead of a circular spinner", async () => {
  const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  assert.match(source, /PiLoader/);
  assert.doesNotMatch(source, /Loader2/);
  assert.doesNotMatch(source, /animate-spin rounded-full border-2 border-current border-t-transparent/);
});

test("sidebar running indicators use the pi loader instead of the circular arc", async () => {
  const source = await readFile(new URL("./session-sidebar/session-item.tsx", import.meta.url), "utf8");
  assert.match(source, /PiLoader/);
  assert.doesNotMatch(source, /animateTransform/);
  assert.doesNotMatch(source, /M21 12a9 9 0 1 1-3.8-7.4/);
});
