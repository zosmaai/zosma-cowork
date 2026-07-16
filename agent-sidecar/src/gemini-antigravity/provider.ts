/**
 * Gemini (Google) ApiProvider — runs inference against the Antigravity / Gemini
 * Code Assist `v1internal:streamGenerateContent` endpoint using the signed-in
 * account's OAuth token + discovered projectId.
 *
 * The pi `Context` → Gemini `contents` conversion and the streamed-chunk → pi
 * event mapping are PORTED from the vendored pi-ai google provider
 * (providers/google.js + google-shared.js + transform-messages.js) so behaviour
 * matches pi's first-party Gemini support. We only swap the transport: a raw
 * fetch to the Code Assist `v1internal` endpoint (Bearer auth + `{project, model,
 * request}` wrapper + SSE `.response` unwrap) instead of the @google/genai SDK.
 *
 * Kept as a copy in Cowork's layer (no edits to the vendored pi packages).
 */

import {
	type Api,
	type AssistantMessageEventStream,
	type Context,
	createAssistantMessageEventStream,
	type Model,
	registerApiProvider,
	type SimpleStreamOptions,
	type StreamOptions,
} from "@earendil-works/pi-ai/compat";
import { CODE_ASSIST_ENDPOINTS, PROVIDER_ID, REQUEST_HEADERS } from "./constants.js";

/** Private carriers set on each model by modifyModels (see index.ts). */
export const PROJECT_HEADER = "x-antigravity-project";
export const UPSTREAM_HEADER = "x-antigravity-upstream";

let toolCallCounter = 0;

// ── ported helpers (from pi-ai google-shared.js) ──────────────────────────

function sanitizeSurrogates(text: string): string {
	return text.replace(
		/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
		"",
	);
}

function requiresToolCallId(modelId: string): boolean {
	return modelId.startsWith("claude-") || modelId.startsWith("gpt-oss-");
}

function isThinkingPart(part: { thought?: boolean }): boolean {
	return part.thought === true;
}

function retainThoughtSignature(existing: string | undefined, incoming: unknown): string | undefined {
	if (typeof incoming === "string" && incoming.length > 0) return incoming;
	return existing;
}

const base64SignaturePattern = /^[A-Za-z0-9+/]+={0,2}$/;
function isValidThoughtSignature(sig: unknown): sig is string {
	return typeof sig === "string" && sig.length % 4 === 0 && base64SignaturePattern.test(sig);
}
function resolveThoughtSignature(sameModel: boolean, sig: unknown): string | undefined {
	return sameModel && isValidThoughtSignature(sig) ? sig : undefined;
}

function getGeminiMajorVersion(modelId: string): number | undefined {
	const m = modelId.toLowerCase().match(/^gemini(?:-live)?-(\d+)/);
	return m ? Number.parseInt(m[1], 10) : undefined;
}
function supportsMultimodalFunctionResponse(modelId: string): boolean {
	const v = getGeminiMajorVersion(modelId);
	return v !== undefined ? v >= 3 : true;
}

const JSON_SCHEMA_META = new Set([
	"$schema",
	"$id",
	"$anchor",
	"$dynamicAnchor",
	"$vocabulary",
	"$comment",
	"$defs",
	"definitions",
]);
function sanitizeForOpenApi(schema: unknown): unknown {
	if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return schema;
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(schema)) {
		if (JSON_SCHEMA_META.has(k)) continue;
		out[k] = sanitizeForOpenApi(v);
	}
	return out;
}

function mapStopReasonString(reason: string | undefined): string {
	switch (reason) {
		case "STOP":
			return "stop";
		case "MAX_TOKENS":
			return "length";
		default:
			return reason ? "error" : "stop";
	}
}

// ── ported transformMessages (from pi-ai transform-messages.js) ────────────
// Loosely typed (`any`) for the message/block shapes — we only need to walk them.

const USER_IMG_PLACEHOLDER = "(image omitted: model does not support images)";
const TOOL_IMG_PLACEHOLDER = "(tool image omitted: model does not support images)";

function replaceImages(content: any[], placeholder: string): any[] {
	const result: any[] = [];
	let prevPlaceholder = false;
	for (const block of content) {
		if (block.type === "image") {
			if (!prevPlaceholder) result.push({ type: "text", text: placeholder });
			prevPlaceholder = true;
			continue;
		}
		result.push(block);
		prevPlaceholder = block.text === placeholder;
	}
	return result;
}

function transformMessages(messages: any[], model: Model<Api>): any[] {
	const supportsImage = model.input.includes("image");
	const imageAware = supportsImage
		? messages
		: messages.map((msg) => {
				if (msg.role === "user" && Array.isArray(msg.content))
					return { ...msg, content: replaceImages(msg.content, USER_IMG_PLACEHOLDER) };
				if (msg.role === "toolResult")
					return { ...msg, content: replaceImages(msg.content, TOOL_IMG_PLACEHOLDER) };
				return msg;
			});

	const transformed = imageAware.map((msg) => {
		if (msg.role === "user" || msg.role === "toolResult") return msg;
		if (msg.role === "assistant") {
			const sameModel =
				msg.provider === model.provider && msg.api === model.api && msg.model === model.id;
			const content = msg.content.flatMap((block: any) => {
				if (block.type === "thinking") {
					if (block.redacted) return sameModel ? block : [];
					if (sameModel && block.thinkingSignature) return block;
					if (!block.thinking || block.thinking.trim() === "") return [];
					if (sameModel) return block;
					return { type: "text", text: block.thinking };
				}
				if (block.type === "text") {
					return sameModel ? block : { type: "text", text: block.text };
				}
				if (block.type === "toolCall" && !sameModel && block.thoughtSignature) {
					const { thoughtSignature, ...rest } = block;
					return rest;
				}
				return block;
			});
			return { ...msg, content };
		}
		return msg;
	});

	// Insert synthetic results for orphaned tool calls + skip errored assistant turns.
	const result: any[] = [];
	let pending: any[] = [];
	let seenIds = new Set<string>();
	const flush = () => {
		for (const tc of pending) {
			if (!seenIds.has(tc.id)) {
				result.push({
					role: "toolResult",
					toolCallId: tc.id,
					toolName: tc.name,
					content: [{ type: "text", text: "No result provided" }],
					isError: true,
					timestamp: Date.now(),
				});
			}
		}
		pending = [];
		seenIds = new Set();
	};
	for (const msg of transformed) {
		if (msg.role === "assistant") {
			flush();
			if (msg.stopReason === "error" || msg.stopReason === "aborted") continue;
			const toolCalls = msg.content.filter((b: any) => b.type === "toolCall");
			if (toolCalls.length > 0) {
				pending = toolCalls;
				seenIds = new Set();
			}
			result.push(msg);
		} else if (msg.role === "toolResult") {
			seenIds.add(msg.toolCallId);
			result.push(msg);
		} else if (msg.role === "user") {
			flush();
			result.push(msg);
		} else {
			result.push(msg);
		}
	}
	flush();
	return result;
}

// ── ported convertMessages / convertTools (from google-shared.js) ──────────

function convertMessages(model: Model<Api>, context: Context): any[] {
	const contents: any[] = [];
	const msgs = transformMessages((context as any).messages, model);
	for (const msg of msgs) {
		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				contents.push({ role: "user", parts: [{ text: sanitizeSurrogates(msg.content) }] });
			} else {
				const parts = msg.content.map((item: any) =>
					item.type === "text"
						? { text: sanitizeSurrogates(item.text) }
						: { inlineData: { mimeType: item.mimeType, data: item.data } },
				);
				if (parts.length === 0) continue;
				contents.push({ role: "user", parts });
			}
		} else if (msg.role === "assistant") {
			const parts: any[] = [];
			const sameModel = msg.provider === model.provider && msg.model === model.id;
			for (const block of msg.content) {
				if (block.type === "text") {
					if (!block.text || block.text.trim() === "") continue;
					const sig = resolveThoughtSignature(sameModel, block.textSignature);
					parts.push({ text: sanitizeSurrogates(block.text), ...(sig && { thoughtSignature: sig }) });
				} else if (block.type === "thinking") {
					if (!block.thinking || block.thinking.trim() === "") continue;
					if (sameModel) {
						const sig = resolveThoughtSignature(sameModel, block.thinkingSignature);
						parts.push({
							thought: true,
							text: sanitizeSurrogates(block.thinking),
							...(sig && { thoughtSignature: sig }),
						});
					} else {
						parts.push({ text: sanitizeSurrogates(block.thinking) });
					}
				} else if (block.type === "toolCall") {
					const sig = resolveThoughtSignature(sameModel, block.thoughtSignature);
					parts.push({
						functionCall: {
							name: block.name,
							args: block.arguments ?? {},
							...(requiresToolCallId(model.id) ? { id: block.id } : {}),
						},
						...(sig && { thoughtSignature: sig }),
					});
				}
			}
			if (parts.length === 0) continue;
			contents.push({ role: "model", parts });
		} else if (msg.role === "toolResult") {
			const textResult = msg.content
				.filter((c: any) => c.type === "text")
				.map((c: any) => c.text)
				.join("\n");
			const imageContent = model.input.includes("image")
				? msg.content.filter((c: any) => c.type === "image")
				: [];
			const hasImages = imageContent.length > 0;
			const multimodal = supportsMultimodalFunctionResponse(model.id);
			const responseValue = textResult.length > 0 ? sanitizeSurrogates(textResult) : hasImages ? "(see attached image)" : "";
			const imageParts = imageContent.map((b: any) => ({ inlineData: { mimeType: b.mimeType, data: b.data } }));
			const includeId = requiresToolCallId(model.id);
			const fnResponse = {
				functionResponse: {
					name: msg.toolName,
					response: msg.isError ? { error: responseValue } : { output: responseValue },
					...(hasImages && multimodal && { parts: imageParts }),
					...(includeId ? { id: msg.toolCallId } : {}),
				},
			};
			const last = contents[contents.length - 1];
			if (last?.role === "user" && last.parts?.some((p: any) => p.functionResponse)) {
				last.parts.push(fnResponse);
			} else {
				contents.push({ role: "user", parts: [fnResponse] });
			}
			if (hasImages && !multimodal) {
				contents.push({ role: "user", parts: [{ text: "Tool result image:" }, ...imageParts] });
			}
		}
	}
	return contents;
}

function convertTools(tools: any[] | undefined): any[] | undefined {
	if (!tools || tools.length === 0) return undefined;
	return [
		{
			functionDeclarations: tools.map((t) => ({
				name: t.name,
				description: t.description,
				parametersJsonSchema: t.parameters,
			})),
		},
	];
}

function mapToolChoice(choice: string | undefined): string | undefined {
	switch (choice) {
		case "auto":
			return "AUTO";
		case "none":
			return "NONE";
		case "any":
			return "ANY";
		default:
			return undefined;
	}
}

// ── request building + transport ──────────────────────────────────────────

function buildRequest(model: Model<Api>, context: Context, options?: StreamOptions): unknown {
	const contents = convertMessages(model, context);
	const ctx = context as any;
	const generationConfig: Record<string, unknown> = {};
	if (options?.temperature !== undefined) generationConfig.temperature = options.temperature;
	if (options?.maxTokens !== undefined) generationConfig.maxOutputTokens = options.maxTokens;

	const tools = convertTools(ctx.tools);
	const req: Record<string, unknown> = { contents };
	if (ctx.systemPrompt) req.systemInstruction = { parts: [{ text: sanitizeSurrogates(ctx.systemPrompt) }] };
	if (tools) {
		req.tools = tools;
		const mode = mapToolChoice((options as any)?.toolChoice);
		if (mode) req.toolConfig = { functionCallingConfig: { mode } };
	}
	// Ask reasoning models to surface thought summaries so pi can render a
	// "thinking" block. includeThoughts alone lets the backend pick a default
	// thinking level (works for Gemini 2.5 budget-based + 3.x level-based).
	if (model.reasoning) generationConfig.thinkingConfig = { includeThoughts: true };
	if (Object.keys(generationConfig).length > 0) req.generationConfig = generationConfig;
	return req;
}

async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<any> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buf = "";
	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		buf += decoder.decode(value, { stream: true });
		// SSE events are separated by blank lines; data lines start with "data:".
		let idx: number;
		// biome-ignore lint/suspicious/noAssignInExpressions: standard SSE buffer drain
		while ((idx = buf.indexOf("\n")) !== -1) {
			const line = buf.slice(0, idx).trim();
			buf = buf.slice(idx + 1);
			if (!line.startsWith("data:")) continue;
			const json = line.slice(5).trim();
			if (!json || json === "[DONE]") continue;
			try {
				yield JSON.parse(json);
			} catch {
				// ignore malformed chunk; later chunks may still be valid
			}
		}
	}
}

export const streamGeminiAntigravity = (
	model: Model<Api>,
	context: Context,
	options?: StreamOptions,
): AssistantMessageEventStream => {
	const stream = createAssistantMessageEventStream();
	(async () => {
		const output: any = {
			role: "assistant",
			content: [],
			api: PROVIDER_ID,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};
		try {
			const token = options?.apiKey;
			if (!token) throw new Error("Not signed in to Gemini (Google) — connect it in Settings.");
			const projectId = model.headers?.[PROJECT_HEADER];
			if (!projectId) {
				throw new Error("Missing Gemini project — sign out and sign in again to re-discover it.");
			}

			const requestBody = JSON.stringify({
				model: model.headers?.[UPSTREAM_HEADER] || model.id,
				project: projectId,
				request: buildRequest(model, context, options),
			});
			const headers: Record<string, string> = {
				...REQUEST_HEADERS,
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
				Accept: "text/event-stream",
			};

			// Endpoint cascade on auth/availability failures.
			let res: Response | undefined;
			let lastErr = "";
			for (let i = 0; i < CODE_ASSIST_ENDPOINTS.length; i++) {
				const url = `${CODE_ASSIST_ENDPOINTS[i]}/v1internal:streamGenerateContent?alt=sse`;
				const r = await fetch(url, { method: "POST", headers, body: requestBody, signal: options?.signal });
				if (r.ok) {
					res = r;
					break;
				}
				lastErr = `HTTP ${r.status}: ${(await r.text().catch(() => "")).slice(0, 500)}`;
				if (r.status !== 401 && r.status !== 403 && r.status !== 404) break;
			}
			if (!res || !res.body) throw new Error(lastErr || "Gemini request failed");

			stream.push({ type: "start", partial: output });
			let currentBlock: any = null;
			const blocks = output.content;
			const blockIndex = () => blocks.length - 1;

			for await (const raw of parseSse(res.body)) {
				const chunk = raw.response ?? raw; // Code Assist wraps in `response`
				const candidate = chunk.candidates?.[0];
				if (candidate?.content?.parts) {
					for (const part of candidate.content.parts) {
						if (part.text !== undefined) {
							const thinking = isThinkingPart(part);
							if (
								!currentBlock ||
								(thinking && currentBlock.type !== "thinking") ||
								(!thinking && currentBlock.type !== "text")
							) {
								if (currentBlock) {
									stream.push(
										currentBlock.type === "text"
											? { type: "text_end", contentIndex: blockIndex(), content: currentBlock.text, partial: output }
											: { type: "thinking_end", contentIndex: blockIndex(), content: currentBlock.thinking, partial: output },
									);
								}
								if (thinking) {
									currentBlock = { type: "thinking", thinking: "", thinkingSignature: undefined };
									blocks.push(currentBlock);
									stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: output });
								} else {
									currentBlock = { type: "text", text: "" };
									blocks.push(currentBlock);
									stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
								}
							}
							if (currentBlock.type === "thinking") {
								currentBlock.thinking += part.text;
								currentBlock.thinkingSignature = retainThoughtSignature(currentBlock.thinkingSignature, part.thoughtSignature);
								stream.push({ type: "thinking_delta", contentIndex: blockIndex(), delta: part.text, partial: output });
							} else {
								currentBlock.text += part.text;
								currentBlock.textSignature = retainThoughtSignature(currentBlock.textSignature, part.thoughtSignature);
								stream.push({ type: "text_delta", contentIndex: blockIndex(), delta: part.text, partial: output });
							}
						}
						if (part.functionCall) {
							if (currentBlock) {
								stream.push(
									currentBlock.type === "text"
										? { type: "text_end", contentIndex: blockIndex(), content: currentBlock.text, partial: output }
										: { type: "thinking_end", contentIndex: blockIndex(), content: currentBlock.thinking, partial: output },
								);
								currentBlock = null;
							}
							const providedId = part.functionCall.id;
							const dup = !providedId || blocks.some((b: any) => b.type === "toolCall" && b.id === providedId);
							const toolCallId = dup
								? `${part.functionCall.name}_${Date.now()}_${++toolCallCounter}`
								: providedId;
							const toolCall = {
								type: "toolCall",
								id: toolCallId,
								name: part.functionCall.name || "",
								arguments: part.functionCall.args ?? {},
								...(part.thoughtSignature && { thoughtSignature: part.thoughtSignature }),
							};
							blocks.push(toolCall);
							stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
							stream.push({ type: "toolcall_delta", contentIndex: blockIndex(), delta: JSON.stringify(toolCall.arguments), partial: output });
							stream.push({ type: "toolcall_end", contentIndex: blockIndex(), toolCall, partial: output });
						}
					}
				}
				if (candidate?.finishReason) {
					output.stopReason = mapStopReasonString(candidate.finishReason);
					if (blocks.some((b: any) => b.type === "toolCall")) output.stopReason = "toolUse";
				}
				if (chunk.usageMetadata) {
					const u = chunk.usageMetadata;
					output.usage = {
						input: (u.promptTokenCount || 0) - (u.cachedContentTokenCount || 0),
						output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0),
						cacheRead: u.cachedContentTokenCount || 0,
						cacheWrite: 0,
						totalTokens: u.totalTokenCount || 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					};
				}
			}
			if (currentBlock) {
				stream.push(
					currentBlock.type === "text"
						? { type: "text_end", contentIndex: blockIndex(), content: currentBlock.text, partial: output }
						: { type: "thinking_end", contentIndex: blockIndex(), content: currentBlock.thinking, partial: output },
				);
			}
			if (options?.signal?.aborted) throw new Error("Request was aborted");
			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();
	return stream;
};

/** Non-reasoning entry point — same path (reasoning is driven by the model). */
export const streamSimpleGeminiAntigravity = (
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => streamGeminiAntigravity(model, context, options as StreamOptions);

/** Register the api provider so requests for PROVIDER_ID models route here. */
export function registerGeminiApiProvider(): void {
	registerApiProvider({
		api: PROVIDER_ID as Api,
		stream: streamGeminiAntigravity,
		streamSimple: streamSimpleGeminiAntigravity,
	});
}
