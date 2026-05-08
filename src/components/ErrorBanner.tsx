interface ErrorBannerProps {
	error: string;
	onRetry?: () => void;
	onSwitchModel?: () => void;
}

export function ErrorBanner({ error, onRetry, onSwitchModel }: ErrorBannerProps) {
	return (
		<div className="px-4 py-3 mx-4 mb-2 rounded-lg bg-red-500/10 border border-red-500/20">
			<div className="flex items-start gap-2">
				<span className="text-red-500 mt-0.5 shrink-0">⚠</span>
				<div className="min-w-0 flex-1">
					<p className="text-sm text-red-600 dark:text-red-400 break-words">{error}</p>
					<div className="flex gap-2 mt-2">
						{onRetry && (
							<button
								type="button"
								onClick={onRetry}
								className="text-xs px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-600 dark:text-red-400"
							>
								Retry
							</button>
						)}
						{onSwitchModel && (
							<button
								type="button"
								onClick={onSwitchModel}
								className="text-xs px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-600 dark:text-red-400"
							>
								Switch Model
							</button>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
