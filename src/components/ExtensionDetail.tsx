import { useCallback, useEffect, useRef, useState } from "react";
import type { NpmData, SkillResult } from "../lib/skillRegistry";
import {
	fetchNpmDataForSkill,
	formatDate,
	formatInstallCount,
	formatSize,
} from "../lib/skillRegistry";

interface ExtensionDetailProps {
	skill: SkillResult | null;
	open: boolean;
	onClose: () => void;
	installed: boolean;
	installing: string | null;
	onInstall: (id: string) => void;
	onRemove: (id: string) => void;
}

export function ExtensionDetail({
	skill,
	open,
	onClose,
	installed,
	installing,
	onInstall,
	onRemove,
}: ExtensionDetailProps) {
	const [npmData, setNpmData] = useState<NpmData | null>(null);
	const [fetching, setFetching] = useState(true);
	const [error, setError] = useState(false);
	const overlayRef = useRef<HTMLDivElement>(null);
	const skillId = skill?.id ?? null;

	useEffect(() => {
		if (!open || !skillId) return;
		let cancelled = false;
		setFetching(true);
		setError(false);
		fetchNpmDataForSkill(skillId).then((data) => {
			if (!cancelled) {
				setNpmData(data);
				setFetching(false);
				if (!data) setError(true);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [open, skillId]);

	// Escape key dismiss
	useEffect(() => {
		if (!open) return;
		const handleKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", handleKey);
		return () => window.removeEventListener("keydown", handleKey);
	}, [open, onClose]);

	const handleOverlayKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		},
		[onClose],
	);

	const handleOverlayClick = useCallback(
		(e: React.MouseEvent) => {
			if (e.target === overlayRef.current) onClose();
		},
		[onClose],
	);

	const handleInstall = useCallback(() => {
		if (skillId) onInstall(skillId);
	}, [skillId, onInstall]);

	const handleRemove = useCallback(() => {
		if (skillId) onRemove(skillId);
	}, [skillId, onRemove]);

	if (!open || !skill) return null;

	const displayName = npmData?.name || skill.id;

	return (
		<div
			ref={overlayRef}
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
			onClick={handleOverlayClick}
			onKeyDown={handleOverlayKeyDown}
		>
			<div className="w-full max-w-md mx-4 bg-card border border-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
				{/* Header */}
				<div className="flex items-center justify-between px-5 py-4 border-b border-border">
					<div className="min-w-0 flex-1">
						<h2 className="text-sm font-semibold text-foreground truncate">{displayName}</h2>
						{npmData?.description && (
							<p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
								{npmData.description}
							</p>
						)}
					</div>
					<button
						type="button"
						onClick={onClose}
						aria-label="Close"
						className="shrink-0 ml-3 p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
					>
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							aria-hidden="true"
							role="img"
						>
							<title>Close</title>
							<path d="M18 6 6 18M6 6l12 12" />
						</svg>
					</button>
				</div>

				{/* Content */}
				<div className="px-5 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
					{fetching ? (
						<div className="flex items-center justify-center py-8">
							<div className="flex flex-col items-center gap-2">
								<div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
								<p className="text-xs text-muted-foreground">Loading details...</p>
							</div>
						</div>
					) : (
						<>
							{/* Package details grid */}
							<div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
								{npmData?.version && (
									<>
										<DetailRow label="Package" value={npmData.name} />
										<DetailRow label="Version" value={`v${npmData.version}`} />
									</>
								)}
								{npmData?.published && (
									<DetailRow label="Published" value={formatDate(npmData.published)} />
								)}
								<DetailRow
									label="Downloads"
									value={`${formatInstallCount(skill.installCount)} total`}
								/>
								{npmData?.author && <DetailRow label="Author" value={npmData.author} />}
								{npmData?.license && <DetailRow label="License" value={npmData.license} />}
								{npmData?.typeLabel && <DetailRow label="Types" value={npmData.typeLabel} />}
								{npmData?.unpackedSize ? (
									<DetailRow label="Size" value={formatSize(npmData.unpackedSize)} />
								) : (
									<DetailRow label="Size" value="—" />
								)}
								{npmData ? (
									<DetailRow
										label="Dependencies"
										value={`${npmData.deps} dependencies${npmData.peerDeps > 0 ? ` · ${npmData.peerDeps} peers` : ""}`}
									/>
								) : (
									<DetailRow label="Dependencies" value="—" />
								)}
							</div>

							{/* Links */}
							<div className="flex flex-col gap-1.5 pt-1">
								{skill.url && (
									<a
										href={skill.url}
										target="_blank"
										rel="noopener noreferrer"
										className="text-xs text-primary hover:underline flex items-center gap-1"
									>
										<svg
											width="12"
											height="12"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											aria-hidden="true"
											role="img"
										>
											<title>External link</title>
											<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
											<polyline points="15 3 21 3 21 9" />
											<line x1="10" y1="14" x2="21" y2="3" />
										</svg>
										View on skills.sh
									</a>
								)}
								{npmData?.homepage && (
									<a
										href={npmData.homepage}
										target="_blank"
										rel="noopener noreferrer"
										className="text-xs text-primary hover:underline flex items-center gap-1"
									>
										<svg
											width="12"
											height="12"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											aria-hidden="true"
											role="img"
										>
											<title>Homepage</title>
											<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
											<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
										</svg>
										Homepage
									</a>
								)}
							</div>

							{/* Not found message */}
							{error && (
								<div className="py-3 text-center">
									<p className="text-xs text-muted-foreground">
										No npm registry data found for this skill.
									</p>
									<p className="text-[10px] text-muted-foreground/60 mt-1">
										Package ID: {skill.id}
									</p>
								</div>
							)}
						</>
					)}
				</div>

				{/* Actions */}
				<div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
					<button
						type="button"
						onClick={onClose}
						className="px-3 py-1.5 text-xs font-medium text-muted-foreground bg-muted rounded-md hover:bg-muted/80 transition-colors"
					>
						Close
					</button>
					{installed ? (
						<button
							type="button"
							onClick={handleRemove}
							title="Remove this skill"
							className="px-3 py-1.5 text-xs font-medium text-destructive bg-destructive/10 border border-destructive/20 rounded-md hover:bg-destructive/20 transition-colors"
						>
							Remove
						</button>
					) : (
						<button
							type="button"
							disabled={installing === skill.id}
							onClick={handleInstall}
							className="px-3 py-1.5 text-xs font-medium text-white bg-primary rounded-md hover:bg-primary/80 disabled:opacity-50 transition-all"
						>
							{installing === skill.id ? "Installing..." : "Install"}
						</button>
					)}
				</div>
			</div>
		</div>
	);
}

function DetailRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="min-w-0">
			<p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">{label}</p>
			<p className="text-xs text-foreground truncate mt-0.5">{value}</p>
		</div>
	);
}
