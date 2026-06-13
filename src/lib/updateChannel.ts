/**
 * In-app update channel policy (issue #271).
 *
 * The Tauri v2 updater can self-replace the running binary, but that is only
 * appropriate for installs the app actually *owns*. Builds installed via a
 * package manager (Homebrew / AUR / Winget) must NOT self-update — the package
 * manager owns the binary and an in-app update would silently desync it.
 *
 * Inputs come from the running process (see the `get_install_context` Tauri
 * command): the OS platform, whether we are executing from an AppImage, and a
 * compile-time channel marker baked into the bundle.
 */

export type UpdateChannel = "direct" | "managed" | (string & {});

export interface InstallContext {
	/** Normalised platform: "macos" | "windows" | "linux" (others = unknown). */
	platform: string;
	/** True when the Linux process is running from an AppImage (APPIMAGE env set). */
	isAppImage: boolean;
	/** Compile-time distribution channel. "managed" = package-manager build. */
	channel: UpdateChannel;
}

export interface UpdatePolicy {
	/** Whether the in-app updater may download/install/relaunch. */
	canSelfUpdate: boolean;
	/** True when a package manager owns the binary (surface a notice instead). */
	managed: boolean;
	/** Human-readable explanation for the UI. */
	reason: string;
}

const MANAGED_REASON =
	"This build is managed by your package manager — update it there to stay in sync.";

export function resolveUpdatePolicy(ctx: InstallContext): UpdatePolicy {
	// A package-manager build is always managed, regardless of platform/payload.
	if (ctx.channel === "managed") {
		return { canSelfUpdate: false, managed: true, reason: MANAGED_REASON };
	}

	switch (ctx.platform) {
		case "macos":
		case "windows":
			return { canSelfUpdate: true, managed: false, reason: "" };
		case "linux":
			// The Tauri updater only supports AppImage self-replacement on Linux.
			// A .deb / system install can't be replaced from inside the app.
			return ctx.isAppImage
				? { canSelfUpdate: true, managed: false, reason: "" }
				: { canSelfUpdate: false, managed: true, reason: MANAGED_REASON };
		default:
			// Fail safe: never attempt a self-update on an unrecognised platform.
			return {
				canSelfUpdate: false,
				managed: false,
				reason: "In-app updates are not available on this platform.",
			};
	}
}
