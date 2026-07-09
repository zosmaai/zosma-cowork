import { signInSocial } from '@daveyplate/better-auth-tauri';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';

function GoogleLogo({ className }: { className?: string }) {
	return (
		<svg className={className} viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
				fill="#4285F4"
			/>
			<path
				d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
				fill="#34A853"
			/>
			<path
				d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
				fill="#FBBC05"
			/>
			<path
				d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
				fill="#EA4335"
			/>
		</svg>
	);
}

export function LoginScreen() {
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const handleGoogleSignIn = async () => {
		setLoading(true);
		setError(null);
		try {
			await signInSocial({ authClient, provider: 'google' });
		} catch {
			setError('Could not open the sign-in page. Please try again.');
			setLoading(false);
		}
	};

	return (
		<div className="flex flex-col items-center justify-center h-full gap-8 px-6">
			<div className="flex flex-col items-center gap-3">
				<div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
					<svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
					</svg>
				</div>
				<div className="text-center">
					<h1 className="text-lg font-semibold text-foreground">Sign in to Zosma</h1>
					<p className="text-sm text-muted-foreground mt-0.5">Your browser will open to complete sign-in</p>
				</div>
			</div>

			<div className="w-full max-w-xs flex flex-col gap-3">
				<button
					type="button"
					onClick={handleGoogleSignIn}
					disabled={loading}
					aria-label="Continue with Google"
					className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-lg border border-border bg-background hover:bg-muted/50 text-sm font-medium text-foreground transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
				>
					{loading ? (
						<div className="w-4 h-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
					) : (
						<GoogleLogo className="w-4 h-4 shrink-0" />
					)}
					{loading ? 'Opening browser…' : 'Continue with Google'}
				</button>

				{error && (
					<p role="alert" className="text-xs text-destructive text-center">{error}</p>
				)}
			</div>
		</div>
	);
}
