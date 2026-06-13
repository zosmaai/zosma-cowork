/**
 * CustomProviderRow — "Custom Local LLM" UI (issue #207).
 *
 * Lets the user point Zosma Cowork at any OpenAI-Chat-Completions-compatible
 * server (Ollama, LM Studio, vLLM, llama.cpp `--server`, text-generation-webui,
 * a private gateway, …) by entering a base URL and an optional API key.
 *
 * Why this is the right design surface:
 *   - pi-mono's `ModelRegistry` already speaks `models.json`'s
 *     `providers.<id>` shape; the sidecar's `save_custom_provider` writes
 *     that shape and re-inits the registry so the model dropdown lights
 *     up without an app restart.
 *   - The raw API key is never round-tripped back to the frontend — the
 *     sidecar only returns a `…last4` hint when one is configured.
 *   - The UI uses a single provider id (`custom-local-llm`) because the
 *     issue's reporter asked for "a local server", not "many endpoints".
 *     If we later want to support N endpoints, the sidecar already
 *     handles it — only this component is single-slot.
 *
 * UX (#207 follow-up): the form asks for only a base URL + optional API
 * key. On Save the sidecar probes the server's OpenAI `GET /models`
 * endpoint and stores *every* model it reports — one local server can host
 * many models. If discovery finds nothing (server has no /models route, or
 * is unreachable) the sidecar replies `NO_MODELS_DISCOVERED:<reachable>` and
 * we reveal a manual model-id field so the provider can still be saved.
 */

import type { CustomProvider, SaveCustomProviderInput } from "@/types/auth";
import { invoke } from "@tauri-apps/api/core";
import { Check, ChevronDown, Eye, EyeOff, Loader2, Server } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useId, useState } from "react";

const ease = [0.16, 1, 0.3, 1] as const;
const PROVIDER_ID = "custom-local-llm";
const PROVIDER_NAME = "Custom Local LLM";
const NO_MODELS_PREFIX = "NO_MODELS_DISCOVERED";

/** Split a free-text model-id list (commas / whitespace / newlines) into ids. */
function parseModelIds(raw: string): string[] {
	return [
		...new Set(
			raw
				.split(/[\s,]+/)
				.map((s) => s.trim())
				.filter(Boolean),
		),
	];
}

interface Props {
	onChange?: () => void;
}

export function CustomProviderRow({ onChange }: Props) {
	const [expanded, setExpanded] = useState(false);
	const [existing, setExisting] = useState<CustomProvider[]>([]);
	const [baseUrl, setBaseUrl] = useState("");
	// Manual model-id entry is a fallback: hidden until discovery comes up
	// empty, then revealed so the user can type the ids themselves.
	const [manualMode, setManualMode] = useState(false);
	const [manualModels, setManualModels] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [showKey, setShowKey] = useState(false);
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const reduced = useReducedMotion();
	const baseUrlId = useId();
	const manualModelsId = useId();
	const apiKeyId = useId();

	const refresh = useCallback(async () => {
		try {
			const result = await invoke<{ providers: CustomProvider[] }>("list_custom_providers");
			setExisting(result?.providers ?? []);
		} catch {
			// Sidecar may not be ready yet — leave the existing list empty.
			setExisting([]);
		}
	}, []);

	useEffect(() => {
		refresh();
	}, [refresh]);

	// Single-slot today: a save always targets PROVIDER_ID, so when one is
	// already configured the form is an *edit* of it, not a second endpoint.
	const editingExisting = existing.length > 0;
	const existingHasKey = existing[0]?.hasApiKey ?? false;

	// Load a saved provider's values into the form so the user can tweak it
	// instead of re-typing from scratch. The raw API key never round-trips
	// back, so we leave that field blank — blank means "keep the current key"
	// (the sidecar preserves it; see save_custom_provider).
	const startEdit = useCallback((p: CustomProvider) => {
		setBaseUrl(p.baseUrl);
		// Prefill the manual field with the saved ids, but keep it hidden — a
		// re-save re-discovers unless the user opts back into manual entry.
		setManualModels(p.models.map((m) => m.id).join(", "));
		setManualMode(false);
		setApiKey("");
		setError(null);
		setExpanded(true);
	}, []);

	const canSave =
		baseUrl.trim().length > 0 && !saving && (!manualMode || parseModelIds(manualModels).length > 0);

	const handleSave = useCallback(async () => {
		if (!canSave) return;
		setSaving(true);
		setError(null);
		const payload: SaveCustomProviderInput = {
			id: PROVIDER_ID,
			name: PROVIDER_NAME,
			baseUrl: baseUrl.trim(),
			// Empty string ⇒ undefined so the sidecar substitutes its
			// sentinel placeholder — the UI never invents a fake key.
			apiKey: apiKey.trim() ? apiKey.trim() : undefined,
			// Empty array ⇒ "discover models from the server". A populated array
			// is the manual-entry fallback.
			models: manualMode ? parseModelIds(manualModels).map((id) => ({ id })) : [],
		};
		try {
			await invoke("save_custom_provider", { provider: payload });
			setSaved(true);
			setApiKey("");
			window.dispatchEvent(new CustomEvent("config-reload"));
			onChange?.();
			await refresh();
			setTimeout(() => {
				setSaved(false);
				setExpanded(false);
			}, 1200);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg.startsWith(NO_MODELS_PREFIX)) {
				// Discovery found nothing — reveal manual entry instead of failing.
				setManualMode(true);
				setError(
					msg.endsWith("unreachable")
						? "Couldn't reach that endpoint. Check the URL, or enter model IDs manually below."
						: "No models were auto-discovered at this endpoint. Enter one or more model IDs below.",
				);
			} else {
				setError(msg);
			}
		} finally {
			setSaving(false);
		}
	}, [canSave, baseUrl, manualMode, manualModels, apiKey, onChange, refresh]);

	const handleDelete = useCallback(
		async (id: string) => {
			try {
				await invoke("delete_custom_provider", { providerId: id });
				window.dispatchEvent(new CustomEvent("config-reload"));
				onChange?.();
				await refresh();
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			}
		},
		[onChange, refresh],
	);

	return (
		<div className="rounded-lg border border-border overflow-hidden bg-card">
			{/* Header — always visible */}
			<button
				type="button"
				onClick={() => {
					const next = !expanded;
					// Opening with a provider already saved → prefill it for editing
					// (unless the user already has unsaved input in the form).
					if (next && editingExisting && !baseUrl) {
						startEdit(existing[0]);
					} else {
						setExpanded(next);
					}
					setError(null);
				}}
				className="w-full flex items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-muted/20"
			>
				<Server className="w-4.5 h-4.5 shrink-0 text-foreground/50" />
				<span className="flex-1 text-[13px] text-foreground">
					{PROVIDER_NAME}
					{existing.length > 0 && (
						<span className="ml-2 text-[10px] font-medium text-muted-foreground/70">
							{existing.length} configured
						</span>
					)}
				</span>
				<motion.div
					animate={{ rotate: expanded ? 180 : 0 }}
					transition={{ duration: reduced ? 0 : 0.18, ease }}
				>
					<ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50" />
				</motion.div>
			</button>

			{/* Existing endpoints — always visible so the user knows what's
			    configured before they expand. */}
			{existing.length > 0 && (
				<ul
					className="px-3.5 pb-3 space-y-1.5"
					style={{ borderTop: "1px solid hsl(var(--border))" }}
				>
					{existing.map((p) => (
						<li
							key={p.id}
							className="flex items-center gap-2 text-[11px] rounded-md border border-border px-2 py-1.5 mt-3 bg-background"
						>
							<span className="font-mono truncate flex-1" title={p.baseUrl}>
								{p.baseUrl}
							</span>
							{p.hasApiKey && p.apiKeyHint && (
								<span
									className="font-mono text-[10px] text-muted-foreground"
									title="API key (last 4 chars)"
								>
									{p.apiKeyHint}
								</span>
							)}
							<span className="text-[10px] text-muted-foreground">
								{p.models.length} model{p.models.length === 1 ? "" : "s"}
							</span>
							<button
								type="button"
								onClick={() => handleDelete(p.id)}
								aria-label={`Delete ${p.name}`}
								className="text-[11px] px-2 py-0.5 rounded-md border border-border text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors"
							>
								Delete
							</button>
						</li>
					))}
				</ul>
			)}

			<AnimatePresence initial={false}>
				{expanded && (
					<motion.div
						key="custom-llm-body"
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={{ duration: reduced ? 0 : 0.22, ease }}
						style={{ overflow: "hidden" }}
					>
						<div
							className="px-3.5 pb-3.5 pt-0"
							style={{ borderTop: "1px solid hsl(var(--border))" }}
						>
							<p className="text-[11px] text-muted-foreground pt-3 pb-2.5 leading-relaxed">
								Connect to any OpenAI-compatible endpoint — Ollama, LM Studio, vLLM, llama.cpp{" "}
								<code>--server</code>, a private gateway, … We'll detect the available models for
								you on save.
							</p>

							{/* Base URL */}
							<label htmlFor={baseUrlId} className="block text-[11px] mb-1 text-muted-foreground">
								Base URL
							</label>
							<input
								id={baseUrlId}
								type="text"
								value={baseUrl}
								onChange={(e) => setBaseUrl(e.target.value)}
								placeholder="http://localhost:11434/v1"
								className="w-full text-[12px] font-mono px-3 py-2 mb-2 rounded-md border focus:outline-none transition-colors"
								style={{
									background: "hsl(var(--background))",
									borderColor: error ? "hsl(var(--destructive))" : "hsl(var(--border))",
									color: "hsl(var(--foreground))",
								}}
							/>

							{/* Model IDs — only shown as a fallback when auto-discovery finds
							    nothing, or when editing an endpoint that has no /models route. */}
							{manualMode && (
								<>
									<label
										htmlFor={manualModelsId}
										className="block text-[11px] mb-1 text-muted-foreground"
									>
										Model IDs
									</label>
									<input
										id={manualModelsId}
										type="text"
										value={manualModels}
										onChange={(e) => setManualModels(e.target.value)}
										placeholder="llama3.1:8b, mistral:7b"
										className="w-full text-[12px] font-mono px-3 py-2 mb-1 rounded-md border focus:outline-none transition-colors"
										style={{
											background: "hsl(var(--background))",
											borderColor: error ? "hsl(var(--destructive))" : "hsl(var(--border))",
											color: "hsl(var(--foreground))",
										}}
									/>
									<p className="text-[10px] text-muted-foreground/70 mb-2">
										Comma- or space-separated. Used because this endpoint didn't expose a model
										list.
									</p>
								</>
							)}

							{/* API key (optional) */}
							<label htmlFor={apiKeyId} className="block text-[11px] mb-1 text-muted-foreground">
								API key (optional)
							</label>
							<div className="relative mb-3">
								<input
									id={apiKeyId}
									type={showKey ? "text" : "password"}
									value={apiKey}
									onChange={(e) => setApiKey(e.target.value)}
									placeholder={
										editingExisting && existingHasKey
											? "leave blank to keep current key"
											: "leave blank for Ollama / LM Studio"
									}
									className="w-full text-[12px] font-mono px-3 py-2 pr-8 rounded-md border focus:outline-none transition-colors"
									style={{
										background: "hsl(var(--background))",
										borderColor: error ? "hsl(var(--destructive))" : "hsl(var(--border))",
										color: "hsl(var(--foreground))",
									}}
								/>
								<button
									type="button"
									onClick={() => setShowKey((v) => !v)}
									className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
									tabIndex={-1}
									aria-label={showKey ? "Hide API key value" : "Reveal API key value"}
								>
									{showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
								</button>
							</div>

							<div className="flex gap-2">
								<motion.button
									type="button"
									onClick={handleSave}
									disabled={!canSave || saved}
									className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-md text-[12px] font-medium transition-colors disabled:opacity-50"
									style={{
										background: saved ? "hsl(var(--primary) / 0.15)" : "hsl(var(--primary))",
										color: saved ? "hsl(var(--primary))" : "hsl(var(--primary-foreground))",
									}}
									whileTap={reduced ? {} : { scale: 0.96 }}
									transition={{ duration: 0.12, ease }}
								>
									{saving ? (
										<Loader2 className="w-3.5 h-3.5 animate-spin" />
									) : saved ? (
										<Check className="w-3.5 h-3.5" />
									) : editingExisting ? (
										"Update"
									) : (
										"Save"
									)}
								</motion.button>
							</div>

							{error && <p className="text-[11px] mt-2 text-destructive">{error}</p>}
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}
