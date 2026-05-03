import { useExtensionTools } from "@/hooks/useExtensionTools";
import { Box, RefreshCw, Terminal } from "lucide-react";
import { useCallback } from "react";

/**
 * View that displays all loaded extension tools from the sidecar.
 */
export function CommandsView() {
	const { tools, loading, sidecarRunning, error, refresh } =
		useExtensionTools();

	const handleRefresh = useCallback(() => {
		void refresh();
	}, [refresh]);

	return (
		<div className="flex-1 flex flex-col overflow-hidden bg-background">
			{/* Header */}
			<div className="flex items-center justify-between px-4 py-3 border-b">
				<h2 className="text-lg font-semibold">Commands</h2>
				<button
					type="button"
					onClick={handleRefresh}
					className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
					title="Refresh"
				>
					<RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
				</button>
			</div>

			<div className="flex-1 overflow-y-auto p-4 space-y-4">
				{/* Sidecar status */}
				{!sidecarRunning && (
					<div className="flex items-center gap-3 p-4 rounded-lg border bg-muted/50 text-sm text-muted-foreground">
						<Terminal className="w-5 h-5 shrink-0" />
						<span>
							Sidecar not running. Extension tools are unavailable.
						</span>
					</div>
				)}

				{error && (
					<div className="p-3 rounded-lg border border-destructive/30 bg-destructive/10 text-sm text-destructive">
						{error}
					</div>
				)}

				{loading && tools.length === 0 && (
					<div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
						Loading extension tools...
					</div>
				)}

				{!loading && tools.length === 0 && sidecarRunning && (
					<div className="flex flex-col items-center justify-center py-12 text-sm text-muted-foreground">
						<Box className="w-8 h-8 mb-3 opacity-50" />
						<p>No extensions with tools loaded.</p>
						<p className="text-xs mt-1">
							Install extensions from the Settings &gt; Extensions panel.
						</p>
					</div>
				)}

				{/* Extension tool list */}
				{tools.map((ext) => (
					<div
						key={ext.id}
						className="rounded-lg border bg-card text-card-foreground"
					>
						<div className="px-4 py-3 border-b bg-muted/30">
							<div className="flex items-center gap-2">
								<Box className="w-4 h-4 text-primary" />
								<span className="font-medium text-sm">{ext.id}</span>
							</div>
							<p className="text-xs text-muted-foreground mt-0.5 font-mono truncate">
								{ext.path}
							</p>
						</div>
						<div className="p-3 space-y-1">
							{ext.tools.length === 0 ? (
								<p className="text-xs text-muted-foreground italic">
									No tools registered
								</p>
							) : (
								ext.tools.map((tool) => (
									<div
										key={tool}
										className="flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-accent transition-colors cursor-default"
									>
										<Terminal className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
										<span className="font-mono text-xs">{tool}</span>
									</div>
								))
							)}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
