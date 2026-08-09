import { describe, expect, it } from "vitest";
import type { ChatMessage, ToolCallInfo } from "@/types";
import {
	deriveWorkProjection,
	extractMarkdownLinks,
	normalizeFileIdentity,
	normalizeSourceUrl,
} from "./work-projections";

describe("normalizeSourceUrl", () => {
	it("normalizes host, default port, fragment, and a non-root trailing slash", () => {
		expect(normalizeSourceUrl("HTTPS://Example.COM:443/Docs/?q=One#part")).toBe(
			"https://example.com/Docs?q=One",
		);
	});

	it("keeps a root slash", () => {
		expect(normalizeSourceUrl("https://example.com/")).toBe("https://example.com/");
	});

	it.each(["javascript:alert(1)", "data:text/html,x", "file:///tmp/a", "not a url"])(
		"rejects %s",
		(value) => expect(normalizeSourceUrl(value)).toBeNull(),
	);
});

describe("normalizeFileIdentity", () => {
	it("resolves a relative path against cwd", () => {
		expect(normalizeFileIdentity("reports/../final.md", "/work/acme")).toBe(
			"/work/acme/final.md",
		);
	});

	it("normalizes Windows separators and drive letter without lowercasing path case", () => {
		expect(normalizeFileIdentity("c:\\Work\\Reports\\Final.md\\", "C:/Work")).toBe(
			"C:/Work/Reports/Final.md",
		);
	});

	it("preserves a UNC prefix and share root", () => {
		expect(normalizeFileIdentity("\\\\server\\share\\", "C:/Work")).toBe("//server/share");
	});
});

describe("extractMarkdownLinks", () => {
	it("extracts inline, reference, and GFM autolinks", () => {
		const markdown =
			"[Docs](https://example.com/docs) [Guide][g]\n\n[g]: https://example.com/guide\n<https://example.com/angle>";
		expect(extractMarkdownLinks(markdown).map((link) => link.url)).toEqual([
			"https://example.com/docs",
			"https://example.com/guide",
			"https://example.com/angle",
		]);
	});

	it("does not treat URLs inside inline or fenced code as links", () => {
		const markdown = "`https://inline.invalid`\n```txt\n[bad](https://fenced.invalid)\n```";
		expect(extractMarkdownLinks(markdown)).toEqual([]);
	});

	it("drops unsafe link schemes", () => {
		expect(extractMarkdownLinks("[bad](javascript:alert(1))")).toEqual([]);
	});
});

const tc = (overrides: Partial<ToolCallInfo>): ToolCallInfo => ({
	id: "t1",
	name: "write",
	args: { path: "out.md" },
	status: "completed",
	result: "Written to out.md",
	...overrides,
});

const message = (overrides: Partial<ChatMessage>): ChatMessage => ({
	id: "m1",
	role: "assistant",
	content: "",
	timestamp: 1,
	...overrides,
});

describe("deriveWorkProjection", () => {
	it("derives only successful completed write/edit outputs", () => {
		const messages = [
			message({
				toolCalls: [
					tc({ id: "ok" }),
					tc({ id: "running", status: "running" }),
					tc({ id: "error", status: "error" }),
					tc({ id: "read", name: "read" }),
				],
			}),
		];
		expect(deriveWorkProjection(messages, "/work/acme").outputs.map((o) => o.toolCallId)).toEqual(["ok"]);
	});

	it("deduplicates output paths with first position and newest display metadata", () => {
		const messages = [
			message({
				id: "m1",
				toolCalls: [
					tc({ id: "w1", outputPath: { path: "/work/acme/a.md", displayPath: "a.md" } }),
				],
			}),
			message({
				id: "m2",
				timestamp: 2,
				toolCalls: [
					tc({
						id: "w2",
						name: "edit",
						outputPath: { path: "/work/acme/a.md", displayPath: "./a.md" },
					}),
				],
			}),
		];
		const outputs = deriveWorkProjection(messages, "/work/acme").outputs;
		expect(outputs).toHaveLength(1);
		expect(outputs[0]).toMatchObject({ toolCallId: "w2", displayValue: "./a.md" });
	});

	it("derives URL sources from assistant Markdown but not user prose", () => {
		const projection = deriveWorkProjection(
			[
				message({ role: "user", content: "[ignore](https://user.example)" }),
				message({ id: "a", content: "Read [the report](https://EXAMPLE.com/report/#x)." }),
			],
			"/work",
		);
		expect(projection.sources).toEqual([
			expect.objectContaining({
				kind: "url",
				identity: "https://example.com/report",
				title: "the report",
			}),
		]);
	});

	it("reads anchored URL records only from allowlisted browse/search tools", () => {
		const allowed = tc({
			id: "s1",
			name: "web_search_exa",
			result: "Title: Example\nURL: https://example.com/a\nText: body",
		});
		const denied = tc({ id: "b1", name: "bash", result: "URL: https://shell.invalid" });
		const sources = deriveWorkProjection([message({ toolCalls: [allowed, denied] })], "/work").sources;
		expect(sources.map((s) => s.identity)).toEqual(["https://example.com/a"]);
	});

	it("derives file sources from structured attachments and the existing File marker", () => {
		const sources = deriveWorkProjection(
			[
				message({
					role: "user",
					attachments: [
						{ path: "/refs/a.pdf", name: "a.pdf", size: 1, mimeType: "application/pdf" },
					],
					content: "[File: /refs/b.txt] b.txt 2 text/plain",
				}),
			],
			"/work",
		).sources;
		expect(sources.map((s) => [s.kind, s.displayValue])).toEqual([
			["file", "/refs/a.pdf"],
			["file", "/refs/b.txt"],
		]);
	});

	it("keeps first source order while newest duplicate owns title", () => {
		const sources = deriveWorkProjection(
			[
				message({ id: "a", content: "[Old](https://example.com/doc/#one)" }),
				message({
					id: "b",
					timestamp: 2,
					content: "[New](https://EXAMPLE.com/doc)\n[Other](https://other.example/)",
				}),
			],
			"/work",
		).sources;
		expect(sources.map((s) => s.title)).toEqual(["New", "Other"]);
	});

	it("returns empty sections rather than throwing on malformed records", () => {
		expect(() =>
			deriveWorkProjection([message({ toolCalls: [{ broken: true } as never] })], "/work"),
		).not.toThrow();
	});
});