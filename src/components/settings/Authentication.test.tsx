/**
 * Tests for Authentication — specifically the ApiKeyRow validation flow.
 *
 * Tests:
 *   1. Tier 1 format check: wrong provider key → advisory warning hint shown + Save still allowed
 *   2. Tier 1 format check: right provider key → hint cleared + Save enabled
 *   3. Probe first: definitive 401 blocks save; network errors fall through to save
 *   4. Saved keys list visible after save
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Authentication } from "./Authentication";

// ── Mocks ────────────────────────────────────────────────────────────────

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
	invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const mockListen = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({
	listen: (...args: unknown[]) => mockListen(...args),
}));

// ── Default sidecar response factory ────────────────────────────────────

interface AuthStatus {
	providers: Array<{ id: string; type: string }>;
	supported: string[];
	apiKeyProviders: Array<{ id: string; displayName: string }>;
}

function makeAuthStatus(existingKeys: string[] = [], overrides?: Partial<AuthStatus>): AuthStatus {
	const apiKeyProviders = [
		{ id: "openrouter", displayName: "OpenRouter" },
		{ id: "anthropic", displayName: "Anthropic" },
		{ id: "openai", displayName: "OpenAI" },
		{ id: "google", displayName: "Google" },
		{ id: "groq", displayName: "Groq" },
	];
	return {
		providers: [...existingKeys.map((id) => ({ id, type: "api_key" as const }))],
		supported: ["anthropic", "github-copilot", "openai-codex"],
		apiKeyProviders,
		...overrides,
	};
}

function configureSidecar(
	authStatus?: AuthStatus,
	opts: {
		saveError?: string;
		validateResult?: Record<string, unknown>;
		validateDelay?: number;
	} = {},
) {
	const { saveError, validateResult, validateDelay = 0 } = opts;

	mockInvoke.mockImplementation((cmd: string, _args?: Record<string, unknown>) => {
		if (cmd === "get_auth_status") return Promise.resolve(authStatus ?? makeAuthStatus());
		if (cmd === "has_credentials") return Promise.resolve(true);
		if (cmd === "validate_provider_key") {
			const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
			return validateDelay
				? delay(validateDelay).then(() => validateResult ?? { ok: true })
				: Promise.resolve(validateResult ?? { ok: true });
		}
		if (cmd === "save_auth_key") {
			if (saveError) return Promise.reject(new Error(saveError));
			return Promise.resolve({ success: true });
		}
		return Promise.resolve(null);
	});

	mockListen.mockResolvedValue(() => {});
}

// ── Helpers ──────────────────────────────────────────────────────────────

async function expandApiKeyRow() {
	const button = screen.getByRole("button", { name: /api key/i });
	await act(async () => {
		fireEvent.click(button);
	});
}

async function selectProvider(label: string) {
	const select = screen.getByLabelText(/provider/i);
	await act(async () => {
		fireEvent.change(select, { target: { value: label } });
	});
}

async function typeKey(key: string) {
	const input = screen.getByPlaceholderText(/sk-…|api-key-…/i);
	await act(async () => {
		fireEvent.change(input, { target: { value: key } });
	});
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("ApiKeyRow — Tier 1 format check", () => {
	beforeEach(() => {
		configureSidecar();
	});
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("does not show a format hint when collapsed", () => {
		render(<Authentication />);
		expect(screen.queryByText(/doesn't look like/i)).not.toBeInTheDocument();
	});

	it("shows a format hint when a wrong-provider key is pasted", async () => {
		render(<Authentication />);
		await expandApiKeyRow();
		await typeKey("sk-ant-api03-0123456789abcdef");
		expect(screen.getByText(/doesn't look like.*[Oo]pen[Rr]outer/i)).toBeInTheDocument();
	});

	it("clears the format hint when the key is corrected", async () => {
		render(<Authentication />);
		await expandApiKeyRow();
		await typeKey("sk-ant-api03-0123456789abcdef");
		expect(screen.getByText(/doesn't look like/i)).toBeInTheDocument();

		await typeKey("sk-or-v1-0123456789abcdef0123456789");
		expect(screen.queryByText(/doesn't look like/i)).not.toBeInTheDocument();
	});

	it("shows format hint as advisory warning and does not disable Save", async () => {
		render(<Authentication />);
		await expandApiKeyRow();
		await typeKey("sk-ant-api03-0123456789abcdef");

		// Format hint is advisory — amber warning, not a hard blocker
		expect(screen.getByText(/doesn't look like/i)).toBeInTheDocument();
		expect(screen.getByText(/you can still save/i)).toBeInTheDocument();

		// Save button remains enabled — format check is advisory only
		const saveButton = screen.getByRole("button", { name: /save/i });
		expect(saveButton).not.toBeDisabled();
	});

	it("enables Save when format is correct", async () => {
		render(<Authentication />);
		await expandApiKeyRow();
		await typeKey("sk-or-v1-0123456789abcdef0123456789");

		const saveButton = screen.getByRole("button", { name: /save/i });
		expect(saveButton).not.toBeDisabled();
	});

	it("re-runs format check when provider picker changes", async () => {
		render(<Authentication />);
		await expandApiKeyRow();

		await selectProvider("anthropic");
		await typeKey("sk-ant-api03-0123456789abcdef");
		expect(screen.queryByText(/doesn't look like/i)).not.toBeInTheDocument();

		await selectProvider("openai");
		expect(screen.getByText(/doesn't look like.*[Oo]pen[Aa][Ii]/i)).toBeInTheDocument();
	});

	it("skips format check for unknown providers", async () => {
		const status = makeAuthStatus([], {
			apiKeyProviders: [
				{ id: "my-custom-vllm", displayName: "My Custom VLLM" },
				{ id: "openai", displayName: "OpenAI" },
			],
		});
		configureSidecar(status);
		render(<Authentication />);
		await expandApiKeyRow();

		await selectProvider("my-custom-vllm");
		await typeKey("any-random-string");
		expect(screen.queryByText(/doesn't look like/i)).not.toBeInTheDocument();
	});
});

describe("ApiKeyRow — save + probe", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("runs probe before save and saves when probe passes", async () => {
		configureSidecar(makeAuthStatus(), {
			validateResult: { ok: true },
		});
		render(<Authentication />);
		await expandApiKeyRow();
		await typeKey("sk-or-v1-0123456789abcdef0123456789");

		const saveButton = screen.getByRole("button", { name: /save/i });
		await act(async () => {
			fireEvent.click(saveButton);
		});

		// Both probe and save should have been called
		await waitFor(() => {
			expect(mockInvoke).toHaveBeenCalledWith("validate_provider_key", {
				provider: "openrouter",
				key: "sk-or-v1-0123456789abcdef0123456789",
			});
			expect(mockInvoke).toHaveBeenCalledWith("save_auth_key", {
				provider: "openrouter",
				key: "sk-or-v1-0123456789abcdef0123456789",
			});
		});
	});

	it("blocks save and shows red error when probe returns 401", async () => {
		configureSidecar(makeAuthStatus(), {
			validateResult: { ok: false, probe: { ok: false, status: 401, message: "Invalid API key." } },
		});
		render(<Authentication />);
		await expandApiKeyRow();
		await typeKey("sk-or-v1-0123456789abcdef0123456789");

		const saveButton = screen.getByRole("button", { name: /save/i });
		await act(async () => {
			fireEvent.click(saveButton);
		});

		// save_auth_key must NOT be called
		await waitFor(() => {
			expect(mockInvoke).toHaveBeenCalledWith("validate_provider_key", expect.anything());
		});
		expect(mockInvoke).not.toHaveBeenCalledWith("save_auth_key", expect.anything());

		// Error message shown in the UI
		expect(screen.getByText(/invalid api key/i)).toBeInTheDocument();
	});

	it("saves anyway when validate_provider_key throws (offline / sidecar error)", async () => {
		configureSidecar(makeAuthStatus());
		// Override just the validate call to throw
		mockInvoke.mockImplementation((cmd: string) => {
			if (cmd === "get_auth_status") return Promise.resolve(makeAuthStatus());
			if (cmd === "validate_provider_key") return Promise.reject(new Error("network error"));
			if (cmd === "save_auth_key") return Promise.resolve({ success: true });
			return Promise.resolve(null);
		});

		render(<Authentication />);
		await expandApiKeyRow();
		await typeKey("sk-or-v1-0123456789abcdef0123456789");

		const saveButton = screen.getByRole("button", { name: /save/i });
		await act(async () => {
			fireEvent.click(saveButton);
		});

		// Key saved despite probe throwing (benefit of the doubt — user may be offline)
		await waitFor(() => {
			expect(mockInvoke).toHaveBeenCalledWith("save_auth_key", {
				provider: "openrouter",
				key: "sk-or-v1-0123456789abcdef0123456789",
			});
		});
	});

	it("shows saved key providers in an always-visible list", async () => {
		const authStatus = makeAuthStatus(["openrouter"]);
		configureSidecar(authStatus);
		render(<Authentication />);

		// Should show "1 saved" in the header and a list item for OpenRouter
		// Use findByText (async) because refreshStatus is async
		await waitFor(() => {
			expect(screen.getByText(/1 saved/i)).toBeInTheDocument();
			expect(screen.getByText(/OpenRouter/i)).toBeInTheDocument();
		});
	});

	it("shows multiple saved keys when multiple are configured", async () => {
		const authStatus = makeAuthStatus(["openrouter", "anthropic"]);
		configureSidecar(authStatus);
		render(<Authentication />);

		await waitFor(() => {
			expect(screen.getByText(/2 saved/i)).toBeInTheDocument();
			expect(screen.getByText(/OpenRouter/i)).toBeInTheDocument();
			expect(screen.getByText(/Anthropic/i)).toBeInTheDocument();
		});
	});
});

describe("ApiKeyRow — delete saved key", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("shows a Delete button for each saved key", async () => {
		const authStatus = makeAuthStatus(["openrouter"]);
		configureSidecar(authStatus);
		render(<Authentication />);

		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: /delete key for openrouter/i }),
			).toBeInTheDocument();
		});
	});

	it("shows confirmation dialog when Delete is clicked", async () => {
		const authStatus = makeAuthStatus(["openrouter"]);
		configureSidecar(authStatus);
		render(<Authentication />);

		await waitFor(() => {
			expect(screen.getByText(/1 saved/i)).toBeInTheDocument();
		});

		// Click Delete
		const deleteBtn = screen.getByRole("button", { name: /delete key for openrouter/i });
		await act(async () => {
			fireEvent.click(deleteBtn);
		});

		// Confirmation dialog should appear
		expect(screen.getByText(/Delete OpenRouter key/i)).toBeInTheDocument();
		expect(screen.getByText(/This will remove the API key/i)).toBeInTheDocument();
	});

	it("calls logout_provider when Delete is confirmed", async () => {
		const authStatus = makeAuthStatus(["openrouter"]);
		configureSidecar(authStatus);
		render(<Authentication />);

		await waitFor(() => {
			expect(screen.getByText(/1 saved/i)).toBeInTheDocument();
		});

		// Click Delete → confirm dialog
		const deleteBtn = screen.getByRole("button", { name: /delete key for openrouter/i });
		await act(async () => {
			fireEvent.click(deleteBtn);
		});

		// Click the Delete button in the confirmation dialog
		const confirmBtn = screen.getByRole("button", { name: /^Delete$/i });
		await act(async () => {
			fireEvent.click(confirmBtn);
		});

		await waitFor(() => {
			expect(mockInvoke).toHaveBeenCalledWith("logout_provider", {
				provider: "openrouter",
			});
		});
	});
});
