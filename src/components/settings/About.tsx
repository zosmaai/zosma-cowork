import { useUpdate } from "@/contexts/UpdateProvider";
import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { UpdateSettingsRow } from "./UpdateSettingsRow";

export function About() {
	const [appVersion, setAppVersion] = useState<string | null>(null);
	const appUpdate = useUpdate();

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

			<div className="rounded-lg border border-border overflow-hidden bg-card">
				{/* App identity */}
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

				<div style={{ height: 1, background: "hsl(var(--border))" }} />

				{/* Meta rows */}
				<div className="px-4 py-3 space-y-2.5">
					<MetaRow label="Built on">
						<a
							href="https://github.com/earendil-works/pi-mono"
							target="_blank"
							rel="noopener noreferrer"
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
							href="https://github.com/zosmaai/zosma-cowork"
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-1 hover:text-foreground transition-colors text-primary"
						>
							github.com/zosmaai/zosma-cowork
							<ExternalLink className="w-3 h-3 opacity-60" />
						</a>
					</MetaRow>
				</div>
			</div>
		</section>
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
