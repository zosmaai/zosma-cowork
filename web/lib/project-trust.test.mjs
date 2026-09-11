import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("all project resource loaders and reloads enforce project trust", async () => {
  // The web-side loaders died in the daemon cutover: the skills/plugins
  // routes are now relays and the trust gating lives in the daemon's read
  // services (daemon/src/read/{skills,plugins}.ts), covered by daemon tests.
  // This test pins the relay shape and the daemon-side gates.
  const skillsRouteSource = await readFile(new URL("../app/api/skills/route.ts", import.meta.url), "utf8");
  const skillsInstallSource = await readFile(new URL("../app/api/skills/install/route.ts", import.meta.url), "utf8");
  const pluginsSource = await readFile(new URL("../app/api/plugins/route.ts", import.meta.url), "utf8");
  const daemonSkillsSource = await readFile(new URL("../../daemon/src/read/skills.ts", import.meta.url), "utf8");
  const daemonSkillsServiceSource = await readFile(new URL("../../daemon/src/read/lib/skills-service.ts", import.meta.url), "utf8");
  const daemonPluginsSource = await readFile(new URL("../../daemon/src/read/plugins.ts", import.meta.url), "utf8");

  // Web routes are relays — no resource loaders, no npx, no settings manager.
  assert.doesNotMatch(skillsRouteSource, /DefaultResourceLoader|runNpx/);
  assert.doesNotMatch(skillsInstallSource, /runNpx|getProjectTrustStatus/);
  assert.match(skillsInstallSource, /piRead\("skills-install"/);
  assert.doesNotMatch(pluginsSource, /DefaultPackageManager|SettingsManager/);
  assert.match(pluginsSource, /piRead\("plugins-manage"/);

  // The daemon services carry the trust gates.
  assert.match(daemonSkillsSource, /getProjectTrustStatus\(cwd, getAgentDir\(\)\)\.trusted/);
  assert.match(daemonSkillsServiceSource, /loader\.reload\(projectTrustReloadOptions\(cwd, agentDir\)\)/);
  assert.match(daemonPluginsSource, /projectTrusted: projectTrust\.trusted/);
  assert.match(daemonPluginsSource, /!isGlobal && !projectTrust\.trusted/);
});

test("the trust API invalidates cached models after trusting", async () => {
  const source = await readFile(new URL("../app/api/project-trust/route.ts", import.meta.url), "utf8");

  assert.match(source, /piRead\("project-trust"/);
  assert.match(source, /invalidateModelsCache\(\)/);
  // The old busy-session wait + in-process session destroy left with the
  // daemon cutover: live sessions are daemon-owned and the SDK consults trust
  // markers per tool call, so no destroy is needed.
  assert.doesNotMatch(source, /RpcSessionForCwd/);
  assert.doesNotMatch(source, /rpc-manager/);
});
