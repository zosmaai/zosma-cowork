import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./useSessionLoader.ts", import.meta.url), "utf8");
const rootSource = await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8");

test("new-session startup sends only explicit browser overrides", () => {
  const ensureSource = source.slice(
    source.indexOf("const ensureNewSession"),
    source.indexOf("const loadSlashCommands"),
  );

  assert.match(ensureSource, /const selectedModel = core\.newSessionModelOverrideRef\.current;/);
  assert.doesNotMatch(ensureSource, /newSessionModel \?\? newSessionDefaultModel/);
  assert.match(ensureSource, /const selectedThinkingLevel = core\.thinkingLevelOverrideRef\.current;/);
  assert.doesNotMatch(ensureSource, /thinkingLevel !== "auto"/);
});

test("new-session startup adopts server state only while explicit overrides are unchanged", () => {
  const ensureSource = source.slice(
    source.indexOf("const ensureNewSession"),
    source.indexOf("const loadSlashCommands"),
  );

  assert.match(
    ensureSource,
    /result\.model && core\.newSessionModelOverrideRef\.current === selectedModel/,
  );
  assert.match(ensureSource, /setters\.setPendingModel\(result\.model\)/);
  assert.match(ensureSource, /setters\.setNewSessionDefaultModel\(result\.model\)/);
  assert.match(
    ensureSource,
    /core\.thinkingLevelOverrideRef\.current === selectedThinkingLevel/,
  );
  assert.match(ensureSource, /setters\.setThinkingLevel\(result\.thinkingLevel\)/);
});

test("model-list refresh does not overwrite a live session or explicit thinking override", () => {
  const loadModelsSource = rootSource.slice(
    rootSource.indexOf("const loadModels = useCallback"),
    rootSource.indexOf("const handleBuiltinSlashCommand"),
  );

  assert.match(loadModelsSource, /if \(isNew && !sessionIdRef\.current\)/);
  assert.match(
    loadModelsSource,
    /thinkingLevelOverrideRef\.current === null/,
  );
  assert.match(loadModelsSource, /setThinkingLevel\(\(pinned[\s\S]*\?\? "auto"\)/);
});
