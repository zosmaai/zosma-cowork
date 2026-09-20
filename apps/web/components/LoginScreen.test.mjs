import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import React from "react";
import { renderToString } from "react-dom/server";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { LoginScreen } = await jiti.import("./LoginScreen.tsx");
const { I18nProvider } = await jiti.import("../hooks/useI18n.tsx");

const source = fs.readFileSync(new URL("./LoginScreen.tsx", import.meta.url), "utf8");

function render(props = {}) {
  return renderToString(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(LoginScreen, { onSignedIn: () => {}, ...props }),
    ),
  );
}

test("LoginScreen renders the Zosma brand headline", () => {
  assert.match(render(), /Sign in to Zosma/);
});

test("LoginScreen offers a Google sign-in button", () => {
  assert.match(render(), /Continue with Google/);
});

test("LoginScreen has no email or account-password fields", () => {
  const html = render();
  assert.doesNotMatch(html, /type="email"/);
  // The single masked input is the router-key fallback, not a password login.
  assert.equal(html.match(/type="password"/g)?.length, 1);
  assert.match(html, /Zosma Router key/);
});

test("LoginScreen says link, not browser, when it runs in a plain browser", () => {
  assert.match(source, /isTauri\(window\)/);
  assert.match(source, /auth\.openingLink/);
  assert.match(source, /auth\.openingBrowser/);
});

test("LoginScreen always offers the router-key fallback", () => {
  assert.match(source, /submitApiKey/);
  assert.match(source, /auth\.keyFallback/);
});

test("LoginScreen starts the Zosma PKCE flow on click", () => {
  assert.match(source, /const \{ phase, error, start/);
  assert.match(source, /void start\(\)/);
});

test("LoginScreen reports completion so the gate can re-check status", () => {
  assert.match(source, /useZosmaAuth\(\{\s*onCompleted: onSignedIn,?\s*\}\)/);
});

test("LoginScreen offers the manual-paste fallback while waiting", () => {
  assert.match(source, /submitManual/);
  assert.match(source, /role="alert"|\{shownError\}/);
});