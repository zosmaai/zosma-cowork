import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { File, FileCode, FileText } from "lucide-react";
import { useCallback } from "react";
import { formatFileSize } from "@/lib/utils";

interface AttachmentCardProps {
	path: string;
	name: string;
	size: number;
	mimeType: string;
}

function fileIcon(mimeType: string) {
	if (mimeType.startsWith("text/")) return <FileCode size={20} />;
	if (mimeType === "application/pdf") return <FileText size={20} />;
	return <File size={20} />;
}

export function AttachmentCard({ path, name, size, mimeType }: AttachmentCardProps) {
	const isImage = mimeType.startsWith("image/");
	const openFile = useCallback(async () => {
		try {
			await invoke("open_url", { url: `file://${path}` });
		} catch {
			// ignore
		}
	}, [path]);

	return (
		<button
			type="button"
			onClick={openFile}
			className="flex items-center gap-3 w-full rounded-lg border border-border p-2 text-left hover:bg-muted/50 transition-colors"
			title={path}
		>
			{isImage ? (
				<img
					src={convertFileSrc(path)}
					alt={name}
					className="w-10 h-10 rounded object-cover shrink-0"
				/>
			) : (
				<span className="w-10 h-10 rounded flex items-center justify-center bg-muted text-muted-foreground shrink-0">
					{fileIcon(mimeType)}
				</span>
			)}
			<div className="flex-1 min-w-0">
				<div className="text-sm font-medium truncate">{name}</div>
				<div className="text-xs text-muted-foreground">{formatFileSize(size)}</div>
			</div>
		</button>
	);
}
