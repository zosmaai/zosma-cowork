import { describe, expect, it } from "vitest";
import { DOWNLOAD_URLS } from "./officecli-resolver.js";

/**
 * Regression guards for the OfficeCLI auto-download URLs.
 *
 * The upstream release (github.com/iOfficeAI/OfficeCLI) ships ONE self-contained
 * binary per platform (no archive) and names them `officecli-<os>-<arch>` using
 * `win`/`mac` (not `windows`/`macos`). A previous version pointed at
 * `officecli-windows-x64.zip` / `officecli-macos-x64.tar.gz` /
 * `officecli-linux-x64.tar.gz`, which 404'd on EVERY platform — so the binary
 * never downloaded and the whole "create document" tool was broken.
 */
describe("OfficeCLI download URLs", () => {
	const platforms = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64"];

	it("covers every platform the sidecar can run on", () => {
		for (const p of platforms) {
			expect(DOWNLOAD_URLS[p], `missing download URL for ${p}`).toBeTruthy();
		}
	});

	it("uses the real upstream asset names (win/mac, no archive extension)", () => {
		for (const url of Object.values(DOWNLOAD_URLS)) {
			// The old, broken names must never come back.
			expect(url).not.toMatch(/officecli-windows-/);
			expect(url).not.toMatch(/officecli-macos-/);
			expect(url).not.toMatch(/\.tar\.gz$/);
			expect(url).not.toMatch(/\.zip$/);
		}
		// Spot-check the exact assets that exist on the release.
		expect(DOWNLOAD_URLS["win32-x64"]).toMatch(/officecli-win-x64\.exe$/);
		expect(DOWNLOAD_URLS["darwin-arm64"]).toMatch(/officecli-mac-arm64$/);
		expect(DOWNLOAD_URLS["linux-x64"]).toMatch(/officecli-linux-x64$/);
	});

	it("points at the official OfficeCLI releases", () => {
		for (const url of Object.values(DOWNLOAD_URLS)) {
			expect(url).toMatch(
				/^https:\/\/github\.com\/iOfficeAI\/OfficeCLI\/releases\/latest\/download\//,
			);
		}
	});
});
