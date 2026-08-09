export function QueuedMessages({
	queue,
}: {
	queue?: { steering: readonly string[]; followUp: readonly string[] };
}) {
	const items = [
		...(queue?.steering ?? []).map((text, index) => ({
			key: `s:${index}:${text}`,
			kind: "steer" as const,
			text,
		})),
		...(queue?.followUp ?? []).map((text, index) => ({
			key: `f:${index}:${text}`,
			kind: "follow_up" as const,
			text,
		})),
	];
	if (items.length === 0) return null;

	return (
		<div
			data-testid="queued-section"
			className="mx-auto w-full px-4 mt-1 mb-3"
			style={{ maxWidth: "var(--chat-max-width, 820px)" }}
		>
			<div
				data-testid="queued-thread"
				className="ml-11 border-l-2 pl-4 py-1 space-y-1.5 text-sm border-border"
			>
				{items.map((item) => (
					<div key={item.key} className="relative text-muted-foreground/90 leading-relaxed">
						<span
							className="absolute -left-[1.30rem] top-2 h-1.5 w-1.5 rounded-full bg-border"
							aria-hidden="true"
						/>
						<span className="font-medium text-muted-foreground">
							{item.kind === "steer" ? "Steering " : "Follow-up "}
						</span>
						<span className="text-muted-foreground/60">· </span>
						<span className="whitespace-pre-wrap">{item.text}</span>
					</div>
				))}
				<div className="text-xs text-muted-foreground/60">Ctrl+↑ to edit all queued messages</div>
			</div>
		</div>
	);
}
