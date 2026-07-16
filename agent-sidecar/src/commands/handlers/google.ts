/**
 * Google Workspace command handlers: connect_google, get_google_status, 
 * disconnect_google, get_google_prefs, save_google_prefs, 
 * get_google_app_status, install_google_app
 */

import { send as sendMsg, log } from "../../protocol.js";
import type { HandlerDependencies } from "../handler-registry.js";
import { piAgentDir } from "../../agent-init.js";

export async function handleConnectGoogle(deps: HandlerDependencies, cmd: any): Promise<void> {
	try {
		const { runConsent } = await import("../../google-auth/consent.js");
		const { defaultGooglePaths, fanOutCredentials, hasEmbeddedClient } =
			await import("../../google-auth/broker.js");
		const {
			readScopePrefs,
			readByoClient,
			defaultCoworkGooglePaths,
			writeScopePrefs,
			writeByoClient,
			clearByoOnly,
		} = await import("../../google-auth/prefs-store.js");
		const { resolveScopes } = await import("../../google-auth/scopes.js");

		const coworkPaths = defaultCoworkGooglePaths();
		const hasByo = Boolean(cmd.byo?.clientId || readByoClient(coworkPaths));
		if (!hasEmbeddedClient() && !hasByo) {
			sendMsg({
				type: "error",
				id: cmd.id,
				message:
					"No Google OAuth client configured. Set ZOSMA_GOOGLE_CLIENT_ID, or supply your own client id + secret in Advanced.",
			});
			return;
		}

		if (deps.googleConsentAbort) {
			deps.googleConsentAbort.abort();
		}
		const ac = new AbortController();
		deps.setGoogleConsentAbort(ac);
		const cmdId = cmd.id;
		const paths = defaultGooglePaths(piAgentDir());

		const prefs = cmd.prefs ?? readScopePrefs(coworkPaths);
		const byo = cmd.byo === null ? null : (cmd.byo ?? readByoClient(coworkPaths));
		writeScopePrefs(coworkPaths, prefs);
		if (cmd.byo) writeByoClient(coworkPaths, cmd.byo);
		else if (cmd.byo === null) clearByoOnly(coworkPaths);

		const { embeddedClient } = await import("../../google-auth/broker.js");
		const client = embeddedClient(byo);
		const scopes = resolveScopes(prefs);
		log("Google connect: byo=%s prefs=%o requesting %d scopes", Boolean(byo), prefs, scopes.length);

		// Fire async consent flow
		(async () => {
			try {
				sendMsg({
					type: "event",
					event: {
						kind: "oauth_progress",
						provider: "google",
						message: "Opening browser for Google consent…",
					},
				});
				const result = await runConsent({
					client,
					scopes,
					onAuthUrl: (url: string) => {
						sendMsg({
							type: "event",
							event: {
								kind: "oauth_open_url",
								provider: "google",
								url,
								instructions:
									"Sign in with your Google account to connect Gmail, Calendar, Drive, Docs, Sheets and Slides.",
							},
						});
					},
					signal: ac.signal,
				});

				sendMsg({
					type: "event",
					event: {
						kind: "oauth_progress",
						provider: "google",
						message: "Google consent granted. Fanning out credentials…",
					},
				});

				fanOutCredentials(paths, {
					client,
					tokens: result.tokens,
					email: result.email,
					redirectUri: result.redirectUri,
					prefs,
				});

				log(
					"Google: credentials fanned out to %s and %s + %s",
					paths.workspaceOAuth,
					paths.piSettings,
					paths.gmailTokens,
				);
				if (!ac.signal.aborted) ac.abort();
				deps.setGoogleConsentAbort(null);

				sendMsg({
					type: "result",
					id: cmdId,
					data: { success: true, email: result.email },
				});
				sendMsg({
					type: "event",
					event: { kind: "oauth_completed", provider: "google", email: result.email },
				});
			} catch (err: unknown) {
				const errMsg = err instanceof Error ? err.message : String(err);
				const cancelled = err instanceof Error && err.name === "AbortError";
				log("Google consent %s: %s", cancelled ? "cancelled" : "failed", errMsg);
				if (deps.googleConsentAbort === ac) deps.setGoogleConsentAbort(null);
				sendMsg({
					type: cancelled ? "result" : "error",
					id: cmdId,
					...(cancelled
						? { data: { success: false, cancelled: true } }
						: { message: `Google connect failed: ${errMsg}` }),
				});
			}
		})();
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		log("connect_google error: %s", msg);
		sendMsg({ type: "error", id: cmd.id, message: `Google connect failed: ${msg}` });
	}
}

export async function handleGetGoogleStatus(deps: HandlerDependencies, cmd: any): Promise<void> {
	try {
		const { googleStatus, hasEmbeddedClient, defaultGooglePaths } =
			await import("../../google-auth/broker.js");
		const st: any = googleStatus(defaultGooglePaths(piAgentDir()));
		sendMsg({
			type: "result",
			id: cmd.id,
			data: {
				connected: st.connected,
				email: st.email,
				hasEmbeddedClient: hasEmbeddedClient(),
				expiresAt: st.expiresAt,
			},
		});
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		sendMsg({ type: "error", id: cmd.id, message: msg });
	}
}

export async function handleDisconnectGoogle(deps: HandlerDependencies, cmd: any): Promise<void> {
	try {
		const { disconnectGoogle, defaultGooglePaths } = await import("../../google-auth/broker.js");
		const piPaths = defaultGooglePaths(piAgentDir());
		disconnectGoogle(piPaths);
		sendMsg({ type: "result", id: cmd.id, data: { success: true } });
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		sendMsg({ type: "error", id: cmd.id, message: msg });
	}
}

export async function handleGetGooglePrefs(deps: HandlerDependencies, cmd: any): Promise<void> {
	try {
		const { CAPABILITY_MATRIX, DEFAULT_PREFS, resolveScopes, tierOf } =
			await import("../../google-auth/scopes.js");
		const { readScopePrefs, readByoClient, defaultCoworkGooglePaths } =
			await import("../../google-auth/prefs-store.js");

		const coworkPaths = defaultCoworkGooglePaths();
		const prefs = readScopePrefs(coworkPaths);
		const byo = readByoClient(coworkPaths);

		sendMsg({
			type: "result",
			id: cmd.id,
			data: {
				capabilities: CAPABILITY_MATRIX,
				defaultPrefs: DEFAULT_PREFS,
				prefs,
				byo,
				scopes: resolveScopes(prefs),
				tier: tierOf(prefs),
			},
		});
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		sendMsg({ type: "error", id: cmd.id, message: msg });
	}
}

export async function handleSaveGooglePrefs(deps: HandlerDependencies, cmd: any): Promise<void> {
	try {
		const { defaultCoworkGooglePaths, writeScopePrefs, readScopePrefs, clearByoOnly, writeByoClient } =
			await import("../../google-auth/prefs-store.js");
		const { resolveScopes } = await import("../../google-auth/scopes.js");

		const coworkPaths = defaultCoworkGooglePaths();
		if (cmd.prefs) writeScopePrefs(coworkPaths, cmd.prefs);
		if (cmd.byo === null) {
			clearByoOnly(coworkPaths);
		} else if (cmd.byo) {
			writeByoClient(coworkPaths, cmd.byo);
		}
		const prefs = readScopePrefs(coworkPaths);
		sendMsg({
			type: "result",
			id: cmd.id,
			data: { success: true, prefs, requestedScopes: resolveScopes(prefs) },
		});
	} catch (err: unknown) {
		const errMsg = err instanceof Error ? err.message : String(err);
		sendMsg({ type: "error", id: cmd.id, message: `Failed to save Google prefs: ${errMsg}` });
	}
}

export async function handleGetGoogleAppStatus(deps: HandlerDependencies, cmd: any): Promise<void> {
	try {
		const { readScopePrefs, defaultCoworkGooglePaths } = await import("../../google-auth/prefs-store.js");
		const { appExtensionStatus } = await import("../../google-auth/app-requirements.js");
		const { readPiPackages } = await import("../../disk-extension-loader.js");

		const prefs = cmd.prefs ?? readScopePrefs(defaultCoworkGooglePaths());
		const status = appExtensionStatus(prefs, readPiPackages(piAgentDir()));
		sendMsg({ type: "result", id: cmd.id, data: status });
	} catch (err: unknown) {
		const errMsg = err instanceof Error ? err.message : String(err);
		sendMsg({ type: "error", id: cmd.id, message: `Failed to read Google app status: ${errMsg}` });
	}
}

export async function handleInstallGoogleApp(deps: HandlerDependencies, cmd: any): Promise<void> {
	// NOTE: Runtime extension installation is disabled in the commercial product.
	// Extensions are pre-installed at build time by the developer.
	// This command now only reports the current status without installing anything.
	try {
		const { readScopePrefs, defaultCoworkGooglePaths } = await import("../../google-auth/prefs-store.js");
		const { appExtensionStatus } = await import("../../google-auth/app-requirements.js");
		const { readPiPackages } = await import("../../disk-extension-loader.js");

		const prefs = cmd.prefs ?? readScopePrefs(defaultCoworkGooglePaths());
		const status = appExtensionStatus(prefs, readPiPackages(piAgentDir()));
		sendMsg({ type: "result", id: cmd.id, data: status });
	} catch (err: unknown) {
		const errMsg = err instanceof Error ? err.message : String(err);
		log("install_google_app error: %s", errMsg);
		sendMsg({ type: "error", id: cmd.id, message: `Failed to read Google app status: ${errMsg}` });
	}
}
