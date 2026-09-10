import { test } from "node:test";
import assert from "node:assert/strict";
import { createLogger } from "./log.ts";

function capture() {
  const lines = [];
  const logger = createLogger({
    sink: (line) => lines.push(line),
    level: "debug",
  });
  return { logger, lines };
}

test("emits structured JSON log lines", () => {
  const { logger, lines } = capture();
  logger.info("hello", { seq: 1 });
  assert.equal(lines.length, 1);
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.level, "info");
  assert.equal(rec.msg, "hello");
  assert.equal(rec.fields.seq, 1);
  assert.equal(typeof rec.ts, "string");
});

test("honors minimum log level", () => {
  const lines = [];
  const logger = createLogger({ sink: (l) => lines.push(l), level: "warn" });
  logger.debug("silent");
  logger.info("quiet");
  logger.warn("loud");
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).level, "warn");
});

test("redacts secret keys from log records", () => {
  const { logger, lines } = capture();
  logger.info("auth", {
    token: "s3cr3t",
    apiKey: "abc",
    authorization: "Bearer xyz",
    nested: { password: "nope" },
    public: "ok",
  });
  const raw = lines[0];
  assert.ok(!raw.includes("s3cr3t"));
  assert.ok(!raw.includes("abc"));
  assert.ok(!raw.includes("xyz"));
  assert.ok(!raw.includes("nope"));
  assert.ok(raw.includes("ok"));
  const rec = JSON.parse(raw);
  assert.equal(rec.fields.token, "[REDACTED]");
  assert.equal(rec.fields.nested.password, "[REDACTED]");
  assert.equal(rec.fields.public, "ok");
});
