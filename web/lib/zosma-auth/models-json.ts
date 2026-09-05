/**
 * Zosma Router provider entry ops on ~/.pi/agent/models.json.
 *
 * Builds on lib/models-config-store.ts (atomic private write + cache
 * invalidation). Snapshot/restore give completeZosmaAuth its rollback
 * guarantee: if the registry never sees the new models, the previous
 * provider entry (or absence) is restored.
 */

import { readModelsConfig, writeModelsConfig } from "../models-config-store";

/**
 * Matches the provider id already present in live pi state
 * (~/.pi/agent/models.json). Re-login upgrades the entry in place
 * instead of creating a duplicate.
 */
export const ZOSMA_PROVIDER_ID = "zosma-router";

export interface ZosmaProviderEntry {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  api: string;
  models: Array<Record<string, unknown>>;
}

function providersOf(data: Record<string, unknown>): Record<string, unknown> {
  const providers = data.providers;
  if (providers && typeof providers === "object" && !Array.isArray(providers)) {
    return providers as Record<string, unknown>;
  }
  return {};
}

/**
 * Deep copy of the provider entry, or null if the provider is absent.
 */
export function snapshotProvider(modelsPath: string, providerId: string): unknown {
  const entry = providersOf(readModelsConfig(modelsPath))[providerId];
  return entry === undefined ? null : structuredClone(entry);
}

/**
 * Upsert the provider entry (replaces any existing one).
 */
export function upsertProvider(
  modelsPath: string,
  providerId: string,
  entry: ZosmaProviderEntry,
): void {
  const data = readModelsConfig(modelsPath);
  data.providers = { ...providersOf(data), [providerId]: structuredClone(entry) };
  writeModelsConfig(data, modelsPath);
}

/**
 * Restore a snapshot taken by snapshotProvider.
 * A null snapshot removes the provider.
 */
export function restoreProvider(
  modelsPath: string,
  providerId: string,
  snapshot: unknown,
): void {
  const data = readModelsConfig(modelsPath);
  const providers = providersOf(data);
  if (snapshot === null) {
    const rest = { ...providers };
    delete rest[providerId];
    data.providers = rest;
  } else {
    data.providers = { ...providers, [providerId]: snapshot };
  }
  writeModelsConfig(data, modelsPath);
}

export function deleteProvider(modelsPath: string, providerId: string): void {
  restoreProvider(modelsPath, providerId, null);
}

export function readProviderEntry(
  modelsPath: string,
  providerId: string,
): ZosmaProviderEntry | null {
  const entry = providersOf(readModelsConfig(modelsPath))[providerId];
  if (!entry || typeof entry !== "object") return null;
  return entry as ZosmaProviderEntry;
}
