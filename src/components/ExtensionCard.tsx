import { useCallback, useEffect, useState } from "react";
import type { NpmData, SkillResult } from "../lib/skillRegistry";
import { fetchNpmDataForSkill, formatInstallCount } from "../lib/skillRegistry";

interface ExtensionCardProps {
	skill: SkillResult;
	installed: boolean;
	installing: string | null;
	onInstall: (id: string) => void;
	onRemove: (id: string) => void;
	onShowDetail: (skill: SkillResult) => void;
}

export function ExtensionCard({
	skill,
	installed,
	installing,
	onInstall,
	onRemove,
	onShowDetail,
}: ExtensionCardProps) {
	const [npmData, setNpmData] = useState<NpmData | null>(null);
	const [fetching, setFetching] = useState(true);

	useEffect(() => {
		let cancelled = false;
		setFetching(true);
		fetchNpmDataForSkill(skill.id).then((data) => {
			if (!cancelled) {
				setNpmData(data);
				setFetching(false);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [skill.id]);

	const displayName = npmData?.name || skill.id;
	const version = npmData?.version || "";
	const author = npmData?.author || "";
	const license = npmData?.license || "";

	const handleClick = useCallback(() => {
		onShowDetail(skill);
	}, [onShowDetail, skill]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				onShowDetail(skill);
			}
		},
		[onShowDetail, skill],
	);

	return (
		<button
			type="button"
			onClick={handleClick}
			onKeyDown={handleKeyDown}
			aria-label={`View details for ${displayName}`}
			className="w-full text-left px-3 py-2.5 rounded-lg border border-sidebar-border bg-sidebar-background/30 hover:bg-sidebar-accent/50 hover:border-sidebar-accent/30 transition-all cursor-pointer group"
		>
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0 flex-1">
					{/* Name + version */}
					<div className="flex items-center gap-1.5 mb-0.5">
						<span className="text-xs font-medium text-sidebar-foreground truncate">
							{displayName}
						</span>
						{version && (
							<span className="text-[10px] text-sidebar-foreground/40 shrink-0">v{version}</span>
						)}
					</div>

					{/* Description */}
					{npmData?.description && (
						<p className="text-[10px] text-sidebar-foreground/50 leading-relaxed line-clamp-2 mb-1.5">
							{npmData.description}
						</p>
					)}

					{/* Metadata row */}
					<div className="flex items-center gap-2 flex-wrap">
						{/* Install count */}
						<span
							className="text-[10px] text-sidebar-foreground/40 flex items-center gap-0.5"
							aria-label={`${formatInstallCount(skill.installCount)} installs`}
						>
							<svg
								width="10"
								height="10"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								className="opacity-60"
								aria-hidden="true"
								role="img"
							>
								<title>Downloads</title>
								<path d="M12 20V10M18 20V4M6 20v-4" />
							</svg>
							{formatInstallCount(skill.installCount)}
						</span>

						{/* Author */}
						{author && (
							<span
								className="text-[10px] text-sidebar-foreground/40 flex items-center gap-0.5"
								aria-label={`Author: ${author}`}
							>
								<svg
									width="10"
									height="10"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									className="opacity-60"
									aria-hidden="true"
									role="img"
								>
									<title>Author</title>
									<circle cx="12" cy="8" r="4" />
									<path d="M20 21a8 8 0 1 0-16 0" />
								</svg>
								{author}
							</span>
						)}

						{/* License */}
						{license && license !== "Unknown" && (
							<span className="text-[10px] text-sidebar-foreground/30">{license}</span>
						)}

						{/* Loading indicator for npm data */}
						{fetching && (
							<span
								className="text-[10px] text-sidebar-foreground/20 animate-pulse"
								aria-label="Loading package details"
							>
								Loading...
							</span>
						)}
					</div>
				</div>

				{/* Action button */}
				<div className="shrink-0">
					{installed ? (
						<button
							type="button"
							title="Remove skill"
							aria-label={`Remove ${displayName}`}
							onClick={(e) => {
								e.stopPropagation();
								onRemove(skill.id);
							}}
							className="px-2 py-1 text-[10px] font-medium text-sidebar-foreground/50 border border-sidebar-border rounded-md hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors"
						>
							Remove
						</button>
					) : (
						<button
							type="button"
							title="Install skill"
							aria-label={`Install ${displayName}`}
							disabled={installing === skill.id}
							onClick={(e) => {
								e.stopPropagation();
								onInstall(skill.id);
							}}
							className="px-2 py-1 text-[10px] font-medium text-white bg-primary rounded-md hover:bg-primary/80 disabled:opacity-50 transition-all"
						>
							{installing === skill.id ? "..." : "Install"}
						</button>
					)}
				</div>
			</div>
		</button>
	);
}
