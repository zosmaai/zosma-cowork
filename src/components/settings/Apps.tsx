/**
 * Apps — curated, one-click setups.
 *
 * An "app" bundles the extensions, skills and credentials needed for a
 * real workflow (e.g. Google Workspace = Gmail + Calendar + Drive + Docs)
 * so people get productive without wiring pieces together by hand. This is
 * the higher-level companion to the Extensions and Skills panels: pick an
 * app, connect once, and the underlying capabilities light up.
 */
import { BRAND_LINKS } from "@/lib/brand-links";
import { Puzzle, Zap } from "lucide-react";
import { useState } from "react";
import { DiscordApp } from "./DiscordApp";
import { DiscordIntegration } from "./DiscordIntegration";
import { GithubApp } from "./GithubApp";
import { GithubIntegration } from "./GithubIntegration";
import { GoogleApp } from "./GoogleApp";
import { GoogleLauncher } from "./GoogleLauncher";

type AppView = "list" | "discord" | "google" | "github";

export function Apps() {
	const [view, setView] = useState<AppView>("list");

	if (view === "discord") {
		return <DiscordApp onBack={() => setView("list")} />;
	}
	if (view === "google") {
		return <GoogleApp onBack={() => setView("list")} />;
	}
	if (view === "github") {
		return <GithubApp onBack={() => setView("list")} />;
	}

	return (
		<section>
			<h2 className="text-sm font-semibold text-foreground mb-1">Apps</h2>
			<p className="text-xs text-muted-foreground mb-5">
				One-click setups that bundle the extensions, skills and access an everyday workflow needs —
				connect once and the pieces light up together.
			</p>

			{/* ── Available apps ── */}
			<div className="space-y-2.5">
				<GoogleLauncher onOpen={() => setView("google")} />
				<DiscordIntegration onOpen={() => setView("discord")} />
				<GithubIntegration onOpen={() => setView("github")} />
			</div>

			{/* ── Pointer to the building blocks ── */}
			<div className="glass mt-6 px-4 py-3.5">
				<p className="text-[12px] text-foreground/80 leading-relaxed">
					More apps are on the way. Want something specific?{" "}
					<a href={BRAND_LINKS.newIssue} className="text-primary hover:underline">
						Request an app
					</a>
					.
				</p>
				<div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[11px] text-muted-foreground">
					<span className="inline-flex items-center gap-1.5">
						<Puzzle className="w-3 h-3 text-muted-foreground/70" />
						Built from <span className="text-foreground/70">Extensions</span>
					</span>
					<span className="inline-flex items-center gap-1.5">
						<Zap className="w-3 h-3 text-muted-foreground/70" />
						and <span className="text-foreground/70">Skills</span>
					</span>
				</div>
			</div>
		</section>
	);
}
