import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@daveyplate/better-auth-tauri', () => ({
	signInSocial: vi.fn(),
}));

vi.mock('@/lib/auth-client', () => ({
	authClient: {},
}));

import { signInSocial } from '@daveyplate/better-auth-tauri';
import { LoginScreen } from '@/components/LoginScreen';

const mockSignInSocial = vi.mocked(signInSocial);

describe('LoginScreen', () => {
	beforeEach(() => vi.clearAllMocks());

	it('renders the Google sign-in button', () => {
		render(<LoginScreen />);
		expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument();
	});

	it('renders the brand headline', () => {
		render(<LoginScreen />);
		expect(screen.getByText('Sign in to Zosma')).toBeInTheDocument();
	});

	it('calls signInSocial with google provider on click', async () => {
		mockSignInSocial.mockResolvedValue({ data: null, error: null } as never);
		render(<LoginScreen />);

		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));
		});

		expect(mockSignInSocial).toHaveBeenCalledWith(
			expect.objectContaining({ provider: 'google' }),
		);
	});

	it('shows loading state while sign-in is in flight', async () => {
		let resolve!: () => void;
		mockSignInSocial.mockReturnValue(new Promise((r) => { resolve = () => r({ data: null, error: null } as never); }));

		render(<LoginScreen />);
		fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));

		expect(await screen.findByText('Opening browser…')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /continue with google/i })).toBeDisabled();

		await act(async () => resolve());
	});

	it('shows an error message when signInSocial throws', async () => {
		mockSignInSocial.mockRejectedValue(new Error('opener unavailable'));
		render(<LoginScreen />);

		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));
		});

		expect(screen.getByRole('alert')).toHaveTextContent(/could not open/i);
	});

	it('re-enables the button after an error', async () => {
		mockSignInSocial.mockRejectedValue(new Error('fail'));
		render(<LoginScreen />);

		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));
		});

		expect(screen.getByRole('button', { name: /continue with google/i })).not.toBeDisabled();
	});

	it('does not show an email or password field', () => {
		render(<LoginScreen />);
		expect(screen.queryByLabelText(/email/i)).toBeNull();
		expect(screen.queryByLabelText(/password/i)).toBeNull();
	});
});
