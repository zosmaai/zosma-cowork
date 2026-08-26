/**
 * Pi Runtime Factory — builds one isolated SessionRuntime per session.
 *
 * Uses the shared auth/model/settings infrastructure passed in, but every
 * runtime gets its own SessionManager, resource loader (cwd-bound), fresh
 * prompt scheduler/watchdog state, event subscription, and extension UI
 * binding, so two loaded sessions never share mutable agent state.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	createAgentSession,
	SessionManager,
	type AuthStorage,
	type ModelRegistry,
	type SettingsManager,
	type DefaultResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { buildResourceLoader, resolveWorkspace } from "./agent-init.js";
import { bindExtensionUi, cancelSessionUiRequests } from "./extension-ui-bridge.js";
import { loadPiSession } from "./pi-session-store.js";
import { createPromptScheduler } from "./prompt-scheduler.js";
import { subscribeSession } from "./prompt-runner.js";
import {
	canonicalSessionFile,
	type SessionRuntime,
	type SessionRuntimeFactory,
} from "./session-runtime-manager.js";

export interface PiRuntimeFactoryDependencies {
	zosmaDir: string;
	authStorage: AuthStorage;
	modelRegistry: ModelRegistry;
	settingsManager: SettingsManager;
}

/**
 * Create the one real Pi runtime factory. `create` starts a fresh persisted
 * session bound to `cwd`; `load` reopens an existing session file at its
 * saved header cwd (falling back to the default workspace).
 */
export function createPiRuntimeFactory(
	deps: PiRuntimeFactoryDependencies,
): SessionRuntimeFactory {
	async function build(sessionManager: SessionManager, cwd: string): Promise<SessionRuntime> {
		const resourceLoader = (await buildResourceLoader(
			cwd,
			deps.zosmaDir,
			deps.settingsManager,
		)) as DefaultResourceLoader;
		const { session } = await createAgentSession({
			cwd,
			authStorage: deps.authStorage,
			modelRegistry: deps.modelRegistry,
			sessionManager,
			settingsManager: deps.settingsManager,
			resourceLoader,
		});
		const sessionFile = sessionManager.getSessionFile();
		if (!sessionFile) throw new Error("Pi did not create a persisted session file");

		// Best-effort marker so other tooling can see which workspace is active.
		try {
			writeFileSync(join(cwd, ".pi", "cowork_active"), `${process.pid}`, "utf-8");
		} catch {
			// best-effort
		}

		const runtime: SessionRuntime = {
			sessionFile: canonicalSessionFile(sessionFile),
			cwd,
			session,
			sessionManager,
			resourceLoader,
			promptScheduler: createPromptScheduler(),
			prompt: { activePromptId: null, startedAt: 0, hasEmitted: false },
			status: "idle",
			error: undefined,
			unsubscribe: () => {},
			dispose: async () => {
				cancelSessionUiRequests(runtime.sessionFile);
				if (session.isStreaming) await session.abort();
				await runtime.promptScheduler.idle();
				runtime.unsubscribe();
				session.dispose();
			},
		};
		runtime.unsubscribe = subscribeSession(runtime);
		await bindExtensionUi(runtime.sessionFile, session);
		return runtime;
	}

	return {
		create: async (cwd) => build(SessionManager.create(cwd), cwd),
		load: async (sessionFile) => {
			const loaded = loadPiSession(sessionFile);
			const cwd = resolveWorkspace(loaded.cwd, deps.zosmaDir);
			return build(loaded.manager, cwd);
		},
	};
}