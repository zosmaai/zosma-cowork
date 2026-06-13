import { reactErrorHandler } from "@sentry/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./App.css";
import App from "./App";
import { UpdateProvider } from "./contexts/UpdateProvider";
import { initChatWidth } from "./lib/chat-width";
import { installExternalLinkHandler } from "./lib/external-links";
import { initTheme } from "./lib/themes";
import { initWallpaper } from "./lib/wallpaper";

// Apply saved dark/light preference before rendering to avoid flash
initTheme();
// Apply saved background wallpaper (sets data-wallpaper + --app-wallpaper)
initWallpaper();
// Apply saved chat content width (sets --chat-max-width)
initChatWidth();
// Route external links to the system browser instead of the Tauri webview
installExternalLinkHandler();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");
createRoot(rootElement, {
	onUncaughtError: reactErrorHandler(),
	onCaughtError: reactErrorHandler(),
	onRecoverableError: reactErrorHandler(),
}).render(
	<StrictMode>
		<UpdateProvider>
			<App />
		</UpdateProvider>
	</StrictMode>,
);
