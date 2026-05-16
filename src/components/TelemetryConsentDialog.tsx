/**
 * Zosma Cowork — Telemetry consent dialog
 *
 * Full-screen overlay shown on first launch, asking users to opt in to
 * anonymous usage data and crash reports. Designed to match the app's
 * design language with Tailwind theme variables.
 */

import { Button } from "@/components/ui/button";
import { ShieldCheck } from "lucide-react";

interface TelemetryConsentDialogProps {
	onEnable: () => void;
	onDismiss: () => void;
}

const bulletPoints = [
	"No personal data collected",
	"No user IDs or cookies",
	"Anonymous feature usage only",
	"Crash reports to help fix bugs",
];

export function TelemetryConsentDialog({ onEnable, onDismiss }: TelemetryConsentDialogProps) {
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
			<div className="w-full max-w-md mx-4 rounded-xl border border-border bg-card p-8 shadow-lg">
				{/* Icon */}
				<div className="flex justify-center mb-4">
					<div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
						<ShieldCheck className="w-6 h-6 text-primary" />
					</div>
				</div>

				{/* Title */}
				<h2 className="text-lg font-semibold text-center text-card-foreground mb-2">
					Help improve Zosma Cowork
				</h2>

				{/* Description */}
				<p className="text-sm text-muted-foreground text-center mb-4">
					Zosma Cowork is free and open-source. Opting in helps us build a better product for
					everyone — completely anonymously.
				</p>

				{/* Bullet points */}
				<ul className="space-y-1.5 mb-6">
					{bulletPoints.map((point) => (
						<li key={point} className="flex items-start gap-2 text-sm text-muted-foreground">
							<ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-primary/70" />
							<span>{point}</span>
						</li>
					))}
				</ul>

				{/* Buttons */}
				<div className="space-y-2">
					<Button variant="default" className="w-full" onClick={onEnable}>
						Enable Telemetry
					</Button>
					<Button variant="secondary" className="w-full" onClick={onDismiss}>
						Not Now
					</Button>
				</div>

				{/* Footer */}
				<p className="text-xs text-muted-foreground/60 text-center mt-4">
					You can change this anytime in Settings.
				</p>
			</div>
		</div>
	);
}
