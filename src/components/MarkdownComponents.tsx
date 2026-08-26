import { isExternalUrl, openExternalUrl } from "@/lib/utils";
import type { Components } from "react-markdown";

/**
 * Shared react-markdown component overrides.
 *
 * The critical override is the anchor (`a`) renderer: inside the Tauri
 * webview a plain `<a href>` navigates the app's own webview, replacing
 * the UI with the target page. We intercept clicks and route real URLs
 * through the system browser via `openExternalUrl` (Tauri `open_url`
 * command, with a `window.open` fallback in browser dev mode).
 *
 * In-page fragment links (`#section`) keep their default behavior.
 */
export const markdownComponents: Components = {
	a({ href, children, title }) {
		const isFragment = href?.startsWith("#") ?? false;
		const isExternal = isExternalUrl(href);
		if (!href || (!isFragment && !isExternal)) return <span>{children}</span>;

		return (
			<a
				href={href}
				title={title}
				// Hints for the browser-dev fallback path; ignored inside Tauri
				// because we preventDefault and open via the backend.
				target={isExternal ? "_blank" : undefined}
				rel={isExternal ? "noopener noreferrer" : undefined}
				onClick={(event) => {
					if (!isExternal) return;
					event.preventDefault();
					void openExternalUrl(href);
				}}
			>
				{children}
			</a>
		);
	},
};
