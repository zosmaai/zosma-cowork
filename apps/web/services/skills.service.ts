import { queryOptions } from "@tanstack/react-query";
import type { SkillsResponse } from "@/lib/api-types";
import { listSkills } from "@/lib/api-v1-client";
import { TAGS } from "./tags";

export const skillsService = {
	/** Installed skills per cwd (with install info). Cached so settings tab
	 *  switches and dialog reopens are instant. Refresh button invalidates. */
	byCwdQueryOptions: (cwd?: string, enabled = true) =>
		queryOptions({
			queryKey: TAGS.skills.byCwd(cwd),
			enabled,
			staleTime: 30_000,
			queryFn: (): Promise<SkillsResponse> => listSkills(cwd),
		}),
};