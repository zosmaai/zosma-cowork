import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("AppShell gates the whole app on the Zosma sign-in state", () => {
  assert.match(source, /import \{ useZosmaGate \} from "@\/hooks\/useZosmaGate"/);
  assert.match(source, /const zosmaGate = useZosmaGate\(\)/);
  assert.match(source, /if \(zosmaGate\.state !== "signed-in"\)/);
});

test("AppShell shows the loading placeholder before the gate resolves", () => {
  assert.match(source, /zosmaGate\.state === "loading"[\s\S]{0,200}<ZosmaLoadingState/);
});

test("AppShell shows LoginScreen for signed-out users and unlocks on success", () => {
  assert.match(source, /<LoginScreen onSignedIn=\{zosmaGate\.refresh\}/);
});