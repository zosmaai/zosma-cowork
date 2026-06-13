import { FileText, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

// ─── Types ──────────────────────────────────────────────────────────────

interface DocumentEntry {
	path: string;
	type: "docx" | "pptx" | "xlsx";
	sizeBytes: number;
	slideCount?: number;
	sheetCount?: number;
	pageCount?: number;
}

interface DocumentsPanelProps {
	/** Optional callback when user wants to open a document externally */
	onOpenDocument?: (path: string) => void;
}

// ─── Mock data hook ─────────────────────────────────────────────────────
// In Phase A, documents are tracked in-memory on the agent side.
// This hook provides a placeholder that can be swapped with real IPC
// once the Tauri backend exposes a list_documents command.

function useDocuments() {
	const [documents] = useState<DocumentEntry[]>([]);
	const [loading, setLoading] = useState(false);

	const refresh = useCallback(async () => {
		setLoading(true);
		try {
			// In Phase B, this will call:
			// const { invoke } = await import("@tauri-apps/api/core");
			// const docs = await invoke<DocumentEntry[]>("list_documents");
			// For now, documents are tracked by the agent in session state.
			// The refresh action is a no-op placeholder.
			await new Promise((resolve) => setTimeout(resolve, 300));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		refresh();
	}, [refresh]);

	return { documents, loading, refresh };
}

// ─── Helpers ────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
	if (bytes === 0) return "0 B";
	const units = ["B", "KB", "MB"];
	const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

function getDocumentIcon(type: string): string {
	switch (type) {
		case "pptx":
			return "📊";
		case "xlsx":
			return "📈";
		default:
			return "📄";
	}
}

function getDocumentCountLabel(entry: DocumentEntry): string {
	if (entry.slideCount) return `${entry.slideCount} slides`;
	if (entry.sheetCount) return `${entry.sheetCount} sheets`;
	if (entry.pageCount) return `${entry.pageCount} pages`;
	return "";
}

// ─── Component ──────────────────────────────────────────────────────────

export function DocumentsPanel({ onOpenDocument }: DocumentsPanelProps) {
	const { documents, loading, refresh } = useDocuments();

	return (
		<div className="flex flex-col gap-3">
			{/* Header */}
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-semibold text-card-foreground">Documents</h3>
				<button
					type="button"
					onClick={refresh}
					disabled={loading}
					className="p-1 rounded transition-colors hover:bg-accent disabled:opacity-50 text-muted-foreground"
					aria-label="Refresh documents"
				>
					<RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
				</button>
			</div>

			{/* Empty state */}
			{documents.length === 0 && !loading && (
				<div className="rounded-xl border p-4 text-center bg-card border-border">
					<FileText className="w-8 h-8 mx-auto mb-2 opacity-40 text-muted-foreground" />
					<p className="text-xs text-muted-foreground">
						No documents yet. Ask the agent to create one!
					</p>
				</div>
			)}

			{/* Loading state */}
			{loading && documents.length === 0 && (
				<div className="rounded-xl border p-6 flex justify-center bg-card border-border">
					<Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
				</div>
			)}

			{/* Document list */}
			{documents.length > 0 && (
				<div className="flex flex-col gap-2">
					{documents.map((doc) => (
						<button
							type="button"
							key={doc.path}
							onClick={() => onOpenDocument?.(doc.path)}
							className="rounded-xl border p-3 text-left transition-colors hover:bg-accent/50 w-full bg-card border-border"
						>
							<div className="flex items-start gap-2">
								<span className="text-base mt-0.5">{getDocumentIcon(doc.type)}</span>
								<div className="flex-1 min-w-0">
									<p className="text-sm font-medium truncate text-card-foreground">
										{doc.path.split("/").pop() || doc.path}
									</p>
									<p className="text-xs mt-1 text-muted-foreground">
										{formatFileSize(doc.sizeBytes)}
										{getDocumentCountLabel(doc) && <> &middot; {getDocumentCountLabel(doc)}</>}
									</p>
								</div>
								<button
									type="button"
									onClick={(e) => {
										e.stopPropagation();
										// Remove from local state
									}}
									className="p-1 rounded transition-colors hover:bg-destructive/10 opacity-0 group-hover:opacity-100 text-destructive"
									aria-label="Remove document"
								>
									<Trash2 className="w-3.5 h-3.5" />
								</button>
							</div>
						</button>
					))}
				</div>
			)}
		</div>
	);
}

// ─── Styles ─────────────────────────────────────────────────────────────
// Uses CSS variables from the app's theme system:
//   --card, --card-foreground, --border, --muted-foreground,
//   --accent, --destructive
