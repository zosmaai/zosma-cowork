/**
 * Extension setup registry — whitelist of extensions that get a bespoke,
 * Cowork-native configuration screen (instead of a generic capabilities view).
 *
 * To add one: implement a setup component taking `ExtensionSetupProps` and map
 * its package name here. The same key must be whitelisted in the sidecar
 * (`WHITELISTED_CONFIG_FILES` in agent-sidecar/src/index.ts) when the extension
 * stores config in its own file.
 */

import { MessengerBridgeSetup } from "@/components/extension-setup/MessengerBridgeSetup";
import type { ZemExtension } from "@/types";
import type { FC } from "react";

export interface ExtensionSetupProps {
	ext: ZemExtension;
	/** Whitelist key passed to get/save_extension_config_file (matches the sidecar). */
	configKey: string;
}

export interface ExtensionSetupEntry {
	key: string;
	Component: FC<ExtensionSetupProps>;
}

/** package name → bespoke setup component */
const REGISTRY: Record<string, FC<ExtensionSetupProps>> = {
	"pi-messenger-bridge": MessengerBridgeSetup,
};

/**
 * Resolve a bespoke setup screen for an extension, matching its id, npm source,
 * or name against the registry (lenient so `npm:pi-messenger-bridge` matches
 * `pi-messenger-bridge`). Returns the entry plus the canonical whitelist key.
 */
export function getExtensionSetup(ext: {
	id?: string;
	name?: string;
	source?: { value?: string };
}): ExtensionSetupEntry | undefined {
	const candidates = [ext.id, ext.source?.value, ext.name].filter(Boolean) as string[];
	for (const key of Object.keys(REGISTRY)) {
		if (candidates.some((c) => c === key || c.includes(key))) {
			return { key, Component: REGISTRY[key] };
		}
	}
	return undefined;
}
