import { Upload } from "lucide-react";

interface DropZoneOverlayProps {
	isVisible: boolean;
}

export function DropZoneOverlay({ isVisible }: DropZoneOverlayProps) {
	if (!isVisible) return null;

	return (
		<div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
			<div className="flex flex-col items-center gap-3 p-8 rounded-2xl border-2 border-dashed border-primary/50 bg-background/60">
				<Upload size={40} className="text-primary/70" />
				<p className="text-lg font-medium text-foreground">Drop files here</p>
				<p className="text-sm text-muted-foreground">Attach to your message</p>
			</div>
		</div>
	);
}
