import { useUpdate } from "@/contexts/UpdateProvider";
import { BRAND_LINKS } from "@/lib/brand-links";
import { Bug, ExternalLink, Globe, Images, MessageCircle, Star } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { UpdateSettingsRow } from "./UpdateSettingsRow";

const ease = [0.16, 1, 0.3, 1] as const;

export function About() {
	const [appVersion, setAppVersion] = useState<string | null>(null);
	const appUpdate = useUpdate();
	const reduced = useReducedMotion();

	useEffect(() => {
		import("@tauri-apps/api/app")
			.then(({ getVersion }) => getVersion().then(setAppVersion))
			.catch(() => {});
	}, []);

	return (
		<section>
			<h2 className="text-sm font-semibold text-foreground mb-1">About</h2>
			<p className="text-xs text-muted-foreground mb-5">
				Zosma Cowork — built openly, runs locally.
			</p>

			{/* ── App identity ── */}
			<div className="glass overflow-hidden">
				<div className="px-4 py-4 flex items-center gap-3">
					<img
						src="/zosma-mark.png"
						alt="Zosma Cowork"
						className="w-10 h-10 rounded-xl shrink-0 object-cover"
						draggable={false}
					/>
					<div>
						<p className="text-[13px] font-semibold text-foreground leading-tight">Zosma Cowork</p>
						<p className="text-[11px] text-muted-foreground mt-0.5">Desktop AI coworker</p>
					</div>
					{appVersion && (
						<span
							className="ml-auto text-[10px] font-mono px-2 py-0.5 rounded-full"
							style={{
								background: "hsl(var(--primary) / 0.1)",
								color: "hsl(var(--primary))",
							}}
						>
							v{appVersion}
						</span>
					)}
				</div>

				<div className="h-px bg-[hsl(var(--elev-border)/0.6)]" />

				{/* Meta rows */}
				<div className="px-4 py-3 space-y-2.5">
					<MetaRow label="Built on">
						<a
							href={BRAND_LINKS.pi}
							className="inline-flex items-center gap-1 hover:text-foreground transition-colors text-primary"
						>
							pi-mono SDK
							<ExternalLink className="w-3 h-3 opacity-60" />
						</a>
					</MetaRow>
					<MetaRow label="License">
						<span className="text-foreground/70">MIT</span>
					</MetaRow>
					<UpdateSettingsRow update={appUpdate} />
					<MetaRow label="Source">
						<a
							href={BRAND_LINKS.repo}
							className="inline-flex items-center gap-1 hover:text-foreground transition-colors text-primary"
						>
							github.com/zosmaai/zosma-cowork
							<ExternalLink className="w-3 h-3 opacity-60" />
						</a>
					</MetaRow>
				</div>
			</div>

			{/* ── Get help & connect ── */}
			<h3 className="text-sm font-semibold text-foreground mt-7 mb-1">Get help & connect</h3>
			<p className="text-xs text-muted-foreground mb-4">
				Stuck, hit a bug, or have an idea? Reach the team and community.
			</p>

			<div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
				<HelpTile
					href={BRAND_LINKS.discord}
					Icon={MessageCircle}
					title="Join our Discord"
					subtitle="Ask questions & share builds"
					reduced={!!reduced}
				/>
				<HelpTile
					href={BRAND_LINKS.newIssue}
					Icon={Bug}
					title="Report an issue"
					subtitle="File a bug or request a feature"
					reduced={!!reduced}
				/>
				<HelpTile
					href={BRAND_LINKS.gallery}
					Icon={Images}
					title="Browse the gallery"
					subtitle="See what Cowork can build"
					reduced={!!reduced}
				/>
				<HelpTile
					href={BRAND_LINKS.website}
					Icon={Globe}
					title="Visit zosma.ai"
					subtitle="Docs, downloads & updates"
					reduced={!!reduced}
				/>
			</div>

			{/* ── Support the project ── */}
			<a href={BRAND_LINKS.repo} className="glass mt-2.5 px-4 py-3 flex items-center gap-3 group">
				<div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 shrink-0">
					<Star className="w-4 h-4 text-primary" />
				</div>
				<div className="min-w-0">
					<p className="text-[13px] font-medium text-foreground leading-tight">Star us on GitHub</p>
					<p className="text-[11px] text-muted-foreground mt-0.5">
						It genuinely helps an open project grow.
					</p>
				</div>
				<ExternalLink className="w-3.5 h-3.5 ml-auto text-muted-foreground/50 group-hover:text-foreground transition-colors shrink-0" />
			</a>

			<p className="mt-6 text-[11px] text-muted-foreground">
				Made with care by the Zosma team and contributors. Released under the MIT license.
			</p>
		</section>
	);
}

function HelpTile({
	href,
	Icon,
	title,
	subtitle,
	reduced,
}: {
	href: string;
	Icon: React.ComponentType<{ className?: string }>;
	title: string;
	subtitle: string;
	reduced: boolean;
}) {
	return (
		<motion.a
			href={href}
			className="glass px-3.5 py-3 flex items-center gap-3 group"
			whileHover={reduced ? {} : { y: -1 }}
			whileTap={reduced ? {} : { scale: 0.99 }}
			transition={{ duration: 0.14, ease }}
		>
			<div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 shrink-0">
				<Icon className="w-4 h-4 text-primary" />
			</div>
			<div className="min-w-0">
				<p className="text-[12.5px] font-medium text-foreground leading-tight">{title}</p>
				<p className="text-[11px] text-muted-foreground mt-0.5 truncate">{subtitle}</p>
			</div>
			<ExternalLink className="w-3.5 h-3.5 ml-auto text-muted-foreground/40 group-hover:text-foreground transition-colors shrink-0" />
		</motion.a>
	);
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="flex items-center gap-3">
			<span className="text-[11px] text-muted-foreground w-16 shrink-0">{label}</span>
			<span className="text-[12px]">{children}</span>
		</div>
	);
}
