import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToString } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ZosmaAuthCard } = await jiti.import("./ZosmaAuthCard.tsx");

test("ZosmaAuthCard renders the idle sign-in state", () => {
  const html = renderToString(React.createElement(ZosmaAuthCard, { onRefresh: () => {} }));
  assert.match(html, /Zosma Router/);
  assert.match(html, /Sign in with Zosma/);
});

test("ZosmaAuthCard renders a success notice with the model count", () => {
  const html = renderToString(
    React.createElement(ZosmaAuthCard, {
      onRefresh: () => {},
      notice: { status: "success", models: 3 },
    }),
  );
  assert.match(html, /Signed in/);
  assert.match(html, /3 models/);
});

test("ZosmaAuthCard renders an error notice message", () => {
  const html = renderToString(
    React.createElement(ZosmaAuthCard, {
      onRefresh: () => {},
      notice: { status: "error", message: "Sign-in session expired." },
    }),
  );
  assert.match(html, /Sign-in session expired\./);
});
