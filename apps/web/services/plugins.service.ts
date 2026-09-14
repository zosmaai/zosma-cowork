import { queryOptions } from "@tanstack/react-query";
import type { PluginsResponse } from "@/lib/api-types";
import { listPlugins } from "@/lib/api-v1-client";
import { TAGS } from "./tags";

export const pluginsService = {
	/** Installed plugin/extensions packages per cwd. The daemon resolves
	 *  packages through settings + package-manager flow (slow-ish); cache
	 *  means tab switches / dialog reopens never refetch. Refresh button
	 *  invalidates. */
	byCwdQueryOptions: (cwd?: string, enabled = true) =>
		queryOptions({
			queryKey: TAGS.plugins.byCwd(cwd),
			enabled,
			staleTime: 30_000,
			queryFn: (): Promise<PluginsResponse> => listPlugins(cwd),
		}),
};