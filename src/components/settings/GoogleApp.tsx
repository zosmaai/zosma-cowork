/**
 * GoogleApp — full-page Google Workspace app view.
 *
 * Mirrors DiscordApp's shape (a "Back to Apps" affordance opening a focused,
 * full-page experience) so every app is consistent: a launcher tile in the
 * Apps list opens its own page. The rich connect/scopes/BYO UI lives in
 * GoogleIntegration, embedded here unchanged.
 */

import { ChevronLeft } from "lucide-react";
import { GoogleIntegration } from "./GoogleIntegration";

export function GoogleApp({ onBack }: { onBack: () => void }) {
	return (
		<section className="max-w-3xl">
			<button
				type="button"
				onClick={onBack}
				className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4"
			>
				<ChevronLeft className="w-3.5 h-3.5" />
				Back to Apps
			</button>

			<GoogleIntegration />
		</section>
	);
}
