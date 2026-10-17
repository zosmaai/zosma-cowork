import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToString } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { ZosmaRouterDetail } = await jiti.import("./ZosmaRouterDetail.tsx");

test("ZosmaRouterDetail renders the idle sign-in state", () => {
  const html = renderToString(React.createElement(ZosmaRouterDetail, { status: null, onStatusChange: () => {}, onRefresh: () => {} }));
  assert.match(html, /Zosma Router/);
  assert.match(html, /Sign in with Zosma/);
});

test("ZosmaRouterDetail renders a success notice with the model count", () => {
  const html = renderToString(
    React.createElement(ZosmaRouterDetail, {
      status: null,
      onStatusChange: () => {},
      onRefresh: () => {},
      notice: { status: "success", models: 3 },
    }),
  );
  assert.match(html, /Signed in/);
  assert.match(html, /3 models/);
});

test("ZosmaRouterDetail renders an error notice message", () => {
  const html = renderToString(
    React.createElement(ZosmaRouterDetail, {
      status: null,
      onStatusChange: () => {},
      onRefresh: () => {},
      notice: { status: "error", message: "Sign-in session expired." },
    }),
  );
  assert.match(html, /Sign-in session expired\./);
});

const signedIn = {
  configured: true,
  pending: false,
  modelCount: 2,
  baseUrl: "https://router.zosma.ai/v1",
  authBaseUrl: "https://router.zosma.ai",
  routerBaseUrl: "https://router.zosma.ai/v1",
};
const render = (status) =>
  renderToString(
    React.createElement(ZosmaRouterDetail, {
      status,
      onStatusChange: () => {},
      onRefresh: () => {},
    }),
  );

test("ZosmaRouterDetail shows the connected state with all actions", () => {
  const html = render(signedIn);
  assert.match(html, /Connected/);
  assert.match(html, /2 models/);
  assert.match(html, /https:\/\/router\.zosma\.ai\/v1/);
  assert.match(html, /Re-sign in/);
  assert.match(html, /Refresh models/);
  assert.match(html, /Disconnect/);
});

test("ZosmaRouterDetail shows only sign-in when not connected", () => {
  const html = render(null);
  assert.match(html, /Not connected/);
  assert.match(html, /Sign in with Zosma/);
  assert.doesNotMatch(html, /Disconnect/);
  assert.doesNotMatch(html, /Refresh models/);
});

test("ModelsConfig lists Zosma Router as a selectable row, not an inline card", async () => {
  const src = await readFile(new URL("./ModelsConfig.tsx", import.meta.url), "utf8");
  assert.match(src, /type: "zosma"/);
  assert.match(src, /<ZosmaRouterDetail/);
  assert.doesNotMatch(src, /ZosmaAuthCard/);
});
