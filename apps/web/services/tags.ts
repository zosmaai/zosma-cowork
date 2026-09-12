/**
 * Central registry of TanStack Query cache keys (land-ops pattern).
 * Every domain owns a top-level key; sub-keys narrow scope for granular
 * invalidation. `as const` keeps keys literal tuples.
 */
export const TAGS = {
	sessions: {
		all: ["sessions"] as const,
		detail: (id: string) => ["sessions", id] as const,
		context: (id: string) => ["sessions", id, "context"] as const,
	},
	agent: {
		running: ["agent", "running"] as const,
		state: (id: string) => ["agent", id, "state"] as const,
	},
	models: {
		byCwd: (cwd?: string) => ["models", cwd ?? ""] as const,
	},
	plugins: {
		byCwd: (cwd?: string) => ["plugins", cwd ?? ""] as const,
	},
	skills: {
		byCwd: (cwd?: string) => ["skills", cwd ?? ""] as const,
	},
} as const;
