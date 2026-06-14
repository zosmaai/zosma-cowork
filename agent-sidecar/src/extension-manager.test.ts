import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// extension-manager resolves all resource paths from homedir() (~/.pi/agent),
// so we point HOME at a throwaway dir per test. pi's own DefaultPackageManager
// (imported transitively) also reads homedir(), so the mock covers it too.
//
// User-scope npm resolution depends on the real global npm/pnpm root, which we
// can't fake, so these tests use PROJECT scope (`<cwd>/.pi/npm`), which pi
// resolves purely from `cwd` — fully deterministic.
let HOME = "";
vi.mock("node:os", async (orig) => {
	const actual = await orig<typeof import("node:os")>();
	return { ...actual, homedir: () => HOME };
});

import { discoverExtensions, setExtensionEnabled } from "./extension-manager.js";

const piAgent = () => join(HOME, ".pi", "agent");

/** Lay down a fake project-scope npm extension that pi will resolve from cwd. */
function installFakeProjectExt(proj: string, name: string, version = "1.0.0") {
	const projPi = join(proj, ".pi");
	const mod = join(projPi, "npm", "node_modules", name);
	mkdirSync(mod, { recursive: true });
	writeFileSync(
		join(mod, "package.json"),
		JSON.stringify({
			name,
			version,
			description: `${name} desc`,
			pi: { extensions: ["./index.js"] },
		}),
	);
	writeFileSync(join(mod, "index.js"), "export default () => {};");
	writeFileSync(join(projPi, "settings.json"), JSON.stringify({ packages: [`npm:${name}`] }));
}

beforeEach(() => {
	HOME = mkdtempSync(join(tmpdir(), "zem-home-"));
	mkdirSync(piAgent(), { recursive: true });
	writeFileSync(join(piAgent(), "settings.json"), JSON.stringify({ packages: [] }));
});

afterEach(() => {
	if (HOME && existsSync(HOME)) rmSync(HOME, { recursive: true, force: true });
});

describe("discoverExtensions (pi-native)", () => {
	it("lists a pi-installed npm extension with real metadata, installed + project scope", async () => {
		const proj = mkdtempSync(join(tmpdir(), "zem-proj-"));
		installFakeProjectExt(proj, "demo-ext", "1.2.3");

		const list = await discoverExtensions(HOME, proj);
		const ext = list.find((e) => e.id === "npm:demo-ext");
		expect(ext).toBeDefined();
		expect(ext?.installed).toBe(true);
		expect(ext?.version).toBe("1.2.3");
		expect(ext?.description).toBe("demo-ext desc");
		expect(ext?.scope).toBe("project");
		expect(ext?.name).toBe("demo-ext");
		rmSync(proj, { recursive: true, force: true });
	});

	it("does NOT resurrect stale cowork-extensions.json install-tracking ghosts", async () => {
		// No pi packages installed anywhere…
		// …but a legacy registry claims an install (the old bug that hid the
		// pi-messenger-bridge Discord setup screen).
		writeFileSync(
			join(piAgent(), "cowork-extensions.json"),
			JSON.stringify({
				extensions: {
					"pi-messenger-bridge": {
						enabled: true,
						source: { type: "npm", value: "pi-messenger-bridge" },
					},
				},
			}),
		);

		const list = await discoverExtensions(HOME);
		expect(list.find((e) => e.id.includes("messenger"))).toBeUndefined();
	});

	it("honors the enabled-preference overlay without affecting install truth", async () => {
		const proj = mkdtempSync(join(tmpdir(), "zem-proj-"));
		installFakeProjectExt(proj, "demo-ext");

		setExtensionEnabled(HOME, "npm:demo-ext", false);

		const ext = (await discoverExtensions(HOME, proj)).find((e) => e.id === "npm:demo-ext");
		expect(ext?.installed).toBe(true); // still installed
		expect(ext?.enabled).toBe(false); // but toggled off
		rmSync(proj, { recursive: true, force: true });
	});
});
