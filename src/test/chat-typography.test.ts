import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..", "..");
const css = readFileSync(resolve(root, "src/App.css"), "utf8");
const app = readFileSync(resolve(root, "src/App.tsx"), "utf8");

const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Chat and Work readability", () => {
	it("defines the approved 100% typography tokens", () => {
		for (const token of [
			"--font-response: 17px",
			"--font-user-message: 16px",
			"--font-composer: 16px",
			"--font-empty-heading: 26px",
			"--font-session-title: 14px",
			"--font-secondary: 13px",
			"--font-code: 14px",
			"--font-control: 14px",
		]) expect(css).toContain(token);
	});

	it("uses system reading type for Chat and Work surfaces", () => {
		expect(css).toMatch(/--font-reading:[^;]*-apple-system/);
		expect(css).toMatch(/\.session-shell[^}]*font-family:\s*var\(--font-reading\)/s);
	});

	it("applies 17px assistant and 16px user message classes", () => {
		expect(css).toMatch(/\.chat-markdown\s*\{[^}]*var\(--font-response\)/s);
		expect(css).toMatch(/\.chat-markdown-user\s*\{[^}]*var\(--font-user-message\)/s);
		expect(source("src/components/ChatMessage.tsx")).toContain("chat-markdown-user");
	});

	it("restores persisted font scaling on top of the new defaults", () => {
		expect(app).toContain("fontScaleClass");
		expect(app).toContain("getFontScale");
		expect(app).not.toContain('className="flex md:gap-2.5 md:p-2.5 [zoom:1] h-screen"');
	});

	it("removes sub-12px utilities from core Chat and navigation surfaces", () => {
		for (const file of [
			"src/components/ChatMessage.tsx",
			"src/components/MessageInput.tsx",
			"src/components/ModelSelector.tsx",
			"src/components/CommandPalette.tsx",
			"src/components/Sidebar.tsx",
			"src/components/ConversationSearch.tsx",
			"src/components/ActivityBlock.tsx",
			"src/components/ThinkingBlock.tsx",
			"src/components/ToolCallTimeline.tsx",
			"src/components/ArtifactPreview.tsx",
			"src/components/FileMentionPopup.tsx",
			"src/components/FilePreviewChip.tsx",
			"src/components/InThreadFind.tsx",
		]) {
			expect(source(file), file).not.toMatch(/text-\[(?:9|10|11)px\]/);
		}
	});
});