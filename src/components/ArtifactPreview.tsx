import { type ArtifactType, parentDir, sandboxedHtml, sanitizeSvg } from "@/lib/artifacts";
import { useMemo } from "react";

interface ArtifactPreviewProps {
	filePath: string;
	fileContent: string;
	artifactType: ArtifactType;
	onOpenFolder?: (dir: string) => void;
	onCopyPath?: (path: string) => void;
	openFolderLabel?: string;
}

export function ArtifactPreview({
	filePath,
	fileContent,
	artifactType,
	onOpenFolder,
	onCopyPath,
	openFolderLabel,
}: ArtifactPreviewProps) {
	const fileName = filePath.split("/").pop() || filePath;
	const safeSvg = useMemo(
		() => (artifactType === "svg" ? sanitizeSvg(fileContent) : null),
		[artifactType, fileContent],
	);

	return (
		<div className="mt-2 rounded-lg border overflow-hidden border-border bg-card">
			<div className="flex items-center justify-between px-3 py-1.5 border-b text-[13px] border-border bg-muted">
				<span className="font-mono truncate" data-testid="artifact-filename">
					{fileName}
				</span>
				<div className="flex items-center gap-2 flex-shrink-0">
					<button
						type="button"
						onClick={() => onCopyPath?.(filePath)}
						className="text-muted-foreground hover:text-foreground transition-colors"
					>
						📋 Copy path
					</button>
					<button
						type="button"
						onClick={() => onOpenFolder?.(parentDir(filePath))}
						aria-label={openFolderLabel}
						className="text-muted-foreground hover:text-foreground transition-colors"
					>
						📁 Open folder
					</button>
				</div>
			</div>

			<div className="p-0 max-h-[400px] overflow-auto">
				{artifactType === "html" && (
					<iframe
						srcDoc={sandboxedHtml(fileContent)}
						title={fileName}
						sandbox=""
						className="w-full border-0"
						style={{ minHeight: 200, background: "white" }}
					/>
				)}
				{artifactType === "svg" && safeSvg && (
					<div
						className="p-3 flex items-center justify-center"
						style={{ minHeight: 100, background: "white" }}
					>
						<img
							src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(safeSvg)}`}
							alt={fileName}
							className="max-w-full max-h-[350px] object-contain"
						/>
					</div>
				)}
				{artifactType === "svg" && !safeSvg && (
					<div className="p-3 text-[13px] text-muted-foreground text-center">
						File unavailable
					</div>
				)}
				{artifactType === "image" && (
					<div
						className="p-3 flex items-center justify-center"
						style={{ background: "hsl(var(--muted) / 0.3)" }}
					>
						<img
							src={fileContent}
							alt={fileName}
							className="max-w-full max-h-[350px] object-contain rounded"
						/>
					</div>
				)}
				{artifactType === "code" && (
					<pre className="text-sm p-3 overflow-x-auto font-mono leading-relaxed whitespace-pre-wrap text-muted-foreground">
						{fileContent}
					</pre>
				)}
				{artifactType === "unknown" && (
					<div className="p-3 text-[13px] text-muted-foreground text-center">
						Unknown file type. File written to <code className="font-mono">{filePath}</code>
					</div>
				)}
			</div>
		</div>
	);
}
