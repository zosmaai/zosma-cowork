import { cleanupMocks, mockInvoke } from "@/test/mocks";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the telemetry service
vi.mock("@/lib/telemetry", () => ({
	initTelemetry: vi.fn().mockResolvedValue(undefined),
	setSentryDsn: vi.fn(),
	setTelemetryEnabled: vi.fn(),
	trackEvent: vi.fn(),
}));

import { useTelemetry } from "./useTelemetry";

describe("useTelemetry", () => {
	afterEach(() => {
		cleanupMocks();
	});

	it("starts disabled when settings have no telemetry key", async () => {
		mockInvoke((cmd) => {
			if (cmd === "get_settings") return Promise.resolve({});
			return Promise.resolve(null);
		});

		const { result } = renderHook(() => useTelemetry());

		// Wait for the effect to run
		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});

		expect(result.current.isEnabled).toBe(false);
	});

	it("starts enabled when settings have telemetry.enabled true", async () => {
		mockInvoke((cmd) => {
			if (cmd === "get_settings") return Promise.resolve({ telemetry: { enabled: true } });
			return Promise.resolve(null);
		});

		const { result } = renderHook(() => useTelemetry());

		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});

		expect(result.current.isEnabled).toBe(true);
	});

	it("starts disabled when settings have telemetry.enabled false", async () => {
		mockInvoke((cmd) => {
			if (cmd === "get_settings") return Promise.resolve({ telemetry: { enabled: false } });
			return Promise.resolve(null);
		});

		const { result } = renderHook(() => useTelemetry());

		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});

		expect(result.current.isEnabled).toBe(false);
	});

	it("enable() saves settings and toggles state", async () => {
		let savedSettings: unknown = null;
		mockInvoke((cmd, args) => {
			if (cmd === "get_settings") return Promise.resolve({});
			if (cmd === "save_settings") {
				savedSettings = args?.settings;
				return Promise.resolve(null);
			}
			if (cmd === "set_telemetry_enabled") return Promise.resolve(null);
			return Promise.resolve(null);
		});

		const { result } = renderHook(() => useTelemetry());

		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});

		await act(async () => {
			await result.current.enable();
		});

		expect(result.current.isEnabled).toBe(true);
		expect(savedSettings).toEqual({ telemetry: { enabled: true } });
	});

	it("disable() saves settings and toggles state", async () => {
		let savedSettings: unknown = null;
		mockInvoke((cmd, args) => {
			if (cmd === "get_settings") return Promise.resolve({ telemetry: { enabled: true } });
			if (cmd === "save_settings") {
				savedSettings = args?.settings;
				return Promise.resolve(null);
			}
			if (cmd === "set_telemetry_enabled") return Promise.resolve(null);
			return Promise.resolve(null);
		});

		const { result } = renderHook(() => useTelemetry());

		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});

		await act(async () => {
			await result.current.disable();
		});

		expect(result.current.isEnabled).toBe(false);
		expect(savedSettings).toEqual({ telemetry: { enabled: false } });
	});

	it("trackEvent delegates to telemetry service", async () => {
		const telemetry = await import("@/lib/telemetry");
		mockInvoke((cmd) => {
			if (cmd === "get_settings") return Promise.resolve({ telemetry: { enabled: true } });
			return Promise.resolve(null);
		});

		const { result } = renderHook(() => useTelemetry());

		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});

		result.current.trackEvent("test_event", { key: "value" });

		expect(telemetry.trackEvent).toHaveBeenCalledWith("test_event", { key: "value" });
	});
});
