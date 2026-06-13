import { describe, expect, it } from "vitest";
import { type InstallContext, resolveUpdatePolicy } from "./updateChannel";

function ctx(overrides: Partial<InstallContext> = {}): InstallContext {
	return {
		platform: "macos",
		isAppImage: false,
		channel: "direct",
		...overrides,
	};
}

describe("resolveUpdatePolicy", () => {
	it("allows self-update for a direct macOS install", () => {
		const policy = resolveUpdatePolicy(ctx({ platform: "macos", channel: "direct" }));
		expect(policy.canSelfUpdate).toBe(true);
		expect(policy.managed).toBe(false);
	});

	it("allows self-update for a direct Windows install", () => {
		const policy = resolveUpdatePolicy(ctx({ platform: "windows", channel: "direct" }));
		expect(policy.canSelfUpdate).toBe(true);
		expect(policy.managed).toBe(false);
	});

	it("blocks self-update for a package-manager (managed) build and explains why", () => {
		const policy = resolveUpdatePolicy(ctx({ platform: "macos", channel: "managed" }));
		expect(policy.canSelfUpdate).toBe(false);
		expect(policy.managed).toBe(true);
		expect(policy.reason).toMatch(/package manager/i);
	});

	it("allows self-update on Linux only when running as an AppImage", () => {
		const policy = resolveUpdatePolicy(ctx({ platform: "linux", isAppImage: true }));
		expect(policy.canSelfUpdate).toBe(true);
		expect(policy.managed).toBe(false);
	});

	it("blocks self-update on Linux .deb installs (not an AppImage)", () => {
		const policy = resolveUpdatePolicy(ctx({ platform: "linux", isAppImage: false }));
		expect(policy.canSelfUpdate).toBe(false);
		expect(policy.managed).toBe(true);
		expect(policy.reason).toMatch(/package manager/i);
	});

	it("treats a managed channel as managed even on Linux AppImage", () => {
		// e.g. an AUR package that happens to ship an AppImage payload —
		// the package manager still owns the binary, so never self-update.
		const policy = resolveUpdatePolicy(
			ctx({ platform: "linux", isAppImage: true, channel: "managed" }),
		);
		expect(policy.canSelfUpdate).toBe(false);
		expect(policy.managed).toBe(true);
	});

	it("defaults unknown platforms to no self-update (fail safe)", () => {
		const policy = resolveUpdatePolicy(ctx({ platform: "freebsd", channel: "direct" }));
		expect(policy.canSelfUpdate).toBe(false);
	});
});
