import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Boundary mocks ────────────────────────────────────────────────────────────
// LoginScreen uses authClient.signIn.social() with disableRedirect:true,
// then passes the returned url to openUrl(). We mock both boundaries.

const { mockOpenUrl, mockSignInSocial } = vi.hoisted(() => ({
	mockOpenUrl: vi.fn(),
	mockSignInSocial: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
	openUrl: mockOpenUrl,
}));

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		signIn: { social: mockSignInSocial },
	},
	AUTH_URL: "http://localhost:3000",
}));

import { LoginScreen } from "@/components/LoginScreen";

const MOCK_OAUTH_URL = "https://accounts.google.com/o/oauth2/auth?mock=1";

const okResult = (url = MOCK_OAUTH_URL) =>
	Promise.resolve({ data: { url, redirect: true }, error: null });

describe("LoginScreen", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders the Google sign-in button", () => {
		render(<LoginScreen />);
		expect(screen.getByRole("button", { name: /continue with google/i })).toBeInTheDocument();
	});

	it("renders the brand headline", () => {
		render(<LoginScreen />);
		expect(screen.getByText("Sign in to Zosma")).toBeInTheDocument();
	});

	it("calls authClient.signIn.social then opens the OAuth URL via openUrl", async () => {
		mockSignInSocial.mockReturnValue(okResult());
		mockOpenUrl.mockResolvedValue(undefined);
		render(<LoginScreen />);

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));
		});

		expect(mockSignInSocial).toHaveBeenCalledOnce();
		expect(mockSignInSocial).toHaveBeenCalledWith({
			provider: "google",
			callbackURL: "zosma-cowork:///",
			disableRedirect: true,
		});
		expect(mockOpenUrl).toHaveBeenCalledWith(MOCK_OAUTH_URL);
	});

	it("shows loading state while sign-in is in flight", async () => {
		let resolve!: (v: unknown) => void;
		mockSignInSocial.mockReturnValue(
			new Promise((r) => {
				resolve = r;
			}),
		);
		mockOpenUrl.mockResolvedValue(undefined);

		render(<LoginScreen />);
		fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));

		expect(await screen.findByText("Opening browser…")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /continue with google/i })).toBeDisabled();

		await act(async () => resolve(okResult()));
	});

	it("shows error when signIn.social returns no url", async () => {
		mockSignInSocial.mockReturnValue(Promise.resolve({ data: {}, error: null }));
		render(<LoginScreen />);

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));
		});

		expect(screen.getByRole("alert")).toHaveTextContent(/could not open/i);
	});

	it("shows error when signIn.social returns an error", async () => {
		mockSignInSocial.mockReturnValue(
			Promise.resolve({ data: null, error: { message: "Auth failed" } }),
		);
		render(<LoginScreen />);

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));
		});

		expect(screen.getByRole("alert")).toHaveTextContent(/could not open/i);
	});

	it("shows error when signIn.social throws a network error", async () => {
		mockSignInSocial.mockRejectedValue(new Error("network error"));
		render(<LoginScreen />);

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));
		});

		expect(screen.getByRole("alert")).toHaveTextContent(/could not open/i);
	});

	it("re-enables the button after an error", async () => {
		mockSignInSocial.mockRejectedValue(new Error("fail"));
		render(<LoginScreen />);

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));
		});

		expect(screen.getByRole("button", { name: /continue with google/i })).not.toBeDisabled();
	});

	it("resets spinner and shows error when zosma-auth-failed fires", async () => {
		mockSignInSocial.mockReturnValue(okResult());
		mockOpenUrl.mockResolvedValue(undefined);
		render(<LoginScreen />);

		// Click → loading=true, browser opens
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));
		});

		// Deep-link callback fails on the server side
		await act(async () => {
			window.dispatchEvent(new CustomEvent("zosma-auth-failed"));
		});

		expect(screen.getByRole("button", { name: /continue with google/i })).not.toBeDisabled();
		expect(screen.getByRole("alert")).toHaveTextContent(/sign-in failed/i);
	});

	it("does not show email or password fields", () => {
		render(<LoginScreen />);
		expect(screen.queryByLabelText(/email/i)).toBeNull();
		expect(screen.queryByLabelText(/password/i)).toBeNull();
	});
});
