/**
 * Zosma Cowork — Gmail Extension (owned, broker-aware)
 *
 * Registers the `gmail` tool. Vendored from the MIT-licensed `@e9n/pi-gmail`
 * (see LICENSE.upstream) with its OAuth layer replaced by the shared broker-aware
 * core (../google-auth/oauth-access). Gmail now uses the SAME brokered
 * ~/.pi/agent/google-workspace/oauth.json as Calendar/Drive/Docs/Sheets/Slides —
 * one consent, one token file, NO client secret on disk — which is why the
 * upstream package failed on a brokered connect (it self-refreshed directly with
 * Google and rejected an empty client_secret).
 *
 * Loaded by DefaultResourceLoader via extensionFactories in index.ts. The
 * upstream @e9n/pi-gmail disk copy is excluded (SUPERSEDED_GOOGLE_PACKAGES) so
 * the `gmail` tool name doesn't double-register.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerGmailTool } from "./tool.js";

export default async function zosmaGmail(pi: ExtensionAPI): Promise<void> {
	registerGmailTool(pi, () => ({ maxResults: 20 }));
}
