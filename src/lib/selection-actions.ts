export const START_WRITING_INSTRUCTION = "Start writing from this excerpt.";

export function formatSelectionPrompt(excerpt: string, instruction: string): string {
	const selected = excerpt.replace(/\r\n?/g, "\n").trim();
	const intent = instruction.trim();
	if (!selected || !intent) return "";
	const quote = selected
		.split("\n")
		.map((line) => (line ? `> ${line}` : ">"))
		.join("\n");
	return `${quote}\n\n${intent}`;
}

export interface SelectionAnchor {
	left: number;
	top: number;
	bottom: number;
}

export interface AssistantSelection {
	excerpt: string;
	messageId: string;
	anchor: SelectionAnchor;
}

function responseRoot(node: Node | null): HTMLElement | null {
	const element = node instanceof Element ? node : node?.parentElement;
	return element?.closest<HTMLElement>("[data-assistant-response]") ?? null;
}

export function readAssistantSelection(selection: Selection | null): AssistantSelection | null {
	if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
	const range = selection.getRangeAt(0);
	const start = responseRoot(range.startContainer);
	const end = responseRoot(range.endContainer);
	if (!start || start !== end) return null;
	const excerpt = selection.toString().replace(/\r\n?/g, "\n").trim();
	const messageId = start.dataset.assistantResponse;
	if (!excerpt || !messageId) return null;
	const rect = range.getBoundingClientRect();
	return {
		excerpt,
		messageId,
		anchor: {
			left: rect.left + rect.width / 2,
			top: rect.top,
			bottom: rect.bottom,
		},
	};
}
