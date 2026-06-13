import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks for the Tauri updater / process / core plugins ──────────────
const checkMock = vi.fn();
const relaunchMock = vi.fn();
const invokeMock = vi.fn();

vi.mock("@tauri-apps/plugin-updater", () => ({ check: (...a: unknown[]) => checkMock(...a) }));
vi.mock("@tauri-apps/plugin-process", () => ({
	relaunch: (...a: unknown[]) => relaunchMock(...a),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

import { useAppUpdate } from "./useAppUpdate";

/** Build a fake Tauri `Update` handle. */
function fakeUpdate(overrides: Record<string, unknown> = {}) {
	return {
		version: "1.2.3",
		currentVersion: "1.0.0",
		body: "Release notes",
		downloadAndInstall: vi.fn(async () => {}),
		...overrides,
	};
}

beforeEach(() => {
	checkMock.mockReset();
	relaunchMock.mockReset();
	invokeMock.mockReset();
	// Default install context: a direct macOS install (self-update allowed).
	invokeMock.mockImplementation((cmd: string) => {
		if (cmd === "get_install_context") {
			return Promise.resolve({ platform: "macos", isAppImage: false, channel: "direct" });
		}
		return Promise.resolve(undefined);
	});
	checkMock.mockResolvedValue(null);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("useAppUpdate", () => {
	it("does not check for updates when disabled (dev mode)", async () => {
		vi.useFakeTimers();
		renderHook(() => useAppUpdate({ enabled: false, autoCheckDelayMs: 10 }));
		await act(async () => {
			await vi.advanceTimersByTimeAsync(50);
		});
		expect(checkMock).not.toHaveBeenCalled();
	});

	it("auto-checks after the configured delay and surfaces an available update", async () => {
		checkMock.mockResolvedValue(fakeUpdate());
		const { result } = renderHook(() => useAppUpdate({ enabled: true, autoCheckDelayMs: 10 }));

		await waitFor(() => expect(result.current.status).toBe("available"));
		expect(checkMock).toHaveBeenCalledTimes(1);
		expect(result.current.info).toMatchObject({ version: "1.2.3", notes: "Release notes" });
	});

	it("reports up-to-date when check returns null", async () => {
		checkMock.mockResolvedValue(null);
		const { result } = renderHook(() => useAppUpdate({ enabled: true, autoCheckDelayMs: 10 }));
		await act(async () => {
			await result.current.checkNow();
		});
		expect(result.current.status).toBe("uptodate");
	});

	it("surfaces a managed-channel update without auto-downloading", async () => {
		invokeMock.mockImplementation((cmd: string) => {
			if (cmd === "get_install_context") {
				return Promise.resolve({ platform: "linux", isAppImage: false, channel: "direct" });
			}
			return Promise.resolve(undefined);
		});
		const update = fakeUpdate();
		checkMock.mockResolvedValue(update);

		const { result } = renderHook(() => useAppUpdate({ enabled: true, autoCheckDelayMs: 10 }));
		await waitFor(() => expect(result.current.status).toBe("managed"));
		expect(result.current.policy?.managed).toBe(true);
		expect(update.downloadAndInstall).not.toHaveBeenCalled();
	});

	it("checkNow triggers an immediate check regardless of the launch timer", async () => {
		vi.useFakeTimers();
		checkMock.mockResolvedValue(null);
		const { result } = renderHook(() => useAppUpdate({ enabled: true, autoCheckDelayMs: 100000 }));
		await act(async () => {
			await result.current.checkNow();
		});
		expect(checkMock).toHaveBeenCalledTimes(1);
	});

	it("installAndRestart downloads, installs, then relaunches", async () => {
		const update = fakeUpdate();
		checkMock.mockResolvedValue(update);
		const { result } = renderHook(() => useAppUpdate({ enabled: true, autoCheckDelayMs: 10 }));
		await waitFor(() => expect(result.current.status).toBe("available"));

		await act(async () => {
			await result.current.installAndRestart();
		});

		expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
		expect(relaunchMock).toHaveBeenCalledTimes(1);
	});

	it("tracks download progress as a percentage", async () => {
		const update = fakeUpdate({
			downloadAndInstall: vi.fn(async (cb: (ev: Record<string, unknown>) => void) => {
				cb({ event: "Started", data: { contentLength: 100 } });
				cb({ event: "Progress", data: { chunkLength: 50 } });
				cb({ event: "Progress", data: { chunkLength: 50 } });
				cb({ event: "Finished" });
			}),
		});
		checkMock.mockResolvedValue(update);
		const { result } = renderHook(() => useAppUpdate({ enabled: true, autoCheckDelayMs: 10 }));
		await waitFor(() => expect(result.current.status).toBe("available"));

		await act(async () => {
			await result.current.installAndRestart();
		});
		expect(result.current.progress).toBe(100);
	});

	it("sets an error status when the check fails", async () => {
		checkMock.mockRejectedValue(new Error("network down"));
		const { result } = renderHook(() => useAppUpdate({ enabled: true, autoCheckDelayMs: 10 }));
		await act(async () => {
			await result.current.checkNow();
		});
		expect(result.current.status).toBe("error");
		expect(result.current.error).toMatch(/network down/);
	});

	it("dismiss clears an available update back to idle", async () => {
		checkMock.mockResolvedValue(fakeUpdate());
		const { result } = renderHook(() => useAppUpdate({ enabled: true, autoCheckDelayMs: 10 }));
		await waitFor(() => expect(result.current.status).toBe("available"));
		act(() => {
			result.current.dismiss();
		});
		expect(result.current.status).toBe("idle");
	});
});
