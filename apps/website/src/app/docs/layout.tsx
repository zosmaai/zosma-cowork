import { source } from "@/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { ThemeSwitch } from "fumadocs-ui/layouts/shared/slots/theme-switch";
import type { ReactNode } from "react";
import { layoutConfig } from "@/app/layout.config";

export default function Layout({ children }: { children: ReactNode }) {
	return (
		<DocsLayout
			{...layoutConfig}
			nav={{
				...layoutConfig.nav,
				// Render the theme toggle in the sidebar header row (top of sidebar).
				// This mirrors where it sits on the homepage nav so users always find it.
				children: <ThemeSwitch />,
			}}
			tree={source.getPageTree()}
		>
			{children}
		</DocsLayout>
	);
}
