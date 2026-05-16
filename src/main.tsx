import { reactErrorHandler } from "@sentry/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./App.css";
import App from "./App";
import { applyTheme, getSavedTheme } from "./lib/themes";

// Apply saved theme before rendering to avoid flash
applyTheme(getSavedTheme());

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");
createRoot(rootElement, {
	onUncaughtError: reactErrorHandler(),
	onCaughtError: reactErrorHandler(),
	onRecoverableError: reactErrorHandler(),
}).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
