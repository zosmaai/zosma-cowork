/**
 * Zosma Cowork — Google Workspace tools (Drive / Docs / Sheets / Slides).
 *
 * Vendored from the MIT-licensed `pi-google-workspace` (see LICENSE.upstream),
 * with its self-contained OAuth + `/gws-setup` loopback flow removed and token
 * access routed through Cowork's shared broker-aware module
 * (../google-auth/oauth-access). Cowork brokers ONE Google consent and writes
 * ONE secret-free oauth.json; this extension reads + refreshes that file exactly
 * like google_calendar, so Drive/Docs/Sheets/Slides work on a brokered connect
 * with NO client secret on disk.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	GOOGLE_OAUTH_CONFIG_PATH as CONFIG_PATH,
	getValidConfig,
	readConfig,
	refreshToken,
} from "../google-auth/oauth-access.js";

type JsonMap = Record<string, unknown>;
type DocExportFormat = "pdf" | "docx" | "txt" | "md" | "rtf" | "odt" | "html_zip";

const DOC_EXPORT_MAP: Record<Exclude<DocExportFormat, "md">, { mime: string; ext: string }> = {
	pdf: { mime: "application/pdf", ext: "pdf" },
	docx: {
		mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		ext: "docx",
	},
	txt: { mime: "text/plain", ext: "txt" },
	rtf: { mime: "application/rtf", ext: "rtf" },
	odt: { mime: "application/vnd.oasis.opendocument.text", ext: "odt" },
	html_zip: { mime: "application/zip", ext: "zip" },
};

function parseJson(text: string): JsonMap {
	try {
		return JSON.parse(text) as JsonMap;
	} catch {
		return {};
	}
}

function resolveGoogleApiUrl(path: string) {
	if (path.startsWith("/v1/documents")) return new URL(`https://docs.googleapis.com${path}`);
	if (path.startsWith("/v1/presentations")) return new URL(`https://slides.googleapis.com${path}`);
	if (path.startsWith("/v4/spreadsheets")) return new URL(`https://sheets.googleapis.com${path}`);
	return new URL(`https://www.googleapis.com${path}`);
}

async function googleRequest(
	path: string,
	options: {
		method?: "GET" | "POST" | "PUT" | "PATCH";
		query?: Record<string, string | number | boolean | undefined>;
		body?: JsonMap;
		signal?: AbortSignal;
	} = {},
) {
	const config = await getValidConfig(options.signal);

	const url = resolveGoogleApiUrl(path);
	for (const [key, value] of Object.entries(options.query ?? {})) {
		if (value === undefined) continue;
		url.searchParams.set(key, String(value));
	}

	const makeRequest = async (accessToken: string) => {
		const res = await fetch(url, {
			method: options.method ?? "GET",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json",
			},
			body: options.body ? JSON.stringify(options.body) : undefined,
			signal: options.signal,
		});

		const text = await res.text();
		const data = parseJson(text);
		return { res, data };
	};

	let { res, data } = await makeRequest(config.tokens.access_token);

	if (res.status === 401 && config.tokens.refresh_token) {
		const refreshed = await refreshToken(config, options.signal);
		({ res, data } = await makeRequest(refreshed.tokens.access_token));
	}

	if (!res.ok) {
		const message =
			typeof (data.error as JsonMap | undefined)?.message === "string"
				? ((data.error as JsonMap).message as string)
				: `Google API error (${res.status})`;
		throw new Error(message);
	}

	return data;
}

async function googleBinaryRequest(
	path: string,
	options: {
		query?: Record<string, string | number | boolean | undefined>;
		signal?: AbortSignal;
	} = {},
) {
	const config = await getValidConfig(options.signal);

	const url = resolveGoogleApiUrl(path);
	for (const [key, value] of Object.entries(options.query ?? {})) {
		if (value === undefined) continue;
		url.searchParams.set(key, String(value));
	}

	const makeRequest = async (accessToken: string) =>
		fetch(url, {
			method: "GET",
			headers: { Authorization: `Bearer ${accessToken}` },
			signal: options.signal,
		});

	let res = await makeRequest(config.tokens.access_token);

	if (res.status === 401 && config.tokens.refresh_token) {
		const refreshed = await refreshToken(config, options.signal);
		res = await makeRequest(refreshed.tokens.access_token);
	}

	if (!res.ok) {
		const text = await res.text();
		const data = parseJson(text);
		const message =
			typeof (data.error as JsonMap | undefined)?.message === "string"
				? ((data.error as JsonMap).message as string)
				: `Google API error (${res.status})`;
		throw new Error(message);
	}

	const bytes = new Uint8Array(await res.arrayBuffer());
	return {
		bytes,
		contentType: res.headers.get("content-type") ?? "application/octet-stream",
	};
}

async function googleDriveMultipartUpload(
	metadata: JsonMap,
	fileBytes: Uint8Array,
	mimeType: string,
	signal?: AbortSignal,
) {
	const config = await getValidConfig(signal);
	const boundary = `pi-boundary-${randomBytes(8).toString("hex")}`;

	const preamble = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
	const middle = `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
	const closing = `\r\n--${boundary}--`;
	const body = Buffer.concat([
		Buffer.from(preamble + middle, "utf-8"),
		Buffer.from(fileBytes),
		Buffer.from(closing, "utf-8"),
	]);

	const doUpload = async (accessToken: string) => {
		const url = new URL("https://www.googleapis.com/upload/drive/v3/files");
		url.searchParams.set("uploadType", "multipart");
		url.searchParams.set("fields", "id,name,mimeType,webViewLink,parents");

		const res = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": `multipart/related; boundary=${boundary}`,
			},
			body,
			signal,
		});

		const text = await res.text();
		return { res, data: parseJson(text) };
	};

	let { res, data } = await doUpload(config.tokens.access_token);

	if (res.status === 401 && config.tokens.refresh_token) {
		const refreshed = await refreshToken(config, signal);
		({ res, data } = await doUpload(refreshed.tokens.access_token));
	}

	if (!res.ok) {
		const message =
			typeof (data.error as JsonMap | undefined)?.message === "string"
				? ((data.error as JsonMap).message as string)
				: `Google API error (${res.status})`;
		throw new Error(message);
	}

	return data;
}

function safeFilename(input: string) {
	return (
		input
			.replace(/[\\/:*?"<>|]/g, "_")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 120) || "document"
	);
}

function normalizeOutputPath(cwd: string, outputPath: string | undefined, fallbackName: string) {
	const candidate = outputPath?.trim() ? outputPath.trim() : fallbackName;
	return resolve(cwd, candidate.replace(/^@/, ""));
}

function normalizeText(text: string) {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: Google Docs emits U+000B (vertical tab) as a soft line break; normalizing it to \n is intentional.
	return text.replace(/\r\n/g, "\n").replace(/\u000b/g, "\n");
}

function escapeMdInline(text: string) {
	return text.replace(/([\\`*_{}\[\]()#+\-.!|>~])/g, "\\$1");
}

function escapeMdTableCell(text: string) {
	return text.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function applyInlineStyle(text: string, style: JsonMap | undefined): string {
	if (!text) return "";
	const trimmed = text.trim();
	const left = text.slice(0, text.indexOf(trimmed));
	const right = text.slice(text.indexOf(trimmed) + trimmed.length);
	let core = escapeMdInline(trimmed || text);

	if (!trimmed) return escapeMdInline(text);

	const link = style?.link as JsonMap | undefined;
	const url = typeof link?.url === "string" ? link.url : undefined;

	const bold = style?.bold === true;
	const italic = style?.italic === true;
	const strike = style?.strikethrough === true;

	if (bold) core = `**${core}**`;
	if (italic) core = `*${core}*`;
	if (strike) core = `~~${core}~~`;
	if (url) core = `[${core}](${url})`;

	return `${left}${core}${right}`;
}

function paragraphTextFromElements(elements: JsonMap[] | undefined): string {
	if (!Array.isArray(elements)) return "";

	const chunks: string[] = [];
	for (const element of elements) {
		const run = element.textRun as JsonMap | undefined;
		const content = typeof run?.content === "string" ? run.content : "";
		if (!content) continue;
		const styled = applyInlineStyle(normalizeText(content), run?.textStyle as JsonMap | undefined);
		chunks.push(styled);
	}

	return chunks.join("").replace(/\n+$/g, "").trim();
}

function isOrderedGlyph(glyphType: string | undefined) {
	if (!glyphType) return false;
	return ["DECIMAL", "ALPHA", "ROMAN"].some((token) => glyphType.includes(token));
}

function getHeadingPrefix(namedStyleType: string | undefined): string {
	if (!namedStyleType) return "";
	if (namedStyleType === "TITLE") return "#";
	if (namedStyleType === "SUBTITLE") return "##";
	const match = namedStyleType.match(/^HEADING_(\d)$/);
	if (!match) return "";
	const level = Number(match[1]);
	if (!Number.isFinite(level) || level < 1 || level > 6) return "";
	return "#".repeat(level);
}

function tableToMarkdown(table: JsonMap, lists: JsonMap | undefined) {
	const rows = table.tableRows as JsonMap[] | undefined;
	if (!Array.isArray(rows) || rows.length === 0) return "";

	const renderedRows = rows.map((row) => {
		const cells = row.tableCells as JsonMap[] | undefined;
		if (!Array.isArray(cells)) return [] as string[];

		return cells.map((cell) => {
			const content = cell.content as JsonMap[] | undefined;
			if (!Array.isArray(content)) return "";
			const chunks = content
				.map((block) => blockToMarkdown(block, lists))
				.join("\n")
				.replace(/\n{2,}/g, "\n")
				.trim();
			return escapeMdTableCell(chunks);
		});
	});

	if (renderedRows.length === 0) return "";
	const colCount = Math.max(...renderedRows.map((row) => row.length), 1);

	const normalizeRow = (row: string[]) => {
		const cells = [...row];
		while (cells.length < colCount) cells.push("");
		return `| ${cells.join(" | ")} |`;
	};

	const header = normalizeRow(renderedRows[0]);
	const divider = `| ${new Array(colCount).fill("---").join(" | ")} |`;
	const body = renderedRows.slice(1).map(normalizeRow);
	return [header, divider, ...body].join("\n");
}

function blockToMarkdown(
	block: JsonMap,
	lists: JsonMap | undefined,
	listState?: Map<string, number>,
): string {
	const paragraph = block.paragraph as JsonMap | undefined;
	if (paragraph) {
		const elements = paragraph.elements as JsonMap[] | undefined;
		const text = paragraphTextFromElements(elements);

		const style = paragraph.paragraphStyle as JsonMap | undefined;
		const namedStyleType =
			typeof style?.namedStyleType === "string" ? style.namedStyleType : undefined;
		const heading = getHeadingPrefix(namedStyleType);
		if (heading && text) return `${heading} ${text}`;

		const bullet = paragraph.bullet as JsonMap | undefined;
		if (bullet) {
			const listId = typeof bullet.listId === "string" ? bullet.listId : "default";
			const nestingLevel = typeof bullet.nestingLevel === "number" ? bullet.nestingLevel : 0;
			const listInfo = (lists?.[listId] as JsonMap | undefined)?.listProperties as
				| JsonMap
				| undefined;
			const levels = listInfo?.nestingLevels as JsonMap[] | undefined;
			const glyphType =
				typeof levels?.[nestingLevel]?.glyphType === "string"
					? (levels[nestingLevel].glyphType as string)
					: undefined;
			const ordered = isOrderedGlyph(glyphType);

			const state = listState ?? new Map<string, number>();
			const key = `${listId}:${nestingLevel}`;
			const count = (state.get(key) ?? 0) + 1;
			state.set(key, count);

			for (const existingKey of state.keys()) {
				if (!existingKey.startsWith(`${listId}:`)) continue;
				const level = Number(existingKey.split(":")[1]);
				if (Number.isFinite(level) && level > nestingLevel) state.delete(existingKey);
			}

			const indent = "  ".repeat(Math.max(0, nestingLevel));
			const marker = ordered ? `${count}.` : "-";
			return `${indent}${marker} ${text}`.trimEnd();
		}

		return text;
	}

	const table = block.table as JsonMap | undefined;
	if (table) return tableToMarkdown(table, lists);

	return "";
}

function toMarkdownFromDocument(document: JsonMap) {
	const body = (document.body as JsonMap | undefined)?.content as JsonMap[] | undefined;
	if (!Array.isArray(body) || body.length === 0) return "";

	const lists = document.lists as JsonMap | undefined;
	const listState = new Map<string, number>();
	const chunks: string[] = [];

	for (const block of body) {
		const rendered = blockToMarkdown(block, lists, listState).trim();
		if (!rendered) continue;
		chunks.push(rendered);
	}

	const markdown = chunks
		.join("\n\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return markdown ? `${markdown}\n` : "";
}

function sheetValuesToText(values: unknown[][]) {
	if (!Array.isArray(values) || values.length === 0) return "(no data)";

	return values
		.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "")).join("\t") : ""))
		.join("\n");
}

function getDocEndIndex(document: JsonMap): number {
	const body = (document.body as JsonMap | undefined)?.content as JsonMap[] | undefined;
	if (!Array.isArray(body) || body.length === 0) return 1;

	const last = body[body.length - 1];
	const endIndex = typeof last.endIndex === "number" ? last.endIndex : 1;
	return Math.max(1, endIndex);
}

function extractDocText(document: JsonMap): string {
	const body = (document.body as JsonMap | undefined)?.content as JsonMap[] | undefined;
	if (!Array.isArray(body)) return "";

	const chunks: string[] = [];

	for (const block of body) {
		const paragraph = block.paragraph as JsonMap | undefined;
		const elements = paragraph?.elements as JsonMap[] | undefined;
		if (!Array.isArray(elements)) continue;

		for (const element of elements) {
			const run = element.textRun as JsonMap | undefined;
			const content = run?.content;
			if (typeof content === "string") chunks.push(content);
		}
	}

	return chunks.join("").trim();
}

function getDocInsertIndex(document: JsonMap): number {
	const body = (document.body as JsonMap | undefined)?.content as JsonMap[] | undefined;
	if (!Array.isArray(body) || body.length === 0) return 1;

	const last = body[body.length - 1];
	const endIndex = typeof last.endIndex === "number" ? last.endIndex : 1;
	return Math.max(1, endIndex - 1);
}

function extractSlidesText(presentation: JsonMap) {
	const slides = presentation.slides as JsonMap[] | undefined;
	if (!Array.isArray(slides)) return [] as Array<{ slideId: string; index: number; text: string }>;

	return slides.map((slide, index) => {
		const pageElements = slide.pageElements as JsonMap[] | undefined;
		const chunks: string[] = [];

		if (Array.isArray(pageElements)) {
			for (const pageElement of pageElements) {
				const shape = pageElement.shape as JsonMap | undefined;
				const text = shape?.text as JsonMap | undefined;
				const elements = text?.textElements as JsonMap[] | undefined;

				if (!Array.isArray(elements)) continue;

				for (const element of elements) {
					const run = element.textRun as JsonMap | undefined;
					const content = run?.content;
					if (typeof content === "string") chunks.push(content);
				}
			}
		}

		return {
			slideId: typeof slide.objectId === "string" ? slide.objectId : `slide-${index + 1}`,
			index: index + 1,
			text: chunks.join("").trim(),
		};
	});
}

export default async function zosmaGoogleWorkspace(pi: ExtensionAPI): Promise<void> {
	pi.registerTool({
		name: "google_workspace_status",
		label: "Google Workspace Status",
		description: "Check Google Workspace OAuth configuration status.",
		promptSnippet: "Check whether Google Workspace OAuth is configured and token status.",
		parameters: Type.Object({}),
		async execute() {
			const config = await readConfig();
			if (!config) {
				return {
					content: [
						{
							type: "text",
							text: `Not connected. Open Cowork Settings → Apps → Google. (${CONFIG_PATH})`,
						},
					],
					details: {
						configured: false,
						configPath: CONFIG_PATH,
						refreshToken: false,
						expiresAt: null as number | null,
						expired: null as boolean | null,
					},
				};
			}

			const expiresAt = config.tokens.expiry_date ?? null;
			const refreshAvailable = !!config.tokens.refresh_token;
			const now = Date.now();

			return {
				content: [
					{
						type: "text",
						text: [
							"Google Workspace connection status",
							`- config: ${CONFIG_PATH}`,
							`- refresh_token: ${refreshAvailable ? "yes" : "no"}`,
							`- expires: ${expiresAt ? new Date(expiresAt).toISOString() : "unknown"}`,
							`- expired: ${expiresAt ? String(now > expiresAt) : "unknown"}`,
						].join("\n"),
					},
				],
				details: {
					configured: true,
					configPath: CONFIG_PATH,
					refreshToken: refreshAvailable,
					expiresAt,
					expired: expiresAt ? now > expiresAt : null,
				},
			};
		},
	});

	pi.registerTool({
		name: "google_drive_list",
		label: "Google Drive List",
		description: "List files in Google Drive with optional query.",
		promptSnippet: "List Google Drive files by query, mime type, and page size.",
		parameters: Type.Object({
			query: Type.Optional(Type.String({ description: "Drive query. Example: trashed = false" })),
			pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
		}),
		async execute(_toolCallId, params, signal) {
			const data = await googleRequest("/drive/v3/files", {
				query: {
					q: params.query ?? "trashed = false",
					pageSize: params.pageSize ?? 20,
					fields: "files(id,name,mimeType,modifiedTime,webViewLink),nextPageToken",
					orderBy: "modifiedTime desc",
				},
				signal,
			});

			const files = Array.isArray(data.files) ? (data.files as JsonMap[]) : [];
			const lines = files.map((file, idx) => {
				const id = typeof file.id === "string" ? file.id : "";
				const name = typeof file.name === "string" ? file.name : "(no name)";
				const mime = typeof file.mimeType === "string" ? file.mimeType : "unknown";
				const modified = typeof file.modifiedTime === "string" ? file.modifiedTime : "";
				return `${idx + 1}. ${name}\n   - id: ${id}\n   - mime: ${mime}\n   - modified: ${modified}`;
			});

			return {
				content: [{ type: "text", text: lines.length > 0 ? lines.join("\n") : "No files found." }],
				details: { files, count: files.length, nextPageToken: data.nextPageToken ?? null },
			};
		},
	});

	pi.registerTool({
		name: "google_drive_download",
		label: "Google Drive Download",
		description: "Download a non-Google file from Drive to local path.",
		promptSnippet: "Download Drive binary files to local filesystem.",
		parameters: Type.Object({
			fileId: Type.String({ description: "Drive file ID" }),
			outputPath: Type.Optional(Type.String({ description: "Optional local output path" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const metadata = await googleRequest(`/drive/v3/files/${encodeURIComponent(params.fileId)}`, {
				query: { fields: "id,name,mimeType" },
				signal,
			});

			const name = typeof metadata.name === "string" ? metadata.name : params.fileId;
			const mimeType =
				typeof metadata.mimeType === "string" ? metadata.mimeType : "application/octet-stream";
			if (mimeType.startsWith("application/vnd.google-apps")) {
				throw new Error(
					"This is a Google-native file type. Use a dedicated export tool (for example google_docs_download).",
				);
			}

			const binary = await googleBinaryRequest(
				`/drive/v3/files/${encodeURIComponent(params.fileId)}`,
				{
					query: { alt: "media" },
					signal,
				},
			);

			const outputFile = normalizeOutputPath(ctx.cwd, params.outputPath, safeFilename(name));
			await mkdir(dirname(outputFile), { recursive: true });
			await writeFile(outputFile, binary.bytes);

			return {
				content: [
					{ type: "text", text: `Drive download complete\n- name: ${name}\n- path: ${outputFile}` },
				],
				details: {
					fileId: params.fileId,
					name,
					mimeType,
					outputPath: outputFile,
					bytesWritten: binary.bytes.byteLength,
				},
			};
		},
	});

	pi.registerTool({
		name: "google_drive_upload",
		label: "Google Drive Upload",
		description: "Upload a local file to Google Drive.",
		promptSnippet: "Upload local file into Google Drive and return file id.",
		parameters: Type.Object({
			localPath: Type.String({ description: "Local path to upload" }),
			name: Type.Optional(Type.String({ description: "Optional file name in Drive" })),
			parentId: Type.Optional(Type.String({ description: "Optional destination folder id" })),
			mimeType: Type.Optional(Type.String({ description: "Optional mime type" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const localPath = resolve(ctx.cwd, params.localPath.replace(/^@/, ""));
			const bytes = await readFile(localPath);
			const driveName = params.name?.trim() || basename(localPath);
			const mimeType = params.mimeType?.trim() || "application/octet-stream";

			const metadata: JsonMap = { name: driveName };
			if (params.parentId) metadata.parents = [params.parentId];

			const uploaded = await googleDriveMultipartUpload(
				metadata,
				new Uint8Array(bytes),
				mimeType,
				signal,
			);
			const fileId = typeof uploaded.id === "string" ? uploaded.id : "";
			const webViewLink = typeof uploaded.webViewLink === "string" ? uploaded.webViewLink : "";

			return {
				content: [
					{
						type: "text",
						text: `Drive upload complete\n- id: ${fileId}\n- name: ${driveName}${webViewLink ? `\n- url: ${webViewLink}` : ""}`,
					},
				],
				details: { fileId, name: driveName, webViewLink, localPath, mimeType },
			};
		},
	});

	pi.registerTool({
		name: "google_drive_create_folder",
		label: "Google Drive Create Folder",
		description: "Create a folder in Google Drive.",
		promptSnippet: "Create Drive folder and return folder id.",
		parameters: Type.Object({
			name: Type.String({ description: "Folder name" }),
			parentId: Type.Optional(Type.String({ description: "Optional parent folder id" })),
		}),
		async execute(_toolCallId, params, signal) {
			const body: JsonMap = {
				name: params.name,
				mimeType: "application/vnd.google-apps.folder",
			};
			if (params.parentId) body.parents = [params.parentId];

			const created = await googleRequest("/drive/v3/files", {
				method: "POST",
				query: { fields: "id,name,webViewLink,parents" },
				body,
				signal,
			});

			const folderId = typeof created.id === "string" ? created.id : "";
			const webViewLink = typeof created.webViewLink === "string" ? created.webViewLink : "";

			return {
				content: [
					{
						type: "text",
						text: `Folder created\n- name: ${params.name}\n- id: ${folderId}${webViewLink ? `\n- url: ${webViewLink}` : ""}`,
					},
				],
				details: { folderId, name: params.name, webViewLink },
			};
		},
	});

	pi.registerTool({
		name: "google_sheets_create",
		label: "Google Sheets Create",
		description: "Create a spreadsheet and optionally write a header row.",
		promptSnippet: "Create spreadsheet and return spreadsheetId.",
		parameters: Type.Object({
			title: Type.String({ description: "Spreadsheet title" }),
			sheetTitle: Type.Optional(Type.String({ description: "Optional first sheet title" })),
			headerRow: Type.Optional(Type.Array(Type.String({ description: "Header cell" }))),
		}),
		async execute(_toolCallId, params, signal) {
			const payload: JsonMap = {
				properties: { title: params.title },
			};
			if (params.sheetTitle) payload.sheets = [{ properties: { title: params.sheetTitle } }];

			const created = await googleRequest("/v4/spreadsheets", {
				method: "POST",
				body: payload,
				signal,
			});

			const spreadsheetId = typeof created.spreadsheetId === "string" ? created.spreadsheetId : "";
			const spreadsheetUrl =
				typeof created.spreadsheetUrl === "string" ? created.spreadsheetUrl : "";
			if (!spreadsheetId) throw new Error("spreadsheetId was not returned.");

			if (params.headerRow && params.headerRow.length > 0) {
				const firstSheet = Array.isArray(created.sheets)
					? ((created.sheets[0] as JsonMap | undefined)?.properties as JsonMap | undefined)
					: undefined;
				const title =
					typeof firstSheet?.title === "string" ? firstSheet.title : params.sheetTitle || "Sheet1";

				await googleRequest(
					`/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${title}!A1`)}`,
					{
						method: "PUT",
						query: { valueInputOption: "USER_ENTERED" },
						body: { range: `${title}!A1`, majorDimension: "ROWS", values: [params.headerRow] },
						signal,
					},
				);
			}

			return {
				content: [
					{
						type: "text",
						text: `Spreadsheet created\n- id: ${spreadsheetId}${spreadsheetUrl ? `\n- url: ${spreadsheetUrl}` : ""}`,
					},
				],
				details: { spreadsheetId, spreadsheetUrl, title: params.title },
			};
		},
	});

	pi.registerTool({
		name: "google_sheets_read",
		label: "Google Sheets Read",
		description: "Read values from a Google Sheets range.",
		promptSnippet: "Read spreadsheet cells by spreadsheetId and range.",
		parameters: Type.Object({
			spreadsheetId: Type.String({ description: "Spreadsheet ID" }),
			range: Type.Optional(Type.String({ description: "A1 range (e.g. Sheet1!A1:D20)" })),
			valueRenderOption: Type.Optional(
				Type.String({ description: "FORMATTED_VALUE | UNFORMATTED_VALUE | FORMULA" }),
			),
		}),
		async execute(_toolCallId, params, signal) {
			const range = params.range?.trim() || "Sheet1!A1:Z200";
			const data = await googleRequest(
				`/v4/spreadsheets/${encodeURIComponent(params.spreadsheetId)}/values/${encodeURIComponent(range)}`,
				{
					query: {
						valueRenderOption: params.valueRenderOption ?? "FORMATTED_VALUE",
						majorDimension: "ROWS",
					},
					signal,
				},
			);

			const values = Array.isArray(data.values) ? (data.values as unknown[][]) : [];
			return {
				content: [{ type: "text", text: sheetValuesToText(values) }],
				details: { spreadsheetId: params.spreadsheetId, range, rowCount: values.length, values },
			};
		},
	});

	pi.registerTool({
		name: "google_sheets_update_values",
		label: "Google Sheets Update Values",
		description: "Update a range in Google Sheets.",
		promptSnippet: "Write 2D values array to a spreadsheet range.",
		parameters: Type.Object({
			spreadsheetId: Type.String({ description: "Spreadsheet ID" }),
			range: Type.String({ description: "A1 range (e.g. Sheet1!A2:C2)" }),
			values: Type.Array(Type.Array(Type.Any())),
			valueInputOption: Type.Optional(Type.String({ description: "RAW | USER_ENTERED" })),
		}),
		async execute(_toolCallId, params, signal) {
			const updated = await googleRequest(
				`/v4/spreadsheets/${encodeURIComponent(params.spreadsheetId)}/values/${encodeURIComponent(params.range)}`,
				{
					method: "PUT",
					query: { valueInputOption: params.valueInputOption ?? "USER_ENTERED" },
					body: {
						range: params.range,
						majorDimension: "ROWS",
						values: params.values,
					},
					signal,
				},
			);

			const updatedRange =
				typeof updated.updatedRange === "string" ? updated.updatedRange : params.range;
			const updatedRows = typeof updated.updatedRows === "number" ? updated.updatedRows : 0;

			return {
				content: [
					{
						type: "text",
						text: `Sheet update complete\n- range: ${updatedRange}\n- rows: ${updatedRows}`,
					},
				],
				details: { spreadsheetId: params.spreadsheetId, updatedRange, updatedRows },
			};
		},
	});

	pi.registerTool({
		name: "google_docs_read",
		label: "Google Docs Read",
		description: "Read text content from a Google Docs document.",
		promptSnippet: "Read a Google Docs document by documentId and return plain text.",
		parameters: Type.Object({
			documentId: Type.String({ description: "Google Docs document ID" }),
		}),
		async execute(_toolCallId, params, signal) {
			const document = await googleRequest(
				`/v1/documents/${encodeURIComponent(params.documentId)}`,
				{ signal },
			);
			const title = typeof document.title === "string" ? document.title : params.documentId;
			const text = extractDocText(document);

			return {
				content: [{ type: "text", text: `# ${title}\n\n${text || "(no body text)"}` }],
				details: { title, documentId: params.documentId, textLength: text.length },
			};
		},
	});

	pi.registerTool({
		name: "google_docs_create",
		label: "Google Docs Create",
		description: "Create a new Google Docs document and optionally insert initial text.",
		promptSnippet: "Create a Google Docs document and return its documentId.",
		parameters: Type.Object({
			title: Type.String({ description: "Document title" }),
			initialText: Type.Optional(Type.String({ description: "Initial text content" })),
		}),
		async execute(_toolCallId, params, signal) {
			const created = await googleRequest("/v1/documents", {
				method: "POST",
				body: { title: params.title },
				signal,
			});

			const documentId = typeof created.documentId === "string" ? created.documentId : "";
			if (!documentId) throw new Error("documentId was not returned.");

			if (params.initialText && params.initialText.length > 0) {
				await googleRequest(`/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`, {
					method: "POST",
					body: {
						requests: [
							{
								insertText: {
									location: { index: 1 },
									text: params.initialText,
								},
							},
						],
					},
					signal,
				});
			}

			return {
				content: [
					{ type: "text", text: `Document created: ${params.title}\n- documentId: ${documentId}` },
				],
				details: { documentId, title: params.title },
			};
		},
	});

	pi.registerTool({
		name: "google_docs_replace_all_text",
		label: "Google Docs Replace All Text",
		description: "Replace entire body text of a Google Docs document.",
		promptSnippet: "Overwrite Google Docs body text with new content.",
		parameters: Type.Object({
			documentId: Type.String({ description: "Google Docs document ID" }),
			text: Type.String({ description: "New full body text" }),
		}),
		async execute(_toolCallId, params, signal) {
			const document = await googleRequest(
				`/v1/documents/${encodeURIComponent(params.documentId)}`,
				{ signal },
			);
			const endIndex = getDocEndIndex(document);

			const requests: JsonMap[] = [];
			if (endIndex > 1) {
				requests.push({
					deleteContentRange: {
						range: { startIndex: 1, endIndex: endIndex - 1 },
					},
				});
			}
			if (params.text.length > 0) {
				requests.push({
					insertText: {
						location: { index: 1 },
						text: params.text,
					},
				});
			}

			await googleRequest(`/v1/documents/${encodeURIComponent(params.documentId)}:batchUpdate`, {
				method: "POST",
				body: { requests },
				signal,
			});

			return {
				content: [
					{ type: "text", text: `Replaced full document body. (documentId=${params.documentId})` },
				],
				details: { documentId: params.documentId, replaced: true, endIndex },
			};
		},
	});

	pi.registerTool({
		name: "google_docs_append_text",
		label: "Google Docs Append Text",
		description: "Append text to the end of a Google Docs document.",
		promptSnippet: "Append text to a Google Docs document by documentId.",
		parameters: Type.Object({
			documentId: Type.String({ description: "Google Docs document ID" }),
			text: Type.String({ description: "Text to append" }),
		}),
		async execute(_toolCallId, params, signal) {
			const document = await googleRequest(
				`/v1/documents/${encodeURIComponent(params.documentId)}`,
				{ signal },
			);
			const index = getDocInsertIndex(document);

			const data = await googleRequest(
				`/v1/documents/${encodeURIComponent(params.documentId)}:batchUpdate`,
				{
					method: "POST",
					body: {
						requests: [
							{
								insertText: {
									location: { index },
									text: params.text,
								},
							},
						],
					},
					signal,
				},
			);

			return {
				content: [{ type: "text", text: `Appended text to document end. (index=${index})` }],
				details: {
					documentId: params.documentId,
					index,
					replyCount: Array.isArray(data.replies) ? data.replies.length : 0,
				},
			};
		},
	});

	pi.registerTool({
		name: "google_docs_download",
		label: "Google Docs Download",
		description:
			"Download a Google Docs document to local file as pdf/docx/md/txt/rtf/odt/html_zip.",
		promptSnippet: "Export Google Docs to local file in requested format.",
		parameters: Type.Object({
			documentId: Type.String({ description: "Google Docs document ID" }),
			format: Type.String({ description: "pdf | docx | md | txt | rtf | odt | html_zip" }),
			outputPath: Type.Optional(Type.String({ description: "Optional local output path" })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const format = params.format as DocExportFormat;
			const allowedFormats: DocExportFormat[] = [
				"pdf",
				"docx",
				"md",
				"txt",
				"rtf",
				"odt",
				"html_zip",
			];
			if (!allowedFormats.includes(format)) {
				throw new Error(`Unsupported format: ${params.format}`);
			}

			const document = await googleRequest(
				`/v1/documents/${encodeURIComponent(params.documentId)}`,
				{ signal },
			);
			const title = typeof document.title === "string" ? document.title : params.documentId;
			const base = safeFilename(title);

			let outputFile = "";
			let bytesWritten = 0;

			if (format === "md") {
				const markdown = toMarkdownFromDocument(document);
				outputFile = normalizeOutputPath(ctx.cwd, params.outputPath, `${base}.md`);
				await mkdir(dirname(outputFile), { recursive: true });
				await writeFile(outputFile, markdown, "utf-8");
				bytesWritten = Buffer.byteLength(markdown, "utf-8");
			} else {
				const spec = DOC_EXPORT_MAP[format];
				const exported = await googleBinaryRequest(
					`/drive/v3/files/${encodeURIComponent(params.documentId)}/export`,
					{
						query: { mimeType: spec.mime },
						signal,
					},
				);

				outputFile = normalizeOutputPath(ctx.cwd, params.outputPath, `${base}.${spec.ext}`);
				await mkdir(dirname(outputFile), { recursive: true });
				await writeFile(outputFile, exported.bytes);
				bytesWritten = exported.bytes.byteLength;
			}

			return {
				content: [
					{
						type: "text",
						text: [
							"Document download complete",
							`- title: ${title}`,
							`- format: ${format}`,
							`- path: ${outputFile}`,
							`- bytes: ${bytesWritten}`,
						].join("\n"),
					},
				],
				details: {
					documentId: params.documentId,
					title,
					format,
					outputPath: outputFile,
					bytesWritten,
				},
			};
		},
	});

	pi.registerTool({
		name: "google_slides_read",
		label: "Google Slides Read",
		description: "Read text content from all slides in a presentation.",
		promptSnippet: "Read all text from a Google Slides presentation by presentationId.",
		parameters: Type.Object({
			presentationId: Type.String({ description: "Google Slides presentation ID" }),
		}),
		async execute(_toolCallId, params, signal) {
			const presentation = await googleRequest(
				`/v1/presentations/${encodeURIComponent(params.presentationId)}`,
				{ signal },
			);
			const title =
				typeof presentation.title === "string" ? presentation.title : params.presentationId;
			const slides = extractSlidesText(presentation);

			const rendered = slides
				.map((slide) => `## Slide ${slide.index} (${slide.slideId})\n${slide.text || "(no text)"}`)
				.join("\n\n");

			return {
				content: [{ type: "text", text: `# ${title}\n\n${rendered || "No slide body text."}` }],
				details: { presentationId: params.presentationId, title, slideCount: slides.length },
			};
		},
	});

	pi.registerTool({
		name: "google_slides_replace_text",
		label: "Google Slides Replace Text",
		description: "Replace text across all slides in a presentation.",
		promptSnippet: "Find and replace text in Google Slides presentation.",
		parameters: Type.Object({
			presentationId: Type.String({ description: "Google Slides presentation ID" }),
			findText: Type.String({ description: "Text to find" }),
			replaceText: Type.String({ description: "Replacement text" }),
			matchCase: Type.Optional(Type.Boolean({ description: "Case-sensitive matching" })),
		}),
		async execute(_toolCallId, params, signal) {
			const data = await googleRequest(
				`/v1/presentations/${encodeURIComponent(params.presentationId)}:batchUpdate`,
				{
					method: "POST",
					body: {
						requests: [
							{
								replaceAllText: {
									containsText: {
										text: params.findText,
										matchCase: params.matchCase ?? false,
									},
									replaceText: params.replaceText,
								},
							},
						],
					},
					signal,
				},
			);

			const firstReply = Array.isArray(data.replies)
				? (data.replies[0] as JsonMap | undefined)
				: undefined;
			const replaceDetails = (firstReply?.replaceAllText as JsonMap | undefined) ?? {};
			const occurrencesChanged =
				typeof replaceDetails.occurrencesChanged === "number"
					? replaceDetails.occurrencesChanged
					: 0;

			return {
				content: [
					{ type: "text", text: `Replace complete: ${occurrencesChanged} item(s) changed` },
				],
				details: { presentationId: params.presentationId, occurrencesChanged },
			};
		},
	});
}
