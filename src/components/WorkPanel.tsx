import { useArtifactLoader } from "@/hooks/useArtifactLoader";
import type { WorkOutput, WorkSource } from "@/lib/work-projections";
import { openExternalUrl } from "@/lib/utils";
import { invoke } from "@tauri-apps/api/core";
import { Copy, ExternalLink, File, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ArtifactPreview } from "./ArtifactPreview";

interface WorkPanelProps {
	outputs: readonly WorkOutput[];
	sources: readonly WorkSource[];
	workspace: string;
	open: boolean;
	onClose: () => void;
}

export function WorkPanel({ outputs, sources, workspace, open, onClose }: WorkPanelProps) {
	const panelRef = useRef<HTMLElement>(null);
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;
	const [selectedIdentity, setSelectedIdentity] = useState<string | null>(null);
	const selected = outputs.find((output) => output.identity === selectedIdentity) ?? null;
	const load = useArtifactLoader(selected?.path ?? null, workspace);

	useEffect(() => {
		if (selectedIdentity && !outputs.some((output) => output.identity === selectedIdentity)) {
			setSelectedIdentity(null);
		}
	}, [outputs, selectedIdentity]);

	useEffect(() => {
		if (!open) return;
		const panel = panelRef.current;
		const focusable = () => [
			...(panel?.querySelectorAll<HTMLElement>(
				'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
			) ?? []),
		];
		focusable()[0]?.focus();

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				onCloseRef.current();
				return;
			}
			if (event.key !== "Tab") return;
			const elements = focusable();
			if (elements.length === 0) return;
			event.preventDefault();
			const current = elements.indexOf(document.activeElement as HTMLElement);
			const next = event.shiftKey
				? (current - 1 + elements.length) % elements.length
				: (current + 1) % elements.length;
			elements[next].focus();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [open]);

	return (
		<aside
			ref={panelRef}
			className="work-panel"
			data-open={open ? "true" : "false"}
			role={open ? "dialog" : "region"}
			aria-modal={open ? true : undefined}
			aria-label="Work outputs and sources"
		>
			<div className="flex items-center justify-between px-3 py-2 border-b border-border">
				<span className="text-sm font-medium">Work</span>
				{open && (
					<button type="button" aria-label="Close Work panel" onClick={onClose}>
						<X className="h-4 w-4" />
					</button>
				)}
			</div>

			<section className="p-3 border-b border-border">
				<h2 className="text-sm font-semibold mb-2">Outputs</h2>
				{outputs.length === 0 ? (
					<p className="text-[13px] text-muted-foreground">No outputs yet</p>
				) : (
					<div className="space-y-1">
						{outputs.map((output) => (
							<button
								type="button"
								key={output.identity}
								onClick={() => setSelectedIdentity(output.identity)}
								className="w-full min-w-0 flex items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
							>
								<File className="h-4 w-4 mt-0.5 shrink-0" />
								<span className="min-w-0">
									<span className="block text-sm truncate">{output.title}</span>
									<span className="block text-[13px] text-muted-foreground truncate">
										{output.displayValue}
									</span>
								</span>
							</button>
						))}
					</div>
				)}

				{selected && load.status === "loading" && (
					<p className="mt-2 text-[13px] text-muted-foreground">Loading preview…</p>
				)}
				{selected && load.status === "unavailable" && (
					<p className="mt-2 text-[13px] text-muted-foreground">File unavailable</p>
				)}
				{selected && load.artifact && (
					<ArtifactPreview
						filePath={load.artifact.filePath}
						fileContent={load.artifact.fileContent}
						artifactType={load.artifact.artifactType}
						onCopyPath={(path) => navigator.clipboard.writeText(path).catch(() => {})}
						onOpenFolder={async () => {
							try {
								await invoke("open_workspace_folder", { path: selected.path, workspace });
							} catch {
								// Keep the selected output usable when the native opener fails.
							}
						}}
						openFolderLabel="Open output folder"
					/>
				)}
			</section>

			<section className="p-3">
				<h2 className="text-sm font-semibold mb-2">Sources</h2>
				{sources.length === 0 ? (
					<p className="text-[13px] text-muted-foreground">No sources yet</p>
				) : (
					<div className="space-y-1">
						{sources.map((source) =>
							source.kind === "url" ? (
								<button
									type="button"
									key={`url:${source.identity}`}
									onClick={async () => {
										try {
											await openExternalUrl(source.identity);
										} catch {
											// Keep the source row usable when opening fails.
										}
									}}
									className="w-full min-w-0 flex items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-muted"
								>
									<ExternalLink className="h-4 w-4 mt-0.5 shrink-0" />
									<span className="min-w-0">
										<span className="block text-sm truncate">{source.title}</span>
										<span className="block text-[13px] text-muted-foreground truncate">
											{source.displayValue}
										</span>
									</span>
								</button>
							) : (
								<div
									key={`file:${source.identity}`}
									className="min-w-0 flex items-start gap-2 rounded px-2 py-1.5"
								>
									<File className="h-4 w-4 mt-0.5 shrink-0" />
									<span className="min-w-0 flex-1">
										<span className="block text-sm truncate">{source.title}</span>
										<span className="block text-[13px] text-muted-foreground truncate">
											{source.displayValue}
										</span>
									</span>
									<button
										type="button"
										aria-label="Copy reference path"
										onClick={() => navigator.clipboard.writeText(source.identity).catch(() => {})}
									>
										<Copy className="h-4 w-4" />
									</button>
								</div>
							),
						)}
					</div>
				)}
			</section>
		</aside>
	);
}
