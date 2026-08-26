import { isAbsolute, normalize, resolve } from "node:path";

export interface SessionOutputPath {
	path: string;
	displayPath: string;
}

function stringPath(args: Record<string, unknown>): string | undefined {
	const value = typeof args.path === "string" ? args.path : args.file_path;
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function outputPathForToolCall(
	name: string,
	args: Record<string, unknown>,
	cwd: string,
): SessionOutputPath | undefined {
	if (name !== "write" && name !== "edit") return undefined;
	const displayPath = stringPath(args);
	if (!displayPath) return undefined;
	return {
		path: normalize(isAbsolute(displayPath) ? displayPath : resolve(cwd, displayPath)),
		displayPath,
	};
}

export function normalizeSessionToolEvent(event: unknown, cwd: string): unknown {
	if (!event || typeof event !== "object") return event;
	const source = event as Record<string, unknown>;
	if (source.type !== "message_update") return event;
	const assistant = source.assistantMessageEvent;
	if (!assistant || typeof assistant !== "object") return event;
	const update = assistant as Record<string, unknown>;
	if (update.type !== "toolcall_end") return event;
	const rawTool = update.toolCall;
	if (!rawTool || typeof rawTool !== "object") return event;
	const tool = rawTool as Record<string, unknown>;
	const name = typeof tool.name === "string" ? tool.name : "";
	const args =
		tool.arguments && typeof tool.arguments === "object"
			? (tool.arguments as Record<string, unknown>)
			: {};
	const outputPath = outputPathForToolCall(name, args, cwd);
	if (!outputPath) return event;
	return {
		...source,
		assistantMessageEvent: {
			...update,
			toolCall: { ...tool, outputPath },
		},
	};
}