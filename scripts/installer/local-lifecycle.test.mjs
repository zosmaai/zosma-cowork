import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { makeHarness, randomHex } from "./test-helpers.mjs";

const TOKEN = randomHex(64);

function baseHarness(t, manager = "none") {
  const h = makeHarness();
  t.after(() => h.cleanup());
  h.writeConfig({
    MODE: "local",
    VERSION: "v1.2.3",
    PORT: "30141",
    BIND_ADDRESS: "127.0.0.1",
    ALLOWED_HOST: "127.0.0.1",
    PI_DIR: join(h.root, "pi"),
    WORKSPACE: "",
    IMAGE: "",
    SERVICE_MANAGER: manager,
  });
  h.writeSecrets({ DAEMON_TOKEN: TOKEN, WEB_PASSWORD: "" });
  return h;
}

function managerScript(kind) {
  return kind === "systemd"
    ? 'printf "PATH=%s\\n" "$HOME"/.local/bin\nexit 0\n'
    : 'printf "gui/%s\\n" "$(id -u)"\nexit 0\n';
}

test("start probes the recorded manager, starts the service, and health-checks", (t) => {
  const h = baseHarness(t, "systemd");
  h.plan("systemctl", managerScript("systemd"));
  h.plan("curl", "exit 0\n");
  const r = h.runCLI(["start"]);
  assert.equal(r.status, 0, r.stderr);
  const calls = h.cmdLog("systemctl").map((c) => c.args.join(" "));
  assert.ok(calls.some((c) => c.includes("show-environment")));
  assert.ok(calls.some((c) => c.includes(" start ")));
  assert.doesNotMatch(JSON.stringify(h.cmdLogAll()), new RegExp(TOKEN));
});

test("stop and restart use the recorded systemd user service", (t) => {
  const h = baseHarness(t, "systemd");
  h.plan("systemctl", managerScript("systemd"));
  h.plan("curl", "exit 0\n");
  assert.equal(h.runCLI(["stop"]).status, 0);
  assert.equal(h.runCLI(["restart"]).status, 0);
  const calls = h.cmdLog("systemctl").map((c) => c.args.join(" ")).join("\n");
  assert.match(calls, /stop/);
  assert.match(calls, /restart/);
});

test("foreground lifecycle refuses stop and restart without killing a process", (t) => {
  const h = baseHarness(t, "none");
  const stop = h.runCLI(["stop"]);
  const restart = h.runCLI(["restart"]);
  assert.equal(stop.status, 2);
  assert.equal(restart.status, 2);
  assert.match(stop.stderr + restart.stderr, /Ctrl-C|serve/i);
  assert.deepEqual(h.cmdLog("kill"), []);
});

test("status uses authenticated health and returns runtime failure when stopped", (t) => {
  const h = baseHarness(t, "none");
  h.plan("curl", "exit 0\n");
  const healthy = h.runCLI(["status"]);
  assert.equal(healthy.status, 0, healthy.stderr);
  h.plan("curl", "exit 22\n");
  const stopped = h.runCLI(["status"]);
  assert.equal(stopped.status, 5);
});

test("none start explains foreground serve and access never prints the password", (t) => {
  const h = baseHarness(t, "none");
  const start = h.runCLI(["start"]);
  assert.equal(start.status, 2);
  assert.match(start.stderr + start.stdout, /zosma serve/);
  const access = h.runCLI(["access"]);
  assert.equal(access.status, 0);
  assert.match(access.stdout, /http:\/\/127\.0\.0\.1:30141/);
  assert.doesNotMatch(access.stdout, new RegExp(TOKEN));
});

test("open health-checks before invoking the native browser", (t) => {
  const h = baseHarness(t, "none");
  h.plan("curl", "exit 0\n");
  h.plan("xdg-open", "exit 0\n");
  const r = h.runCLI(["open"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(h.cmdLog("xdg-open").length, 1);
});

test("logs explains foreground ownership and doctor remains read-only", (t) => {
  const h = baseHarness(t, "none");
  const logs = h.runCLI(["logs"]);
  assert.equal(logs.status, 0);
  assert.match(logs.stdout, /terminal|foreground/i);
  h.plan("curl", "exit 0\n");
  const doctor = h.runCLI(["doctor"]);
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.equal(existsSync(join(h.config, "zosma-cowork", "secrets")), true);
});

test("access show-password requires a TTY confirmation and writes only to the TTY", (t) => {
  const h = baseHarness(t, "none");
  h.writeConfig({
    MODE: "local", VERSION: "v1.2.3", PORT: "30141", BIND_ADDRESS: "0.0.0.0",
    ALLOWED_HOST: "cowork.example.test", PI_DIR: join(h.root, "pi"), WORKSPACE: "",
    IMAGE: "", SERVICE_MANAGER: "none",
  });
  h.writeSecrets({ DAEMON_TOKEN: TOKEN, WEB_PASSWORD: "deadbeef" });
  const r = h.runCLI(["access", "--show-password"], { tty: { input: "y\n" } });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /deadbeef/);
  assert.match(h.ttyOut(), /deadbeef/);
});
