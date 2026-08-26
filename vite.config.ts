import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react(), tailwindcss()],

	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: ["./src/test/setup.ts"],
		include: ["src/**/*.{test,spec}.{ts,tsx}"],
		coverage: {
			provider: "v8",
			reporter: ["text", "html", "json-summary"],
			exclude: ["node_modules/", "src/test/", "src/**/*.d.ts", "src/main.tsx"],
		},
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
	clearScreen: false,
	server: {
		port: 1420,
		strictPort: true,
		watch: {
			ignored: ["**/src-tauri/**", "**/target/**", "**/agent-sidecar/**", "**/node_modules/**"],
		},
	},
	build: {
		// Vite reports uncompressed kB; the 1,062 kB Markdown chunk is 358 kB gzip,
		// below this repository's 500 kB gzip budget.
		chunkSizeWarningLimit: 1100,
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (!id.includes("node_modules")) return;
					if (id.includes("@uiw+") || id.includes("@uiw/")) return "editor";
					if (id.includes("@sentry+") || id.includes("@sentry/")) return "telemetry";
					if (id.includes("qrcode")) return "qrcode";
					if (id.includes("motion")) return "motion";
					if (id.includes("@tauri-apps")) return "tauri";
					if (id.includes("/react/") || id.includes("/react-dom/")) return "react";
					if (id.includes("highlight.js")) return "highlight";
					if (
						id.includes("react-markdown") ||
						id.includes("remark-") ||
						id.includes("rehype-") ||
						id.includes("micromark") ||
						id.includes("/unified@")
					)
						return "markdown";
				},
			},
		},
	},
});
