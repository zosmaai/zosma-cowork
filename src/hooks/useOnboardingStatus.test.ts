import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOnboardingStatus } from "./useOnboardingStatus";

// Stub Tauri
vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
	listen: vi.fn(() => Promise.resolve(() => {})),
}));

const invoke = (await import("@tauri-apps/api/core")).invoke as ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("useOnboardingStatus", () => {
	it("starts loading and fetches on mount", async () => {
		invoke.mockResolvedValue({ hasExistingSetup: false, zosmaConnected: false });

		const { result } = renderHook(() => useOnboardingStatus());
		expect(result.current.loading).toBe(true);

		await act(async () => {
			await Promise.resolve();
		});

		expect(result.current.status).toEqual({
			hasExistingSetup: false,
			zosmaConnected: false,
		});
		expect(result.current.loading).toBe(false);
	});

	it("refreshes on config-reload", async () => {
		invoke
			.mockResolvedValueOnce({ hasExistingSetup: false, zosmaConnected: false })
			.mockResolvedValueOnce({ hasExistingSetup: true, zosmaConnected: false });

		const { result } = renderHook(() => useOnboardingStatus());

		await act(async () => {
			await Promise.resolve();
		});

		expect(result.current.status?.hasExistingSetup).toBe(false);

		await act(async () => {
			window.dispatchEvent(new CustomEvent("config-reload"));
			await Promise.resolve();
		});

		expect(result.current.status?.hasExistingSetup).toBe(true);
	});

	it("preserves last known status on transient failure", async () => {
		invoke
			.mockResolvedValueOnce({ hasExistingSetup: true, zosmaConnected: true })
			.mockRejectedValueOnce(new Error("sidecar not ready"));

		const { result } = renderHook(() => useOnboardingStatus());

		await act(async () => {
			await Promise.resolve();
		});

		expect(result.current.status?.zosmaConnected).toBe(true);

		await act(async () => {
			window.dispatchEvent(new CustomEvent("config-reload"));
			await Promise.resolve();
		});

		// Status preserved
		expect(result.current.status?.zosmaConnected).toBe(true);
	});

	it("keeps retrying after transient boot failures so the splash never strands", async () => {
		vi.useFakeTimers();
		invoke.mockRejectedValue(new Error("sidecar not ready"));
		renderHook(() => useOnboardingStatus());
		await act(async () => {
			await Promise.resolve();
		});
		const before = invoke.mock.calls.length;
		// Advance timers in steps, flushing the async rejection microtask after
		// each so the next retry can be scheduled. The old code stopped at 5.
		await act(async () => {
			for (let i = 0; i < 20; i++) {
				vi.advanceTimersByTime(3000);
				await Promise.resolve();
			}
		});
		expect(invoke.mock.calls.length).toBeGreaterThan(before);
		expect(invoke.mock.calls.length).toBeGreaterThan(5);
		vi.useRealTimers();
	});
});
