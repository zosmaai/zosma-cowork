import { queryOptions } from "@tanstack/react-query";
import {
	type AgentStateData,
	getAgentState,
	getRunningSessionIds,
} from "@/lib/api-v1-client";
import { TAGS } from "./tags";

export const agentService = {
	/** Lightweight running-session ids poll. Adaptive cadence: fast while
	 *  anything runs (drives the sidebar "running" dots + ChatWindow SSE
	 *  attach), backed off when idle so the app stops chattering. Query
	 *  dedupe + shared keys mean two subscribers still produce ONE request. */
	runningQueryOptions: () =>
		queryOptions({
			queryKey: TAGS.agent.running,
			refetchInterval: (query) => {
				const ids = query.state.data;
				return ids && ids.length > 0 ? 2500 : 5000;
			},
			queryFn: (): Promise<string[]> => getRunningSessionIds(),
		}),

	stateQueryOptions: (sessionId: string, enabled = true) =>
		queryOptions({
			queryKey: TAGS.agent.state(sessionId),
			enabled: Boolean(sessionId) && enabled,
			refetchInterval: (query) => (query.state.data?.running ? 15_000 : false),
			queryFn: (): Promise<AgentStateData> => getAgentState(sessionId),
		}),
};
