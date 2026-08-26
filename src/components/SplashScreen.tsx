import { Lock, Zap } from "lucide-react";

/**
 * Startup transition shown while returning users wait for Pi to become ready.
 * Fresh users bypass this once state classification is available and enter the
 * connect screen directly.
 */
interface SplashScreenProps {
	/** Optional status line (defaults to a generic "starting" message). */
	message?: string;
}

export function SplashScreen({ message = "Starting up…" }: SplashScreenProps) {
	return (
		<div className="flex h-full flex-1 items-center justify-center overflow-y-auto px-6 py-12 animate-fade-in">
			<div className="flex w-full max-w-sm flex-col items-center text-center">
				<img
					src="/zosma-mark.png"
					alt="Zosma Cowork"
					className="mb-5 h-16 w-16 rounded-2xl shadow-lg animate-subtle-pulse"
					draggable={false}
				/>
				<h1 className="text-2xl font-bold text-foreground">Zosma Cowork</h1>
				<p className="mt-2 text-base leading-relaxed text-muted-foreground">
					Connect your AI accounts and start working — your credentials stay on your machine.
				</p>

				<div className="mt-7 w-full space-y-2 text-left">
					<div className="flex items-center gap-3 rounded-xl bg-muted/40 px-3.5 py-2.5 text-sm text-muted-foreground">
						<Zap className="h-4 w-4 shrink-0 text-primary" />
						Works with Claude, ChatGPT, Copilot, and local models
					</div>
					<div className="flex items-center gap-3 rounded-xl bg-muted/40 px-3.5 py-2.5 text-sm text-muted-foreground">
						<Lock className="h-4 w-4 shrink-0 text-primary" />
						Your API keys and data never leave this device
					</div>
				</div>

				<div
					className="mt-8 flex items-center gap-2 text-sm text-muted-foreground"
					aria-live="polite"
				>
					<span className="h-3.5 w-3.5 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
					{message}
				</div>
			</div>
		</div>
	);
}
