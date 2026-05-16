/**
 * Zosma Cowork — Theme definitions
 *
 * CSS variable-based themes with light, dark, and accent variants.
 * Each theme defines the full set of CSS custom properties used by the app.
 * New themes can be added by creating another object in THEMES.
 */

export interface Theme {
	id: string;
	name: string;
	description: string;
	type: "light" | "dark";
	/** CSS variable overrides — all without the leading `--` */
	vars: Record<string, string>;
}

export const THEMES: Theme[] = [
	{
		id: "zosma-dark",
		name: "Zosma Dark",
		description: "Dark theme with Zosma's signature indigo accent",
		type: "dark",
		vars: {
			// Background hierarchy
			background: "215 20% 8%",
			foreground: "210 15% 88%",
			card: "215 18% 11%",
			"card-foreground": "210 15% 88%",
			popover: "215 18% 11%",
			"popover-foreground": "210 15% 88%",
			muted: "215 15% 15%",
			"muted-foreground": "210 10% 55%",

			// Primary accent — indigo
			primary: "255 70% 65%",
			"primary-foreground": "0 0% 100%",

			// Destructive
			destructive: "0 70% 55%",
			"destructive-foreground": "0 0% 100%",

			// Borders and inputs
			border: "215 15% 20%",
			input: "215 15% 20%",
			ring: "255 70% 65%",

			// Sidebar
			"sidebar-background": "215 20% 8%",
			"sidebar-foreground": "210 15% 80%",
			"sidebar-accent": "215 18% 14%",
			"sidebar-accent-foreground": "210 15% 88%",
			"sidebar-border": "215 15% 16%",

			// Chat
			"chat-user-bg": "215 18% 14%",
			"chat-user-fg": "210 15% 88%",
			"chat-assistant-bg": "transparent",
			"chat-assistant-fg": "210 15% 85%",
			"chat-system-bg": "215 15% 18%",
			"chat-system-fg": "210 10% 60%",
			"chat-avatar-user-bg": "255 60% 55%",
			"chat-avatar-user-fg": "0 0% 100%",
			"chat-avatar-assistant-bg": "215 15% 25%",
			"chat-avatar-assistant-fg": "210 15% 80%",

			// Status
			"status-bg": "215 18% 11%",
			"status-divider": "215 15% 18%",
			"status-active-fg": "142 70% 55%",

			// Tool calls
			"tool-running-bg": "215 18% 14%",
			"tool-running-fg": "255 70% 65%",
			"tool-running-border": "255 70% 65% / 0.2",
			"tool-complete-bg": "215 18% 12%",
			"tool-complete-fg": "142 60% 55%",
			"tool-complete-border": "142 60% 55% / 0.15",
			"tool-error-bg": "0 50% 16%",
			"tool-error-fg": "0 70% 55%",
			"tool-error-border": "0 70% 55% / 0.2",

			// Diff
			"diff-removed-bg": "0 50% 20% / 0.4",
			"diff-removed-fg": "0 60% 70%",
			"diff-added-bg": "142 50% 18% / 0.4",
			"diff-added-fg": "142 60% 65%",
			"diff-context-fg": "210 10% 50%",

			// Success
			success: "142 60% 50%",
		},
	},
	{
		id: "zosma-light",
		name: "Zosma Light",
		description: "Warm light theme, easy on the eyes for extended sessions",
		type: "light",
		vars: {
			background: "38 25% 94%",
			foreground: "30 20% 22%",
			card: "38 30% 97%",
			"card-foreground": "30 20% 22%",
			popover: "38 30% 97%",
			"popover-foreground": "30 20% 22%",
			muted: "38 20% 90%",
			"muted-foreground": "30 10% 48%",

			primary: "255 65% 55%",
			"primary-foreground": "0 0% 100%",

			destructive: "0 65% 50%",
			"destructive-foreground": "0 0% 100%",

			border: "38 15% 82%",
			input: "38 15% 82%",
			ring: "255 65% 55%",

			"sidebar-background": "38 25% 97%",
			"sidebar-foreground": "30 20% 25%",
			"sidebar-accent": "38 20% 90%",
			"sidebar-accent-foreground": "30 20% 20%",
			"sidebar-border": "38 15% 85%",

			"chat-user-bg": "38 20% 88%",
			"chat-user-fg": "30 20% 20%",
			"chat-assistant-bg": "transparent",
			"chat-assistant-fg": "30 20% 25%",
			"chat-system-bg": "38 20% 88%",
			"chat-system-fg": "30 10% 45%",
			"chat-avatar-user-bg": "255 60% 50%",
			"chat-avatar-user-fg": "0 0% 100%",
			"chat-avatar-assistant-bg": "38 15% 78%",
			"chat-avatar-assistant-fg": "30 20% 25%",

			"status-bg": "38 30% 97%",
			"status-divider": "38 15% 85%",
			"status-active-fg": "142 65% 42%",

			"tool-running-bg": "255 65% 96%",
			"tool-running-fg": "255 65% 55%",
			"tool-running-border": "255 65% 55% / 0.15",
			"tool-complete-bg": "142 60% 94%",
			"tool-complete-fg": "142 60% 42%",
			"tool-complete-border": "142 60% 42% / 0.15",
			"tool-error-bg": "0 65% 94%",
			"tool-error-fg": "0 65% 50%",
			"tool-error-border": "0 65% 50% / 0.15",

			"diff-removed-bg": "0 65% 91%",
			"diff-removed-fg": "0 60% 42%",
			"diff-added-bg": "142 60% 90%",
			"diff-added-fg": "142 60% 38%",
			"diff-context-fg": "30 10% 52%",

			success: "142 60% 42%",
		},
	},
	{
		id: "midnight",
		name: "Midnight",
		description: "Deep blue-black dark theme, easy on the eyes",
		type: "dark",
		vars: {
			background: "220 18% 6%",
			foreground: "220 12% 85%",
			card: "220 16% 9%",
			"card-foreground": "220 12% 85%",
			popover: "220 16% 9%",
			"popover-foreground": "220 12% 85%",
			muted: "220 14% 12%",
			"muted-foreground": "220 10% 50%",

			primary: "210 80% 60%",
			"primary-foreground": "0 0% 100%",

			destructive: "0 70% 50%",
			"destructive-foreground": "0 0% 100%",

			border: "220 14% 18%",
			input: "220 14% 18%",
			ring: "210 80% 60%",

			"sidebar-background": "220 18% 6%",
			"sidebar-foreground": "220 12% 80%",
			"sidebar-accent": "220 16% 11%",
			"sidebar-accent-foreground": "220 12% 85%",
			"sidebar-border": "220 14% 14%",

			"chat-user-bg": "220 16% 11%",
			"chat-user-fg": "220 12% 85%",
			"chat-assistant-bg": "transparent",
			"chat-assistant-fg": "220 12% 82%",
			"chat-system-bg": "220 14% 15%",
			"chat-system-fg": "220 10% 55%",
			"chat-avatar-user-bg": "210 70% 50%",
			"chat-avatar-user-fg": "0 0% 100%",
			"chat-avatar-assistant-bg": "220 14% 22%",
			"chat-avatar-assistant-fg": "220 12% 80%",

			"status-bg": "220 16% 9%",
			"status-divider": "220 14% 16%",
			"status-active-fg": "160 70% 50%",

			"tool-running-bg": "220 16% 12%",
			"tool-running-fg": "210 80% 60%",
			"tool-running-border": "210 80% 60% / 0.2",
			"tool-complete-bg": "220 16% 10%",
			"tool-complete-fg": "160 60% 50%",
			"tool-complete-border": "160 60% 50% / 0.15",
			"tool-error-bg": "0 50% 14%",
			"tool-error-fg": "0 70% 50%",
			"tool-error-border": "0 70% 50% / 0.2",

			"diff-removed-bg": "0 50% 18% / 0.35",
			"diff-removed-fg": "0 60% 65%",
			"diff-added-bg": "160 50% 16% / 0.35",
			"diff-added-fg": "160 60% 60%",
			"diff-context-fg": "220 10% 45%",

			success: "160 60% 45%",
		},
	},
	{
		id: "solarized-dark",
		name: "Solarized Dark",
		description: "Solarized color scheme — warm dark, low contrast",
		type: "dark",
		vars: {
			background: "195 10% 15%",
			foreground: "45 20% 80%",
			card: "195 10% 18%",
			"card-foreground": "45 20% 80%",
			popover: "195 10% 18%",
			"popover-foreground": "45 20% 80%",
			muted: "195 10% 20%",
			"muted-foreground": "45 5% 55%",

			primary: "18 80% 55%",
			"primary-foreground": "0 0% 100%",

			destructive: "0 70% 50%",
			"destructive-foreground": "0 0% 100%",

			border: "195 10% 25%",
			input: "195 10% 25%",
			ring: "18 80% 55%",

			"sidebar-background": "195 10% 15%",
			"sidebar-foreground": "45 20% 75%",
			"sidebar-accent": "195 10% 21%",
			"sidebar-accent-foreground": "45 20% 80%",
			"sidebar-border": "195 10% 22%",

			"chat-user-bg": "195 10% 21%",
			"chat-user-fg": "45 20% 80%",
			"chat-assistant-bg": "transparent",
			"chat-assistant-fg": "45 20% 78%",
			"chat-system-bg": "195 10% 23%",
			"chat-system-fg": "45 5% 60%",
			"chat-avatar-user-bg": "18 80% 50%",
			"chat-avatar-user-fg": "0 0% 100%",
			"chat-avatar-assistant-bg": "195 10% 30%",
			"chat-avatar-assistant-fg": "45 20% 75%",

			"status-bg": "195 10% 18%",
			"status-divider": "195 10% 25%",
			"status-active-fg": "68 60% 50%",

			"tool-running-bg": "195 10% 21%",
			"tool-running-fg": "18 80% 55%",
			"tool-running-border": "18 80% 55% / 0.2",
			"tool-complete-bg": "195 10% 19%",
			"tool-complete-fg": "68 60% 50%",
			"tool-complete-border": "68 60% 50% / 0.15",
			"tool-error-bg": "0 50% 18%",
			"tool-error-fg": "0 70% 50%",
			"tool-error-border": "0 70% 50% / 0.2",

			"diff-removed-bg": "0 50% 22% / 0.35",
			"diff-removed-fg": "0 60% 65%",
			"diff-added-bg": "68 50% 18% / 0.35",
			"diff-added-fg": "68 60% 55%",
			"diff-context-fg": "45 5% 50%",

			success: "68 60% 45%",
		},
	},
	{
		id: "nord",
		name: "Nord",
		description: "Arctic-inspired cool blue theme, clean and minimal",
		type: "dark",
		vars: {
			background: "220 16% 12%",
			foreground: "218 10% 80%",
			card: "220 14% 15%",
			"card-foreground": "218 10% 80%",
			popover: "220 14% 15%",
			"popover-foreground": "218 10% 80%",
			muted: "220 12% 18%",
			"muted-foreground": "218 8% 55%",

			primary: "210 45% 65%",
			"primary-foreground": "220 16% 12%",

			destructive: "355 60% 60%",
			"destructive-foreground": "0 0% 100%",

			border: "220 12% 22%",
			input: "220 12% 22%",
			ring: "210 45% 65%",

			"sidebar-background": "220 16% 12%",
			"sidebar-foreground": "218 10% 75%",
			"sidebar-accent": "220 14% 18%",
			"sidebar-accent-foreground": "218 10% 80%",
			"sidebar-border": "220 12% 18%",

			"chat-user-bg": "220 14% 18%",
			"chat-user-fg": "218 10% 80%",
			"chat-assistant-bg": "transparent",
			"chat-assistant-fg": "218 10% 78%",
			"chat-system-bg": "220 12% 22%",
			"chat-system-fg": "218 8% 58%",
			"chat-avatar-user-bg": "210 45% 60%",
			"chat-avatar-user-fg": "220 16% 12%",
			"chat-avatar-assistant-bg": "220 12% 28%",
			"chat-avatar-assistant-fg": "218 10% 75%",

			"status-bg": "220 14% 15%",
			"status-divider": "220 12% 22%",
			"status-active-fg": "92 40% 55%",

			"tool-running-bg": "220 14% 18%",
			"tool-running-fg": "210 45% 65%",
			"tool-running-border": "210 45% 65% / 0.2",
			"tool-complete-bg": "220 14% 16%",
			"tool-complete-fg": "92 40% 55%",
			"tool-complete-border": "92 40% 55% / 0.15",
			"tool-error-bg": "355 40% 18%",
			"tool-error-fg": "355 60% 60%",
			"tool-error-border": "355 60% 60% / 0.2",

			"diff-removed-bg": "355 40% 22% / 0.35",
			"diff-removed-fg": "355 55% 70%",
			"diff-added-bg": "92 35% 18% / 0.35",
			"diff-added-fg": "92 40% 60%",
			"diff-context-fg": "218 8% 48%",

			success: "92 40% 50%",
		},
	},
	{
		id: "tokyo-night",
		name: "Tokyo Night",
		description: "Vibrant dark with electric purple and cyan accents",
		type: "dark",
		vars: {
			background: "235 20% 10%",
			foreground: "230 15% 82%",
			card: "235 18% 13%",
			"card-foreground": "230 15% 82%",
			popover: "235 18% 13%",
			"popover-foreground": "230 15% 82%",
			muted: "235 16% 16%",
			"muted-foreground": "230 10% 52%",

			primary: "275 80% 70%",
			"primary-foreground": "0 0% 100%",

			destructive: "0 65% 55%",
			"destructive-foreground": "0 0% 100%",

			border: "235 15% 22%",
			input: "235 15% 22%",
			ring: "275 80% 70%",

			"sidebar-background": "235 20% 10%",
			"sidebar-foreground": "230 15% 78%",
			"sidebar-accent": "235 18% 16%",
			"sidebar-accent-foreground": "230 15% 82%",
			"sidebar-border": "235 15% 16%",

			"chat-user-bg": "235 18% 16%",
			"chat-user-fg": "230 15% 82%",
			"chat-assistant-bg": "transparent",
			"chat-assistant-fg": "230 15% 80%",
			"chat-system-bg": "235 15% 20%",
			"chat-system-fg": "230 10% 55%",
			"chat-avatar-user-bg": "210 75% 60%",
			"chat-avatar-user-fg": "0 0% 100%",
			"chat-avatar-assistant-bg": "275 60% 40%",
			"chat-avatar-assistant-fg": "230 15% 80%",

			"status-bg": "235 18% 13%",
			"status-divider": "235 15% 22%",
			"status-active-fg": "150 65% 55%",

			"tool-running-bg": "235 18% 16%",
			"tool-running-fg": "275 80% 70%",
			"tool-running-border": "275 80% 70% / 0.2",
			"tool-complete-bg": "235 18% 14%",
			"tool-complete-fg": "150 65% 55%",
			"tool-complete-border": "150 65% 55% / 0.15",
			"tool-error-bg": "0 50% 18%",
			"tool-error-fg": "0 65% 55%",
			"tool-error-border": "0 65% 55% / 0.2",

			"diff-removed-bg": "0 50% 22% / 0.35",
			"diff-removed-fg": "0 60% 65%",
			"diff-added-bg": "150 50% 18% / 0.35",
			"diff-added-fg": "150 60% 60%",
			"diff-context-fg": "230 10% 48%",

			success: "150 65% 50%",
		},
	},
	{
		id: "catppuccin",
		name: "Catppuccin Mocha",
		description: "Warm dark with creamy pastel accents, easy on the eyes",
		type: "dark",
		vars: {
			background: "240 10% 10%",
			foreground: "225 10% 80%",
			card: "240 8% 13%",
			"card-foreground": "225 10% 80%",
			popover: "240 8% 13%",
			"popover-foreground": "225 10% 80%",
			muted: "240 6% 16%",
			"muted-foreground": "225 6% 55%",

			primary: "350 65% 75%",
			"primary-foreground": "240 10% 10%",

			destructive: "0 60% 55%",
			"destructive-foreground": "0 0% 100%",

			border: "240 6% 22%",
			input: "240 6% 22%",
			ring: "350 65% 75%",

			"sidebar-background": "240 10% 10%",
			"sidebar-foreground": "225 10% 75%",
			"sidebar-accent": "240 8% 16%",
			"sidebar-accent-foreground": "225 10% 80%",
			"sidebar-border": "240 6% 16%",

			"chat-user-bg": "240 8% 16%",
			"chat-user-fg": "225 10% 80%",
			"chat-assistant-bg": "transparent",
			"chat-assistant-fg": "225 10% 78%",
			"chat-system-bg": "240 6% 20%",
			"chat-system-fg": "225 6% 58%",
			"chat-avatar-user-bg": "350 65% 70%",
			"chat-avatar-user-fg": "240 10% 10%",
			"chat-avatar-assistant-bg": "240 6% 28%",
			"chat-avatar-assistant-fg": "225 10% 75%",

			"status-bg": "240 8% 13%",
			"status-divider": "240 6% 22%",
			"status-active-fg": "115 45% 65%",

			"tool-running-bg": "240 8% 16%",
			"tool-running-fg": "350 65% 75%",
			"tool-running-border": "350 65% 75% / 0.2",
			"tool-complete-bg": "240 8% 14%",
			"tool-complete-fg": "115 45% 65%",
			"tool-complete-border": "115 45% 65% / 0.15",
			"tool-error-bg": "0 40% 18%",
			"tool-error-fg": "0 60% 55%",
			"tool-error-border": "0 60% 55% / 0.2",

			"diff-removed-bg": "0 40% 22% / 0.35",
			"diff-removed-fg": "0 55% 70%",
			"diff-added-bg": "115 35% 16% / 0.35",
			"diff-added-fg": "115 45% 60%",
			"diff-context-fg": "225 6% 50%",

			success: "115 45% 55%",
		},
	},
	{
		id: "ayu-dark",
		name: "Ayu Dark",
		description: "Warm amber-toned dark with rich orange accents",
		type: "dark",
		vars: {
			background: "210 12% 10%",
			foreground: "40 20% 82%",
			card: "210 10% 13%",
			"card-foreground": "40 20% 82%",
			popover: "210 10% 13%",
			"popover-foreground": "40 20% 82%",
			muted: "210 8% 16%",
			"muted-foreground": "40 8% 52%",

			primary: "35 100% 60%",
			"primary-foreground": "210 12% 10%",

			destructive: "0 65% 55%",
			"destructive-foreground": "0 0% 100%",

			border: "210 8% 22%",
			input: "210 8% 22%",
			ring: "35 100% 60%",

			"sidebar-background": "210 12% 10%",
			"sidebar-foreground": "40 20% 78%",
			"sidebar-accent": "210 10% 16%",
			"sidebar-accent-foreground": "40 20% 82%",
			"sidebar-border": "210 8% 16%",

			"chat-user-bg": "210 10% 16%",
			"chat-user-fg": "40 20% 82%",
			"chat-assistant-bg": "transparent",
			"chat-assistant-fg": "40 20% 80%",
			"chat-system-bg": "210 8% 20%",
			"chat-system-fg": "40 8% 56%",
			"chat-avatar-user-bg": "35 100% 55%",
			"chat-avatar-user-fg": "210 12% 10%",
			"chat-avatar-assistant-bg": "210 8% 28%",
			"chat-avatar-assistant-fg": "40 20% 78%",

			"status-bg": "210 10% 13%",
			"status-divider": "210 8% 22%",
			"status-active-fg": "150 50% 55%",

			"tool-running-bg": "210 10% 16%",
			"tool-running-fg": "35 100% 60%",
			"tool-running-border": "35 100% 60% / 0.2",
			"tool-complete-bg": "210 10% 14%",
			"tool-complete-fg": "150 50% 55%",
			"tool-complete-border": "150 50% 55% / 0.15",
			"tool-error-bg": "0 40% 18%",
			"tool-error-fg": "0 65% 55%",
			"tool-error-border": "0 65% 55% / 0.2",

			"diff-removed-bg": "0 40% 22% / 0.35",
			"diff-removed-fg": "0 55% 65%",
			"diff-added-bg": "150 35% 16% / 0.35",
			"diff-added-fg": "150 50% 60%",
			"diff-context-fg": "40 8% 48%",

			success: "150 50% 50%",
		},
	},
	{
		id: "everforest",
		name: "Everforest Dark",
		description: "Earthy green-toned dark, calming like a forest at dusk",
		type: "dark",
		vars: {
			background: "150 12% 12%",
			foreground: "45 15% 80%",
			card: "150 10% 15%",
			"card-foreground": "45 15% 80%",
			popover: "150 10% 15%",
			"popover-foreground": "45 15% 80%",
			muted: "150 8% 18%",
			"muted-foreground": "45 8% 52%",

			primary: "160 40% 55%",
			"primary-foreground": "150 12% 12%",

			destructive: "0 55% 55%",
			"destructive-foreground": "0 0% 100%",

			border: "150 8% 24%",
			input: "150 8% 24%",
			ring: "160 40% 55%",

			"sidebar-background": "150 12% 12%",
			"sidebar-foreground": "45 15% 76%",
			"sidebar-accent": "150 10% 18%",
			"sidebar-accent-foreground": "45 15% 80%",
			"sidebar-border": "150 8% 18%",

			"chat-user-bg": "150 10% 18%",
			"chat-user-fg": "45 15% 80%",
			"chat-assistant-bg": "transparent",
			"chat-assistant-fg": "45 15% 78%",
			"chat-system-bg": "150 8% 22%",
			"chat-system-fg": "45 8% 56%",
			"chat-avatar-user-bg": "160 40% 50%",
			"chat-avatar-user-fg": "150 12% 12%",
			"chat-avatar-assistant-bg": "150 8% 30%",
			"chat-avatar-assistant-fg": "45 15% 76%",

			"status-bg": "150 10% 15%",
			"status-divider": "150 8% 24%",
			"status-active-fg": "95 40% 55%",

			"tool-running-bg": "150 10% 18%",
			"tool-running-fg": "160 40% 55%",
			"tool-running-border": "160 40% 55% / 0.2",
			"tool-complete-bg": "150 10% 16%",
			"tool-complete-fg": "95 40% 55%",
			"tool-complete-border": "95 40% 55% / 0.15",
			"tool-error-bg": "0 30% 18%",
			"tool-error-fg": "0 55% 55%",
			"tool-error-border": "0 55% 55% / 0.2",

			"diff-removed-bg": "0 30% 22% / 0.35",
			"diff-removed-fg": "0 50% 65%",
			"diff-added-bg": "95 30% 16% / 0.35",
			"diff-added-fg": "95 40% 58%",
			"diff-context-fg": "45 8% 48%",

			success: "95 40% 50%",
		},
	},
];

/** Apply a theme by setting CSS variables on the document root */
export function applyTheme(theme: Theme): void {
	const root = document.documentElement;
	const { vars } = theme;

	// Apply all CSS variable overrides
	for (const [key, value] of Object.entries(vars)) {
		root.style.setProperty(`--${key}`, value);
	}

	// Set data attribute for any theme-specific selectors
	root.setAttribute("data-theme", theme.id);
	root.setAttribute("data-theme-type", theme.type);

	// Persist to localStorage for instant load on next app start
	try {
		localStorage.setItem("zosma-theme", theme.id);
	} catch {
		// Ignore if localStorage is unavailable
	}
}

/** Load the saved theme from localStorage, or return the default */
export function getSavedTheme(): Theme {
	try {
		const saved = localStorage.getItem("zosma-theme");
		if (saved) {
			const found = THEMES.find((t) => t.id === saved);
			if (found) return found;
		}
	} catch {
		// Ignore
	}
	// Respect OS preference
	if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches) {
		return THEMES.find((t) => t.id === "zosma-light") || THEMES[0];
	}
	// Default: Solarized Dark
	return THEMES.find((t) => t.id === "solarized-dark") || THEMES[0];
}
