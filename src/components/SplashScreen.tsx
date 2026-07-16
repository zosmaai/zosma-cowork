/**
 * SplashScreen — Startup loading state
 *
 * Shown while the agent sidecar is still booting and we can't yet tell
 * whether the user is authenticated. This replaces the brief, confusing
 * flash of the onboarding/Welcome screen during startup (issue #169):
 * returning users no longer see a "Connect your AI" screen they don't need.
 */

interface SplashScreenProps {
	/** Optional status line (defaults to a generic "starting" message). */
	message?: string;
}

export function SplashScreen({ message = "Starting up…" }: SplashScreenProps) {
	return (
		<div className="flex-1 flex flex-col items-center justify-center h-full gap-6 animate-fade-in">
			{/* Logo mark — matches the onboarding splash */}
			<img
				src="/zosma-mark.png"
				alt="Zosma Cowork"
				className="w-16 h-16 rounded-2xl shadow-lg animate-subtle-pulse"
				draggable={false}
			/>

			<div className="flex flex-col items-center gap-3">
				<h1 className="text-lg font-semibold text-foreground">Zosma Cowork</h1>
				<div className="flex items-center gap-2.5">
					<span className="w-4 h-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
					<span className="text-sm text-muted-foreground">{message}</span>
				</div>
			</div>
		</div>
	);
}
