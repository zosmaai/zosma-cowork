"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

/**
 * Client-side query tree. A fresh QueryClient per mount (no shared state
 * across SSR/sessions). Defaults tuned for a chat app backed by the daemon:
 * - staleTime 20s: session lists/models change on discrete events, not idle;
 *   mount/remount storms reuse the cached copy instead of re-hitting the
 *   daemon (the old per-mount refetch chain is what saturated it mid-turn).
 * - refetchOnWindowFocus false: focus already re-attaches the SSE stream;
 *   refetching every read on focus is redundant.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
	const [queryClient] = useState(
		() =>
			new QueryClient({
				defaultOptions: {
					queries: {
						staleTime: 20_000,
						gcTime: 5 * 60 * 1000,
						retry: 1,
						refetchOnWindowFocus: false,
					},
				},
			}),
	);

	return (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}
