/**
 * SkillReader — a modal that renders a skill's SKILL.md so users can read what
 * a skill does before (or after) installing it. Loads from disk for installed
 * skills and best-effort from GitHub for remote ones, with a graceful fallback
 * that links out to skills.sh.
 */

import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { ExternalLink, FileText } from "lucide-react";
import { useEffect, useId, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { parseSkillId } from "../../lib/skillBrowse";
import { openExternalUrl } from "../../lib/utils";
import { markdownComponents } from "../MarkdownComponents";

export interface ReaderTarget {
	id: string;
	displayName: string;
	source?: string;
	url?: string;
	/** Local path when the skill is installed (enables disk read). */
	path?: string;
	installed: boolean;
	removable?: boolean;
}

export function SkillReader({
	target,
	open,
	loadMd,
	installing,
	onClose,
	onInstall,
	onRemove,
}: {
	target: ReaderTarget | null;
	open: boolean;
	loadMd: (t: ReaderTarget) => Promise<string | null>;
	installing: boolean;
	onClose: () => void;
	onInstall: (id: string) => void;
	onRemove: (id: string) => void;
}) {
	const titleId = useId();
	const [md, setMd] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (!open || !target) return;
		let cancelled = false;
		setMd(null);
		setLoading(true);
		loadMd(target)
			.then((res) => {
				if (!cancelled) setMd(res);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [open, target, loadMd]);

	if (!target) return null;
	const skillsUrl = target.url || `https://skills.sh/${target.id}`;
	const { source } = parseSkillId(target.id);

	return (
		<Dialog open={open} onClose={onClose} size="lg" labelledBy={titleId}>
			<DialogHeader
				title={target.displayName}
				description={target.source || source}
				onClose={onClose}
				titleId={titleId}
			/>

			<DialogBody scrollable>
				{loading ? (
					<div className="flex flex-col items-center justify-center py-14 gap-3">
						<span className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
						<p className="text-xs text-muted-foreground/60">Loading SKILL.md…</p>
					</div>
				) : md ? (
					<div className="skill-md">
						<ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
							{md}
						</ReactMarkdown>
					</div>
				) : (
					<div className="flex flex-col items-center text-center py-12 gap-2">
						<div className="w-11 h-11 rounded-2xl bg-muted/60 flex items-center justify-center text-muted-foreground/50">
							<FileText className="w-5 h-5" />
						</div>
						<p className="text-sm text-muted-foreground">Couldn't load this SKILL.md</p>
						<p className="text-xs text-muted-foreground/50 max-w-xs">
							The skill's layout couldn't be resolved automatically. Open it on skills.sh to read
							the full details.
						</p>
						<button
							type="button"
							onClick={() => openExternalUrl(skillsUrl).catch(() => {})}
							className="mt-1 text-xs text-primary hover:underline flex items-center gap-1.5"
						>
							<ExternalLink className="w-3 h-3" />
							View on skills.sh
						</button>
					</div>
				)}
			</DialogBody>

			<DialogFooter>
				<button
					type="button"
					onClick={() => openExternalUrl(skillsUrl).catch(() => {})}
					className="mr-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1.5"
				>
					<ExternalLink className="w-3 h-3" />
					skills.sh
				</button>
				<button
					type="button"
					onClick={onClose}
					className="px-3 py-1.5 text-xs font-medium text-muted-foreground rounded-md hover:bg-muted/70 transition-colors"
				>
					Close
				</button>
				{target.installed && target.removable !== false ? (
					<button
						type="button"
						onClick={() => onRemove(target.id)}
						className="px-3 py-1.5 text-xs font-medium text-destructive bg-destructive/10 border border-destructive/20 rounded-md hover:bg-destructive/15 transition-colors"
					>
						Remove
					</button>
				) : target.installed ? (
					<span className="px-3 py-1.5 text-xs font-medium text-muted-foreground border border-border rounded-md">
						System
					</span>
				) : (
					<button
						type="button"
						disabled={installing}
						onClick={() => onInstall(target.id)}
						className="px-4 py-1.5 text-xs font-semibold text-primary-foreground bg-primary rounded-md hover:brightness-110 disabled:opacity-50 transition-all min-w-[88px]"
					>
						{installing ? "Installing…" : "Install"}
					</button>
				)}
			</DialogFooter>
		</Dialog>
	);
}
