import { type ArtifactType, parentDir } from "@/lib/artifacts";
import { useEffect, useRef } from "react";

interface ArtifactPreviewProps {
	filePath: string;
	fileContent: string;
	artifactType: ArtifactType;
	onOpenFolder?: (dir: string) => void;
	onCopyPath?: (path: string) => void;
}

export function ArtifactPreview({
	filePath,
	fileContent,
	artifactType,
	onOpenFolder,
	onCopyPath,
}: ArtifactPreviewProps) {
	const fileName = filePath.split("/").pop() || filePath;
	const svgContainerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (artifactType === "svg" && svgContainerRef.current) {
			svgContainerRef.current.innerHTML = fileContent;
		}
	}, [artifactType, fileContent]);

	return (
		<div className="mt-2 rounded-lg border overflow-hidden border-border bg-card">
			<div className="flex items-center justify-between px-3 py-1.5 border-b text-[11px] border-border bg-muted">
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
						className="text-muted-foreground hover:text-foreground transition-colors"
					>
						📁 Open folder
					</button>
				</div>
			</div>

			<div className="p-0 max-h-[400px] overflow-auto">
				{artifactType === "html" && (
					<iframe
						srcDoc={fileContent}
						title={fileName}
						sandbox="allow-scripts"
						className="w-full border-0"
						style={{ minHeight: 200, background: "white" }}
					/>
				)}
				{artifactType === "svg" && (
					<div
						ref={svgContainerRef}
						className="p-3 flex items-center justify-center"
						style={{ minHeight: 100, background: "white" }}
					/>
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
					<pre className="text-[11px] p-3 overflow-x-auto font-mono leading-relaxed whitespace-pre-wrap text-muted-foreground">
						{fileContent}
					</pre>
				)}
				{artifactType === "unknown" && (
					<div className="p-3 text-[11px] text-muted-foreground text-center">
						Unknown file type. File written to <code className="font-mono">{filePath}</code>
					</div>
				)}
			</div>
		</div>
	);
}
