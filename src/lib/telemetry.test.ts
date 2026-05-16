import { afterEach, describe, expect, it, vi } from "vitest";

// Mock invoke before importing the module under test
const mockInvoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
	invoke: mockInvoke,
}));

// Mock @sentry/react before importing
const mockSentryInit = vi.fn();
vi.mock("@sentry/react", () => ({
	init: mockSentryInit,
	reactErrorHandler: vi.fn(() => vi.fn()),
}));

const { initTelemetry, resetTelemetry, setTelemetryEnabled, setSentryDsn, trackEvent } =
	await import("./telemetry");

describe("telemetry service", () => {
	afterEach(() => {
		vi.clearAllMocks();
		resetTelemetry();
	});

	describe("trackEvent with consent OFF", () => {
		it("does not call invoke when consent is off", () => {
			trackEvent("test_event");
			expect(mockInvoke).not.toHaveBeenCalled();
		});

		it("does not forward props when consent is off", () => {
			trackEvent("test_event", { key: "value" });
			expect(mockInvoke).not.toHaveBeenCalled();
		});
	});

	describe("trackEvent with consent ON", () => {
		it("calls invoke with event name", () => {
			setTelemetryEnabled(true);
			trackEvent("test_event");
			expect(mockInvoke).toHaveBeenCalledWith("track_analytics_event", {
				name: "test_event",
				props: null,
			});
		});

		it("forwards props to invoke", () => {
			setTelemetryEnabled(true);
			const props = { key: "value", count: 42 };
			trackEvent("test_event", props);
			expect(mockInvoke).toHaveBeenCalledWith("track_analytics_event", {
				name: "test_event",
				props,
			});
		});

		it("calls set_analytics_enabled when setTelemetryEnabled is called", () => {
			vi.clearAllMocks();
			setTelemetryEnabled(true);
			expect(mockInvoke).toHaveBeenCalledWith("set_analytics_enabled", {
				enabled: true,
			});
		});
	});

	describe("setTelemetryEnabled", () => {
		it("enables future trackEvent calls", () => {
			setTelemetryEnabled(true);
			trackEvent("after_enable");
			expect(mockInvoke).toHaveBeenCalledWith("track_analytics_event", {
				name: "after_enable",
				props: null,
			});
		});

		it("disables future trackEvent calls", () => {
			setTelemetryEnabled(true);
			setTelemetryEnabled(false);
			trackEvent("after_disable");
			expect(mockInvoke).not.toHaveBeenCalledWith("track_analytics_event", expect.anything());
		});
	});

	describe("initTelemetry", () => {
		it("can be called multiple times safely", async () => {
			await initTelemetry(true);
			await initTelemetry(false);
			await initTelemetry(true);
			trackEvent("multi_init");
			expect(mockInvoke).toHaveBeenCalledWith("track_analytics_event", {
				name: "multi_init",
				props: null,
			});
		});
	});

	describe("error handling", () => {
		it("does not throw when invoke rejects", () => {
			setTelemetryEnabled(true);
			mockInvoke.mockRejectedValueOnce(new Error("network error"));
			expect(() => trackEvent("fail_event")).not.toThrow();
		});
	});

	describe("Sentry integration", () => {
		it("initializes Sentry when consent is enabled and DSN is set", async () => {
			setSentryDsn("https://key@sentry.io/project");

			await initTelemetry(true);

			expect(mockSentryInit).toHaveBeenCalledWith(
				expect.objectContaining({
					dsn: "https://key@sentry.io/project",
				}),
			);
		});

		it("does not initialize Sentry when DSN is not set", async () => {
			setSentryDsn("");

			await initTelemetry(true);

			expect(mockSentryInit).not.toHaveBeenCalled();
		});

		it("does not initialize Sentry when consent is off", async () => {
			setSentryDsn("https://key@sentry.io/project");

			await initTelemetry(false);

			expect(mockSentryInit).not.toHaveBeenCalled();
		});

		it("only initializes Sentry once", async () => {
			setSentryDsn("https://key@sentry.io/project");

			await initTelemetry(true);
			await initTelemetry(false);
			await initTelemetry(true);

			expect(mockSentryInit).toHaveBeenCalledTimes(1);
		});
	});
});
