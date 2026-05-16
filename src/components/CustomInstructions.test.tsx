import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CustomInstructions } from "./CustomInstructions";

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
	invoke: (...args: unknown[]) => mockInvoke(...args),
}));

describe("CustomInstructions", () => {
	beforeEach(() => {
		mockInvoke.mockReset();
		mockInvoke.mockImplementation(async (cmd: string) => {
			if (cmd === "get_settings") return {};
			if (cmd === "save_settings") return { success: true };
			return null;
		});
	});

	it("renders the textarea", () => {
		render(<CustomInstructions />);
		expect(
			screen.getByPlaceholderText("e.g. You are a senior developer who prefers TypeScript..."),
		).toBeDefined();
	});

	it("loads saved instructions from settings on mount", async () => {
		mockInvoke.mockImplementationOnce(async () => {
			return { persona: "Always use tabs for indentation." };
		});
		render(<CustomInstructions />);
		await vi.waitFor(() => {
			const el = screen.getByPlaceholderText(
				"e.g. You are a senior developer who prefers TypeScript...",
			) as HTMLTextAreaElement;
			expect(el.value).toBe("Always use tabs for indentation.");
		});
	});

	it("saves instructions to settings with a Save button", async () => {
		render(<CustomInstructions />);
		await vi.waitFor(() => {
			expect(screen.getByText("Save")).not.toBeDisabled();
		});
		const textarea = screen.getByPlaceholderText(
			"e.g. You are a senior developer who prefers TypeScript...",
		) as HTMLTextAreaElement;
		fireEvent.change(textarea, { target: { value: "Write concise code." } });
		fireEvent.click(screen.getByText("Save"));
		await vi.waitFor(() => {
			expect(mockInvoke).toHaveBeenCalledWith("save_settings", {
				persona: "Write concise code.",
			});
		});
	});

	it("shows Saved! confirmation after saving", async () => {
		render(<CustomInstructions />);
		await vi.waitFor(() => {
			expect(screen.getByText("Save")).not.toBeDisabled();
		});
		const textarea = screen.getByPlaceholderText(
			"e.g. You are a senior developer who prefers TypeScript...",
		) as HTMLTextAreaElement;
		fireEvent.change(textarea, { target: { value: "Be helpful." } });
		fireEvent.click(screen.getByText("Save"));
		await vi.waitFor(() => {
			expect(screen.getByText("Saved!")).toBeDefined();
		});
	});

	it("handles settings load failure gracefully", () => {
		mockInvoke.mockImplementation(async () => {
			throw new Error("settings not available");
		});
		render(<CustomInstructions />);
		const textarea = screen.getByPlaceholderText(
			"e.g. You are a senior developer who prefers TypeScript...",
		) as HTMLTextAreaElement;
		expect(textarea.value).toBe("");
	});
});
