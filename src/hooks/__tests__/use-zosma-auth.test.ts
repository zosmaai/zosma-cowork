import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth-client', () => ({
	authClient: {
		getSession: vi.fn(),
		signOut: vi.fn(),
		$fetch: vi.fn(),
	},
}));

vi.mock('@/lib/token-store', () => ({
	tokenStore: {
		load: vi.fn(),
		save: vi.fn(),
		clear: vi.fn(),
		getInMemory: vi.fn(),
	},
}));

// useBetterAuthTauri registers a deep-link listener; capture onSuccess so tests
// can trigger it manually.
let capturedOnSuccess: ((url?: string | null) => void) | undefined;

vi.mock('@daveyplate/better-auth-tauri/react', () => ({
	useBetterAuthTauri: vi.fn(({ onSuccess }) => {
		capturedOnSuccess = onSuccess;
	}),
}));

import { useZosmaAuth } from '@/hooks/use-zosma-auth';
import { authClient } from '@/lib/auth-client';
import { tokenStore } from '@/lib/token-store';

const mockGetSession = vi.mocked(authClient.getSession);
const mockSignOut = vi.mocked(authClient.signOut);
const mockLoad = vi.mocked(tokenStore.load);
const mockClear = vi.mocked(tokenStore.clear);

const FAKE_USER = { id: 'u1', email: 'test@zosma.ai', name: 'Test' };
const FAKE_SESSION = { data: { user: FAKE_USER, session: { id: 's1' } }, error: null };

// ── Startup flow ──────────────────────────────────────────────────────────────

describe('useZosmaAuth — startup', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		capturedOnSuccess = undefined;
	});

	it('stays loading=true until keychain check resolves', async () => {
		mockLoad.mockResolvedValue(null);
		const { result } = renderHook(() => useZosmaAuth());
		expect(result.current.loading).toBe(true);
	});

	it('sets loading=false and user=null when no token in keychain', async () => {
		mockLoad.mockResolvedValue(null);
		const { result } = renderHook(() => useZosmaAuth());
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.user).toBeNull();
		expect(result.current.isAuthenticated).toBe(false);
	});

	it('restores session when valid token exists in keychain', async () => {
		mockLoad.mockResolvedValue('tok_valid');
		mockGetSession.mockResolvedValue(FAKE_SESSION as never);
		const { result } = renderHook(() => useZosmaAuth());
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.user).toEqual(FAKE_USER);
		expect(result.current.isAuthenticated).toBe(true);
	});

	it('clears stale token and shows login when getSession returns no user', async () => {
		mockLoad.mockResolvedValue('tok_expired');
		mockGetSession.mockResolvedValue({ data: null, error: null } as never);
		const { result } = renderHook(() => useZosmaAuth());
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(mockClear).toHaveBeenCalled();
		expect(result.current.user).toBeNull();
	});
});

// ── Google OAuth deep-link callback ──────────────────────────────────────────

describe('useZosmaAuth — Google OAuth (deep-link)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		capturedOnSuccess = undefined;
	});

	it('sets user after successful deep-link callback', async () => {
		mockLoad.mockResolvedValue(null);
		mockGetSession.mockResolvedValue(FAKE_SESSION as never);
		const { result } = renderHook(() => useZosmaAuth());
		await waitFor(() => expect(result.current.loading).toBe(false));

		// Simulate deep-link OAuth completing.
		await act(async () => {
			await capturedOnSuccess?.('/');
		});

		expect(result.current.user).toEqual(FAKE_USER);
		expect(result.current.isAuthenticated).toBe(true);
	});

	it('stays unauthenticated when deep-link getSession returns no user', async () => {
		mockLoad.mockResolvedValue(null);
		mockGetSession.mockResolvedValue({ data: null, error: null } as never);
		const { result } = renderHook(() => useZosmaAuth());
		await waitFor(() => expect(result.current.loading).toBe(false));

		await act(async () => {
			await capturedOnSuccess?.('/');
		});

		expect(result.current.user).toBeNull();
	});
});

// ── Sign out ─────────────────────────────────────────────────────────────────

describe('useZosmaAuth — signOut', () => {
	beforeEach(() => vi.clearAllMocks());

	it('clears token, calls authClient.signOut, and sets user null', async () => {
		mockLoad.mockResolvedValue('tok');
		mockGetSession.mockResolvedValue(FAKE_SESSION as never);
		mockSignOut.mockResolvedValue({ data: null, error: null } as never);

		const { result } = renderHook(() => useZosmaAuth());
		await waitFor(() => expect(result.current.user).toEqual(FAKE_USER));

		await act(async () => {
			await result.current.signOut();
		});

		expect(mockSignOut).toHaveBeenCalled();
		expect(mockClear).toHaveBeenCalled();
		expect(result.current.user).toBeNull();
		expect(result.current.isAuthenticated).toBe(false);
	});
});

// ── B10: 401 mid-session ─────────────────────────────────────────────────────

describe('useZosmaAuth — 401 handling', () => {
	beforeEach(() => vi.clearAllMocks());

	it('sets user null when zosma-unauthorized event fires', async () => {
		mockLoad.mockResolvedValue('tok');
		mockGetSession.mockResolvedValue(FAKE_SESSION as never);
		const { result } = renderHook(() => useZosmaAuth());
		await waitFor(() => expect(result.current.user).toEqual(FAKE_USER));

		act(() => {
			window.dispatchEvent(new CustomEvent('zosma-unauthorized'));
		});

		expect(result.current.user).toBeNull();
	});
});
