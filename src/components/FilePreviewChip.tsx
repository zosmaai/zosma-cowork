import { convertFileSrc } from "@tauri-apps/api/core";
import { File, FileArchive, FileCode, FileJson, FileText, X } from "lucide-react";
import type { ReactNode } from "react";

interface FilePreviewChipProps {
	path: string;
	name: string;
	size: number;
	mimeType: string;
	source?: "upload" | "mention";
	onRemove: (path: string) => void;
}

function formatFileSize(bytes: number): string {
	if (bytes === 0) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	const n = bytes / 1024 ** i;
	return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function fileIcon(mimeType: string): ReactNode {
	if (mimeType.startsWith("text/")) return <FileCode size={16} />;
	if (mimeType === "application/json") return <FileJson size={16} />;
	if (mimeType === "application/pdf") return <FileText size={16} />;
	if (
		mimeType.includes("zip") ||
		mimeType.includes("gzip") ||
		mimeType.includes("tar") ||
		mimeType.includes("rar") ||
		mimeType.includes("7z")
	) {
		return <FileArchive size={16} />;
	}
	return <File size={16} />;
}

function truncateName(name: string, max = 30): string {
	if (name.length <= max) return name;
	return `${name.slice(0, max - 1)}…`;
}

export function FilePreviewChip({ path, name, size, mimeType, source, onRemove }: FilePreviewChipProps) {
	const isImage = mimeType.startsWith("image/");

	return (
		<span
			className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs max-w-60 bg-muted text-foreground"
			title={path}
		>
			{source === "mention" && (
				<span className="shrink-0 text-[10px] font-semibold text-muted-foreground/70">@</span>
			)}
			{isImage ? (
				<img
					src={convertFileSrc(path)}
					alt={name}
					className="w-6 h-6 rounded object-cover shrink-0"
				/>
			) : (
				<span className="shrink-0 text-muted-foreground">{fileIcon(mimeType)}</span>
			)}
			<span className="truncate">{truncateName(name)}</span>
			<span className="shrink-0 text-muted-foreground/60">{formatFileSize(size)}</span>
			<button
				type="button"
				onClick={() => onRemove(path)}
				className="shrink-0 rounded p-0.5 hover:opacity-70 text-muted-foreground"
				aria-label={`Remove ${name}`}
			>
				<X size={12} />
			</button>
		</span>
	);
}
