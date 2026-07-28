import { File, FileText, Folder } from "lucide-react";
import type { FileEntry } from "@/hooks/useFileMention";

interface FileMentionPopupProps {
	entries: FileEntry[];
	selectedIndex: number;
	query: string;
	breadcrumb: string;
	loading: boolean;
	onSelectIndex: (index: number) => void;
	onSelect: (entry: FileEntry) => void;
	anchorRect: { top: number; left: number } | null;
}

function entryIcon(entry: FileEntry) {
	if (entry.isDirectory) return <Folder size={14} className="text-blue-500" />;
	if (entry.name.endsWith(".md")) return <FileText size={14} />;
	return <File size={14} />;
}

export function FileMentionPopup({
	entries,
	selectedIndex,
	query,
	breadcrumb,
	loading,
	onSelect,
	anchorRect,
}: FileMentionPopupProps) {
	if (!anchorRect) return null;

	return (
		<div
			className="fixed z-50 min-w-[220px] max-w-[320px] max-h-[240px] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
			style={{ top: anchorRect.top, left: anchorRect.left }}
		>
			{breadcrumb && (
				<div className="px-2 py-1 text-[10px] text-muted-foreground border-b border-border truncate">
					{breadcrumb}
				</div>
			)}
			{loading ? (
				<div className="px-2 py-3 text-xs text-muted-foreground text-center">
					Loading workspace files…
				</div>
			) : entries.length === 0 && query ? (
				<div className="px-2 py-3 text-xs text-muted-foreground text-center">
					No matches for <span className="font-mono">{query}</span>
				</div>
			) : entries.length === 0 && !query ? (
				<div className="px-2 py-3 text-xs text-muted-foreground text-center">
					No files in workspace
				</div>
			) : (
				entries.map((entry, i) => (
					<button
						key={entry.path}
						type="button"
						data-selected={
							i === selectedIndex && selectedIndex < entries.length
								? "true"
								: "false"
						}
						className={`flex items-center gap-2 w-full rounded px-2 py-1.5 text-xs text-left transition-colors ${
							i === selectedIndex
								? "bg-accent text-accent-foreground"
								: "text-popover-foreground hover:bg-accent/50"
						}`}
						onClick={() => onSelect(entry)}
					>
						{entryIcon(entry)}
						<span className="truncate">{entry.name}</span>
					</button>
				))
			)}
		</div>
	);
}
