import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { NoticeShelf } = await jiti.import("./NoticeShelf.tsx");

function render(notices, floating = false) {
  return renderToStaticMarkup(
    React.createElement(NoticeShelf, { notices, floating }),
  );
}

test("renders nothing without notices", () => {
  assert.equal(render([]), "");
});

test("renders typed accessible notices without inline presentation", () => {
  const html = render([
    { id: "info", message: "Connected", type: "info" },
    { id: "warning", message: "Check configuration", type: "warning" },
    { id: "error", message: "Connection failed", type: "error" },
    { id: "success", message: "Saved", type: "success" },
  ]);

  assert.match(html, /class="notice-shelf"/);
  for (const type of ["info", "warning", "error", "success"]) {
    assert.match(html, new RegExp(`notice-shelf-item is-${type}`));
  }
  assert.match(html, /role="alert"[^>]*aria-atomic="true"/);
  assert.equal((html.match(/role="status"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /style=/);
});

test("marks floating and exiting states", () => {
  const html = render([
    { id: "done", message: "Done", type: "success", exiting: true },
  ], true);

  assert.match(html, /notice-shelf is-floating/);
  assert.match(html, /notice-shelf-item is-success is-exiting/);
  assert.match(html, /notice-shelf-dot/);
  assert.match(html, /notice-shelf-text/);
});
