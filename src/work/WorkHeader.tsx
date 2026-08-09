import { Menu, PanelRightOpen } from "lucide-react";
import type { RefObject } from "react";

export function WorkHeader({
	title,
	onOpenSidebar,
	onOpenPanel,
	sidebarButtonRef,
	panelButtonRef,
}: {
	title: string;
	onOpenSidebar?: () => void;
	onOpenPanel?: () => void;
	sidebarButtonRef?: RefObject<HTMLButtonElement | null>;
	panelButtonRef?: RefObject<HTMLButtonElement | null>;
}) {
	return (
		<header className="work-header">
			{onOpenSidebar && (
				<button
					ref={sidebarButtonRef}
					type="button"
					className="work-sidebar-toggle focus-visible:ring-2 focus-visible:ring-ring"
					onClick={onOpenSidebar}
					aria-label="Open session sidebar"
				>
					<Menu className="h-4 w-4" />
				</button>
			)}
			<div className="min-w-0 flex-1">
				<h1 className="truncate text-[length:var(--font-task-header)] font-semibold">
					{title || "Untitled task"}
				</h1>
				<span className="text-[length:var(--font-secondary)] text-muted-foreground">Work</span>
			</div>
			{onOpenPanel && (
				<button
					ref={panelButtonRef}
					type="button"
					className="work-panel-toggle focus-visible:ring-2 focus-visible:ring-ring"
					onClick={onOpenPanel}
					aria-label="Open Outputs and Sources"
				>
					<PanelRightOpen className="h-4 w-4" />
				</button>
			)}
		</header>
	);
}
