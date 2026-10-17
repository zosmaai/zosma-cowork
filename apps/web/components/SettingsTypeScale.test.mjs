import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (p) => readFile(new URL(p, import.meta.url), "utf8");

test("global CSS does not override Tailwind text sizes on form controls", async () => {
  const css = await read("../app/globals.css");
  // An unlayered `font: inherit` beats every Tailwind utility (utilities live in
  // @layer), forcing inputs/buttons to the 15px body size. Preflight already
  // resets controls inside the base layer.
  assert.doesNotMatch(css, /^button,\s*\ninput,\s*\ntextarea,\s*\nselect \{\s*\n\s*font: inherit;/m);
});

test("Settings controls and list rows share one 13px body size", async () => {
  const models = await read("./ModelsConfig.tsx");
  assert.match(models, /const inputStyle = \{[^}]*fontSize: 13,/);
  assert.doesNotMatch(models, /\btext-xs\b/);
  for (const file of ["./PluginsConfig.tsx", "./SkillsConfig.tsx", "./ZosmaRouterDetail.tsx"]) {
    assert.doesNotMatch(await read(file), /\btext-xs\b/, file);
  }
});

test("Settings type scale: no 10px text, field labels are 12px", async () => {
  const models = await read("./ModelsConfig.tsx");
  assert.doesNotMatch(models, /text-\[10px\]/);
  assert.match(models, /<label className="text-\[12px\] text-\(--text-muted\) font-medium">/);
});

test("provider list rows use CSS hover instead of JS style mutation", async () => {
  const models = await read("./ModelsConfig.tsx");
  assert.doesNotMatch(models, /isSelected\) e\.currentTarget\.style\.background/);
  assert.doesNotMatch(models, /isProviderSelected\) e\.currentTarget\.style\.background/);
  assert.doesNotMatch(models, /isModelSelected\) e\.currentTarget\.style\.background/);
});
