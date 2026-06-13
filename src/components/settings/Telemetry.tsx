import { BarChart2 } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

interface Props {
	enabled?: boolean;
	onToggle?: (enabled: boolean) => void;
}

export function Telemetry({ enabled, onToggle }: Props) {
	const reduced = useReducedMotion();
	const isOn = enabled ?? false;

	return (
		<section>
			<h2 className="text-sm font-semibold text-foreground mb-1">Telemetry</h2>
			<p className="text-xs text-muted-foreground mb-5">
				Help us improve without sharing personal data.
			</p>

			<div className="rounded-lg border border-border px-4 py-3.5 bg-card">
				<div className="flex items-start gap-4">
					{/* Icon */}
					<div
						className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0 mt-0.5"
						style={{ background: "hsl(var(--muted) / 0.6)" }}
					>
						<BarChart2 className="w-4 h-4 text-primary" />
					</div>

					{/* Copy */}
					<div className="flex-1 min-w-0">
						<p className="text-[13px] font-medium text-foreground">Anonymous usage data</p>
						<p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
							Send crash reports and usage statistics. Nothing is transmitted unless enabled. No
							personal data, no file content, no conversation history.
						</p>
					</div>

					{/* Toggle */}
					{onToggle && (
						<button
							type="button"
							role="switch"
							aria-checked={isOn}
							onClick={() => onToggle(!isOn)}
							className="relative w-10 h-[22px] rounded-full shrink-0 mt-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							style={{
								background: isOn ? "hsl(var(--primary))" : "hsl(var(--muted))",
								transition: "background 200ms",
							}}
						>
							<motion.div
								className="absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white shadow-sm"
								animate={{ x: isOn ? 20 : 2 }}
								transition={
									reduced
										? { duration: 0 }
										: { type: "spring", stiffness: 500, damping: 35, mass: 0.8 }
								}
							/>
						</button>
					)}
				</div>
			</div>
		</section>
	);
}
