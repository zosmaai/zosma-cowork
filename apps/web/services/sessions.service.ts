import { queryOptions } from "@tanstack/react-query";
import type {
	SessionContext,
	SessionDetailsResponse,
	SessionsResponse,
} from "@/lib/api-contracts";
import {
	getSessionContext,
	getSessionDetails,
	listSessions,
} from "@/lib/api-v1-client";
import { TAGS } from "./tags";

export const sessionsService = {
	/** Sidebar session list. Invalidate (TAGS.sessions.all) on session
	 *  create/fork/delete instead of forcing disk re-scans client-side. */
	listQueryOptions: () =>
		queryOptions({
			queryKey: TAGS.sessions.all,
			queryFn: (): Promise<SessionsResponse> => listSessions(),
		}),

	detailQueryOptions: (sessionId: string, enabled = true) =>
		queryOptions({
			queryKey: TAGS.sessions.detail(sessionId),
			enabled: Boolean(sessionId) && enabled,
			// New sessions 404 until pi flushes the file — the UI already owns the
			// in-memory stream, so a 404 must never blank anything. retry:false
			// keeps the error from re-hammering the daemon every mount.
			retry: false,
			staleTime: 30_000,
			queryFn: (): Promise<SessionDetailsResponse> =>
				getSessionDetails(sessionId, { deferThinking: true, deferMedia: true }),
		}),

	contextQueryOptions: (
		sessionId: string,
		leafId?: string | null,
		enabled = true,
	) =>
		queryOptions({
			queryKey: TAGS.sessions.context(sessionId),
			enabled: Boolean(sessionId) && enabled,
			retry: false,
			staleTime: 30_000,
			queryFn: (): Promise<SessionContext> =>
				getSessionContext(sessionId, leafId ?? null),
		}),
};
