import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Settings blue-glass elevation guards (#278).
 *
 * The Settings screen used to visually break from the rest of the app: an
 * opaque `bg-background` root, a bare 1px-divider nav rail, and flat
 * `border border-border` / `bg-card` / `bg-muted` section cards — none of the
 * elevated blue-glass language used by home, chat, the sidebar and composer.
 *
 * These guards assert Settings now reuses the existing glass/elevated design
 * system so it reads as a first-class extension of the home theme:
 *   • the root no longer paints an opaque sheet over the aurora backdrop
 *   • the desktop nav rail + mobile chrome use a glass rail surface
 *   • every settings sub-page promotes its flat cards to `.glass`
 *   • the reusable `.glass` utility carries soft shadow + inset highlight
 */
const root = resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

const appCss = read("src/App.css");
const settingsPage = read("src/components/SettingsPage.tsx");

describe("settings chrome", () => {
	it("root no longer paints an opaque bg-background over the glass shell", () => {
		expect(settingsPage).not.toContain("h-full bg-background");
	});

	it("desktop layout mirrors home: floating panel-sidebar rail + panel-raised content", () => {
		expect(settingsPage).toContain("panel-sidebar");
		expect(settingsPage).toContain("panel-raised");
		expect(settingsPage).not.toContain('borderRight: "1px solid hsl(var(--border))"');
	});

	it("sections animate in like a dashboard (keyed scale/slide transition)", () => {
		expect(settingsPage).toContain("key={activeSection}");
		expect(settingsPage).toContain("scale: 0.985");
	});

	it("mobile chrome (top bar + tab strip) drops the bare 1px divider", () => {
		expect(settingsPage).not.toContain('borderBottom: "1px solid hsl(var(--border))"');
	});

	it("keeps the active nav pill animation (layoutId)", () => {
		expect(settingsPage).toContain('layoutId="settings-nav-pill"');
	});
});

describe("reusable glass utilities (App.css)", () => {
	it("the .glass card surface carries a soft shadow + inset highlight", () => {
		expect(appCss).toMatch(/\.glass\s*\{[^}]*box-shadow/s);
	});

	it("defines a .settings-rail glass surface with backdrop blur + brand wash", () => {
		expect(appCss).toContain(".settings-rail");
		expect(appCss).toMatch(/\.settings-rail[\s\S]*?backdrop-filter:\s*blur\(/);
		expect(appCss).toMatch(/\.settings-rail[\s\S]*?--brand/);
	});
});

describe("settings sub-pages use elevated glass cards", () => {
	const pages: Array<[string, string]> = [
		["Theme", "src/components/settings/Theme.tsx"],
		["About", "src/components/settings/About.tsx"],
		["Authentication", "src/components/settings/Authentication.tsx"],
		["Custom Instructions", "src/components/CustomInstructions.tsx"],
	];

	for (const [label, path] of pages) {
		it(`${label} applies a glass surface class`, () => {
			expect(read(path)).toMatch(/\bglass\b/);
		});
	}
});

describe("settings cards drop opaque/flat fills", () => {
	it("no settings sub-page still uses an opaque bg-card block", () => {
		const files = [
			"src/components/settings/About.tsx",
			"src/components/settings/Authentication.tsx",
		];
		for (const f of files) {
			expect(read(f)).not.toContain("bg-card");
		}
	});
});
