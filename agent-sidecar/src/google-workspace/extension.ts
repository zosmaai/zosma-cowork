/**
 * Zosma Cowork — Google Workspace Extension
 *
 * Registers the Drive / Docs / Sheets / Slides tools (+ google_workspace_status).
 * Vendored from the MIT-licensed `pi-google-workspace` and made broker-aware:
 * auth runs through Cowork's shared ../google-auth/oauth-access module, so a
 * single brokered "Connect Google" provisions these tools with no client secret
 * on disk — replacing the upstream package, which required one.
 *
 * Loaded by DefaultResourceLoader via extensionFactories in index.ts.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import registerGoogleWorkspaceTools from "./tools.js";

export default async function zosmaGoogleWorkspace(pi: ExtensionAPI): Promise<void> {
	await registerGoogleWorkspaceTools(pi);
}
