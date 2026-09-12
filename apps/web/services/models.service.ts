import { queryOptions } from "@tanstack/react-query";
import type { ModelsResponse } from "@/lib/api-contracts";
import { getModels } from "@/lib/api-v1-client";
import { TAGS } from "./tags";

export const modelsService = {
	/** Model catalog per cwd. Expensive when a provider (llama-swap) is down —
	 *  the daemon re-probes every call. Long staleTime + cache means remounts /
	 *  cwd changes reuse the catalog instead of re-hitting the daemon mid-turn. */
	byCwdQueryOptions: (cwd?: string, enabled = true) =>
		queryOptions({
			queryKey: TAGS.models.byCwd(cwd),
			enabled,
			staleTime: 60_000,
			queryFn: (): Promise<ModelsResponse> => getModels(cwd),
		}),
};
