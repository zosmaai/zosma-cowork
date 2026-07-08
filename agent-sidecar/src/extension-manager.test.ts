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

import {
	bundledNpmCommand,
	discoverExtensions,
	normalizeInstallSource,
	setExtensionEnabled,
} from "./extension-manager.js";

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

describe("normalizeInstallSource", () => {
	// Regression: a bare npm name must be prefixed with `npm:`, otherwise pi's
	// package manager treats it as a local path and fails installs on a fresh
	// machine with `Path does not exist: /Users/<user>/@scope/name`.
	it("prefixes bare scoped + unscoped npm names with npm:", () => {
		expect(normalizeInstallSource("@zosmaai/pi-llm-wiki")).toBe("npm:@zosmaai/pi-llm-wiki");
		expect(normalizeInstallSource("pi-routines")).toBe("npm:pi-routines");
		expect(normalizeInstallSource("  @scope/name  ")).toBe("npm:@scope/name");
	});

	it("leaves already-schemed sources untouched", () => {
		for (const s of [
			"npm:@scope/name",
			"git:example.com/x",
			"git+https://example.com/x.git",
			"github:owner/repo",
			"https://example.com/x.tgz",
			"ssh://git@example.com/x",
			"git@github.com:owner/repo.git",
		]) {
			expect(normalizeInstallSource(s)).toBe(s);
		}
	});

	it("leaves genuine local paths untouched", () => {
		for (const s of ["./local-ext", "/abs/path", "~/dev/ext", "C:\\dev\\ext", "D:/ext"]) {
			expect(normalizeInstallSource(s)).toBe(s);
		}
	});
});

describe("bundledNpmCommand", () => {
	// Regression: on a machine with no system Node/npm (the common "not set up
	// for dev work" case), extension install must use Cowork's bundled Node+npm.
	// The Tauri host advertises the bundled npm-cli.js via ZOSMA_BUNDLED_NPM_CLI.
	it("returns [thisNode, --use-system-ca, cli] when the bundled npm exists", () => {
		const cmd = bundledNpmCommand(
			{ ZOSMA_BUNDLED_NPM_CLI: "/app/binaries/npm/bin/npm-cli.js" },
			"/app/binaries/node",
			() => true,
		);
		expect(cmd).toEqual(["/app/binaries/node", "--use-system-ca", "/app/binaries/npm/bin/npm-cli.js"]);
	});

	it("returns undefined when the env var is unset (dev / system npm fallback)", () => {
		expect(bundledNpmCommand({}, "/usr/bin/node", () => true)).toBeUndefined();
	});

	it("returns undefined when the advertised cli path is missing (never a broken stub)", () => {
		expect(
			bundledNpmCommand(
				{ ZOSMA_BUNDLED_NPM_CLI: "/app/binaries/npm/bin/npm-cli.js" },
				"/app/binaries/node",
				() => false,
			),
		).toBeUndefined();
	});
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
