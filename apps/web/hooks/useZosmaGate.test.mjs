import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { resolveZosmaGate } = await jiti.import("./useZosmaGate.ts");

test("keeps the loading state until the status request resolves", () => {
  assert.equal(resolveZosmaGate({ loading: true, signedIn: false }), "loading");
  assert.equal(resolveZosmaGate({ loading: true, signedIn: true }), "loading");
});

test("signed-out when this browser has no session", () => {
  assert.equal(resolveZosmaGate({ loading: false, signedIn: false }), "signed-out");
});

test("signed-in once this browser carries a session", () => {
  assert.equal(resolveZosmaGate({ loading: false, signedIn: true }), "signed-in");
});