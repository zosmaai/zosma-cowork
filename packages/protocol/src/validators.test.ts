import { test } from "node:test";
import assert from "node:assert/strict";
import { hello, say, stop, filesList, filesRead, filesStat, filesWrite, filesIndex } from "./commands.ts";
import { artifactReference, attachmentReference } from "./refs.ts";
import { message as messageEvt, agent as agentEvt } from "./events.ts";
import { helloResponse, command as commandResp } from "./responses.ts";
import { identitySchema, capabilitySchema, sessionSchema } from "./identity.ts";

test("hello validates a complete command", () => {
  const res = hello({ v: 1, cid: "c", t: "cowork.v1.command.hello", ts: 1, payload: { name: "p", version: 1 } });
  assert.equal(res.ok, true);
});

test("hello rejects an invalid payload", () => {
  const res = hello({ v: 1, cid: "c", t: "cowork.v1.command.hello", ts: 1, payload: { name: "p" } });
  assert.equal(res.ok, false);
});

test("say enforces its mode union", () => {
  const ok = say({ v: 1, cid: "c", t: "cowork.v1.command.say", ts: 1, payload: { sessionId: "s", text: "hi", mode: "thinking" } });
  assert.equal(ok.ok, true);
  const bad = say({ v: 1, cid: "c", t: "cowork.v1.command.say", ts: 1, payload: { sessionId: "s", text: "hi", mode: "nope" } });
  assert.equal(bad.ok, false);
});

test("stop carries no extra payload", () => {
  const res = stop({ v: 1, cid: "c", t: "cowork.v1.command.stop", ts: 1, payload: { sessionId: "s" } });
  assert.equal(res.ok, true);
});

test("files:list validates cwd", () => {
  const ok = filesList({ v: 1, cid: "c", t: "cowork.v1.command.files.list", ts: 1, payload: { cwd: "/srv/work" } });
  assert.equal(ok.ok, true);
  const bad = filesList({ v: 1, cid: "c", t: "cowork.v1.command.files.list", ts: 1, payload: {} });
  assert.equal(bad.ok, false);
});

test("files:stat and files:read validate cwd + relative path", () => {
  const payload = { cwd: "/srv/work", path: "notes.md" };
  assert.equal(filesStat({ v: 1, cid: "c", t: "cowork.v1.command.files.stat", ts: 1, payload }).ok, true);
  assert.equal(filesRead({ v: 1, cid: "c", t: "cowork.v1.command.files.read", ts: 1, payload }).ok, true);
  assert.equal(filesRead({ v: 1, cid: "c", t: "cowork.v1.command.files.read", ts: 1, payload: { cwd: "/srv/work" } }).ok, false);
});

test("files:write validates content and optional expectedSha256", () => {
  const ok = filesWrite({ v: 1, cid: "c", t: "cowork.v1.command.files.write", ts: 1, payload: { cwd: "/srv/work", path: "n.md", content: "hi", expectedSha256: "abc" } });
  assert.equal(ok.ok, true);
  const noSha = filesWrite({ v: 1, cid: "c", t: "cowork.v1.command.files.write", ts: 1, payload: { cwd: "/srv/work", path: "n.md", content: "hi" } });
  assert.equal(noSha.ok, true);
  const noContent = filesWrite({ v: 1, cid: "c", t: "cowork.v1.command.files.write", ts: 1, payload: { cwd: "/srv/work", path: "n.md" } });
  assert.equal(noContent.ok, false);
});

test("files:index validates cwd and optional query", () => {
  const ok = filesIndex({ v: 1, cid: "c", t: "cowork.v1.command.files.index", ts: 1, payload: { cwd: "/srv/work", query: "notes" } });
  assert.equal(ok.ok, true);
  const noQuery = filesIndex({ v: 1, cid: "c", t: "cowork.v1.command.files.index", ts: 1, payload: { cwd: "/srv/work" } });
  assert.equal(noQuery.ok, true);
});

test("artifact reference validates root + relative path shape", () => {
  const ok = artifactReference({ root: "/srv/work", path: "dist/app.js", kind: "file" });
  assert.equal(ok.ok, true);
  const noKind = artifactReference({ root: "/srv/work", path: "docs" });
  assert.equal(noKind.ok, true);
  const bad = artifactReference({ root: "/srv/work" });
  assert.equal(bad.ok, false);
});

test("attachment reference validates size and optional mime", () => {
  const ok = attachmentReference({ root: "/srv/work", path: "shot.png", size: 123 });
  assert.equal(ok.ok, true);
  const withMime = attachmentReference({ root: "/srv/work", path: "shot.png", size: 123, mime: "image/png" });
  assert.equal(withMime.ok, true);
  const bad = attachmentReference({ root: "/srv/work", path: "shot.png" });
  assert.equal(bad.ok, false);
});

test("message event validates the streaming frame", () => {
  const res = messageEvt({ v: 1, cid: "c", t: "cowork.v1.event.message", ts: 1, payload: { sessionId: "s", seq: 1, text: "hi", done: false } });
  assert.equal(res.ok, true);
});

test("agent event enforces its kind union", () => {
  const ok = agentEvt({ v: 1, cid: "c", t: "cowork.v1.event.agent", ts: 1, payload: { sessionId: "s", seq: 2, kind: "tool_call", text: "x" } });
  assert.equal(ok.ok, true);
  const bad = agentEvt({ v: 1, cid: "c", t: "cowork.v1.event.agent", ts: 1, payload: { sessionId: "s", seq: 2, kind: "nope", text: "x" } });
  assert.equal(bad.ok, false);
});

test("hello response validates its capabilities array", () => {
  const res = helloResponse({ v: 1, cid: "c", t: "cowork.v1.response.hello", ts: 1, payload: { sessionId: "s", protocolVersion: 1, capabilities: [{ name: "streaming", version: 1 }] } });
  assert.equal(res.ok, true);
});

test("command response validates its error envelope", () => {
  const ok = commandResp({ v: 1, cid: "c", t: "cowork.v1.response.command", ts: 1, payload: { sessionId: "s", ok: true } });
  assert.equal(ok.ok, true);
  const bad = commandResp({ v: 1, cid: "c", t: "cowork.v1.response.command", ts: 1, payload: { sessionId: "s", ok: "no" } });
  assert.equal(bad.ok, false);
});

test("identity/capability/session schemas are enum-validated", () => {
  assert.equal(identitySchema({ id: "a", name: "b" }).ok, true);
  assert.equal(capabilitySchema({ name: "streaming", version: 2 }).ok, true);
  assert.equal(capabilitySchema({ name: "bogus", version: 2 }).ok, false);
  assert.equal(sessionSchema({ id: "a", kind: "cloud" }).ok, true);
  assert.equal(sessionSchema({ id: "a", kind: "bogus" }).ok, false);
});

test("validation failures carry a stable, typed error code", () => {
  const res = stop({ v: 1, cid: "c", t: "cowork.v1.command.stop", ts: 1, payload: {} });
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.error.code, "missing_field");
    assert.equal(typeof res.error.message, "string");
  }
});
