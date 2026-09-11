import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("./SettingsShell.tsx", import.meta.url),
  "utf8",
);

test("SettingsShell renders blurred backdrop", () => {
  assert.match(source, /settings-modal-backdrop/);
});

test("SettingsShell has six categories", () => {
  assert.match(source, /id: "models"/);
  assert.match(source, /id: "plugins"/);
  assert.match(source, /id: "skills"/);
  assert.match(source, /id: "appearance"/);
  assert.match(source, /id: "language"/);
  assert.match(source, /id: "defaults"/);
});

test("SettingsShell uses aria-modal and role=dialog", () => {
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
});

test("SettingsShell category items have role=tab and aria-selected", () => {
  assert.match(source, /role="tab"/);
  assert.match(source, /aria-selected/);
});

test("SettingsShell handles Escape key", () => {
  assert.match(source, /key.*Escape.*handleClose/);
});

test("SettingsShell handles backdrop click", () => {
  assert.match(source, /e\.target === e\.currentTarget.*handleClose/);
});

test("SettingsShell has mobile layout class", () => {
  assert.match(source, /settings-modal--mobile/);
  assert.match(source, /settings-categories--mobile/);
});

test("SettingsShell embeds ModelsContent", () => {
  assert.match(source, /ModelsContent/);
});

test("SettingsShell embeds PluginsContent", () => {
  assert.match(source, /PluginsContent/);
});

test("SettingsShell embeds SkillsContent", () => {
  assert.match(source, /SkillsContent/);
});

test("SettingsShell appearance choices set the requested theme directly", async () => {
  assert.match(source, /AppearanceSection/);
  assert.match(source, /const \{ preference, setTheme \} = useTheme\(\)/);
  assert.match(source, /setTheme\(opt\.value\)/);

  const themeSource = await readFile(new URL("../hooks/useTheme.ts", import.meta.url), "utf8");
  assert.match(themeSource, /const setTheme = useCallback/);
  assert.match(themeSource, /setTheme\(nextPreference\(ensureState\(\)\.preference\), origin\)/);
});

test("SettingsShell has Language section with locale selection", () => {
  assert.match(source, /LanguageSection/);
  assert.match(source, /setLocale/);
});

test("SettingsContent exports adapter components", async () => {
  const contentSource = await readFile(
    new URL("./SettingsContent.tsx", import.meta.url),
    "utf8",
  );
  assert.match(contentSource, /export function ModelsContent/);
  assert.match(contentSource, /export function PluginsContent/);
  assert.match(contentSource, /export function SkillsContent/);
  assert.match(contentSource, /settings-embedded-host/);
});


test("refreshes models before every unified settings close path", () => {
  assert.match(source, /const handleClose = useCallback/);
  assert.match(source, /onModelsRefresh/);
  assert.match(source, /if \(e\.key === "Escape"\) handleClose\(\)/);
  assert.match(source, /if \(e\.target === e\.currentTarget\) handleClose\(\)/);
  assert.match(source, /onClick=\{handleClose\}/);
  assert.match(source, /ModelsContent onClose=\{handleClose\}/);
});


test("SettingsShell traps focus and moves focus with category keys", () => {
  assert.match(source, /dialogRef/);
  assert.match(source, /e\.key !== "Tab"/);
  assert.match(source, /getClientRects\(\)\.length > 0/);
  assert.match(source, /querySelectorAll<HTMLButtonElement>\("\[role='tab'\]"\)\[nextIdx\]\?\.focus\(\)/);
});


test("SettingsShell mobile body stacks category rail above readable content", async () => {
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(styles, /\.settings-modal-body \{[\s\S]*?min-height: 0;/);
  assert.match(styles, /@media \(max-width: 640px\) \{[\s\S]*?\.settings-modal-body \{[\s\S]*?flex-direction: column;/);
  assert.match(styles, /\.settings-content-pane \{[\s\S]*?min-height: 0;/);
});
