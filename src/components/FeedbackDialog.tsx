import {
	Dialog,
	DialogBody,
	DialogFooter,
	DialogHeader,
	DialogStagger,
	DialogStaggerItem,
} from "@/components/ui/dialog";
import { trackEvent } from "@/lib/telemetry";
import { Bug, Check, MessageSquare, Sparkles } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useId, useState } from "react";

type Category = "bug" | "feature" | "general";

interface FeedbackDialogProps {
	open: boolean;
	onClose: () => void;
}

const CATEGORIES: { value: Category; label: string; Icon: typeof Bug }[] = [
	{ value: "bug", label: "Bug", Icon: Bug },
	{ value: "feature", label: "Feature", Icon: Sparkles },
	{ value: "general", label: "General", Icon: MessageSquare },
];

const MAX_MESSAGE = 500;

export function FeedbackDialog({ open, onClose }: FeedbackDialogProps) {
	const titleId = useId();
	const reduced = useReducedMotion();
	const [category, setCategory] = useState<Category>("general");
	const [message, setMessage] = useState("");
	const [email, setEmail] = useState("");
	const [submitted, setSubmitted] = useState(false);

	useEffect(() => {
		if (open) {
			setCategory("general");
			setMessage("");
			setEmail("");
			setSubmitted(false);
		}
	}, [open]);

	const handleSubmit = useCallback(() => {
		if (!message.trim()) return;
		trackEvent("app_feedback", { category, message: message.trim() });
		setSubmitted(true);
		// Brief success state before closing
		window.setTimeout(onClose, 900);
	}, [message, category, onClose]);

	const remaining = MAX_MESSAGE - message.length;
	const canSubmit = message.trim().length > 0 && remaining >= 0 && !submitted;

	return (
		<Dialog open={open} onClose={onClose} size="md" labelledBy={titleId}>
			<DialogHeader title="Send feedback" onClose={onClose} titleId={titleId} />

			<DialogBody>
				<DialogStagger className="space-y-4">
					{/* Category */}
					<DialogStaggerItem>
						<p className="text-[0.6875rem] font-medium text-muted-foreground uppercase tracking-wider mb-2">
							What's this about?
						</p>
						<div
							className="grid grid-cols-3 gap-1 p-1 rounded-lg"
							style={{ background: "hsl(var(--muted) / 0.5)" }}
							role="radiogroup"
							aria-label="Feedback category"
						>
							{CATEGORIES.map(({ value, label, Icon }) => {
								const active = category === value;
								return (
									<button
										key={value}
										type="button"
										role="radio"
										aria-checked={active}
										onClick={() => setCategory(value)}
										className="relative flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-md transition-colors active:scale-[0.97]"
										style={{
											color: active ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
										}}
									>
										{active && (
											<motion.div
												layoutId="feedback-cat-pill"
												className="absolute inset-0 rounded-md"
												style={{
													background: "hsl(var(--card))",
													boxShadow: "0 1px 4px hsl(0 0% 0% / 0.12)",
												}}
												transition={{
													type: "spring",
													stiffness: 380,
													damping: 32,
												}}
											/>
										)}
										<Icon className="w-3.5 h-3.5 relative" />
										<span className="relative">{label}</span>
									</button>
								);
							})}
						</div>
					</DialogStaggerItem>

					{/* Message */}
					<DialogStaggerItem>
						<div className="relative">
							<textarea
								placeholder="Tell us what's on your mind..."
								value={message}
								onChange={(e) => setMessage(e.target.value)}
								rows={5}
								maxLength={MAX_MESSAGE}
								disabled={submitted}
								className="w-full px-3 py-2.5 text-sm bg-background border border-border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring transition-all placeholder:text-muted-foreground/60 disabled:opacity-60"
							/>
							<div className="absolute bottom-2 right-3 text-[0.625rem] tabular-nums text-muted-foreground/60 pointer-events-none">
								{message.length}/{MAX_MESSAGE}
							</div>
						</div>
					</DialogStaggerItem>

					{/* Email */}
					<DialogStaggerItem>
						<input
							type="email"
							placeholder="Email (optional, for follow-up)"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							disabled={submitted}
							className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-ring transition-all placeholder:text-muted-foreground/60 disabled:opacity-60"
						/>
					</DialogStaggerItem>
				</DialogStagger>
			</DialogBody>

			<DialogFooter>
				<button
					type="button"
					onClick={onClose}
					disabled={submitted}
					className="px-3 py-1.5 text-xs font-medium text-muted-foreground rounded-md hover:bg-muted/70 transition-colors active:scale-[0.97] disabled:opacity-50"
				>
					Cancel
				</button>
				<button
					type="button"
					disabled={!canSubmit}
					onClick={handleSubmit}
					className="relative px-4 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-md transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed hover:brightness-110 min-w-[110px]"
				>
					<AnimatePresence mode="wait" initial={false}>
						{submitted ? (
							<motion.span
								key="done"
								initial={reduced ? false : { opacity: 0, y: 4 }}
								animate={{ opacity: 1, y: 0 }}
								exit={{ opacity: 0, y: -4 }}
								transition={{ duration: 0.18 }}
								className="flex items-center justify-center gap-1.5"
							>
								<Check className="w-3.5 h-3.5" />
								Sent
							</motion.span>
						) : (
							<motion.span
								key="send"
								initial={reduced ? false : { opacity: 0, y: 4 }}
								animate={{ opacity: 1, y: 0 }}
								exit={{ opacity: 0, y: -4 }}
								transition={{ duration: 0.18 }}
								className="block"
							>
								Submit
							</motion.span>
						)}
					</AnimatePresence>
				</button>
			</DialogFooter>
		</Dialog>
	);
}
