import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AttachmentCard } from "./AttachmentCard";

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
	convertFileSrc: (path: string) => `tauri://localhost/${path}`,
	invoke: (...args: unknown[]) => mockInvoke(...args),
}));

describe("AttachmentCard", () => {
	it("renders image thumbnail for image mime types", () => {
		render(
			<AttachmentCard
				path="/img.png"
				name="img.png"
				size={102400}
				mimeType="image/png"
			/>,
		);
		const img = screen.getByRole("img");
		expect(img).toBeInTheDocument();
		expect(img).toHaveAttribute("src", "tauri://localhost//img.png");
		expect(img).toHaveAttribute("alt", "img.png");
	});

	it("renders file icon (not img) for non-image files", () => {
		render(
			<AttachmentCard
				path="/doc.pdf"
				name="doc.pdf"
				size={3200000}
				mimeType="application/pdf"
			/>,
		);
		expect(screen.getByText("doc.pdf")).toBeInTheDocument();
		expect(screen.queryByRole("img")).not.toBeInTheDocument();
	});

	it("formats file sizes correctly", () => {
		const { rerender } = render(
			<AttachmentCard path="/a.txt" name="a.txt" size={500} mimeType="text/plain" />,
		);
		expect(screen.getByText("500 B")).toBeInTheDocument();

		rerender(
			<AttachmentCard path="/b.txt" name="b.txt" size={2048} mimeType="text/plain" />,
		);
		expect(screen.getByText("2.0 KB")).toBeInTheDocument();
	});

	it("calls open_url with file:// URL when clicked", async () => {
		const user = userEvent.setup();
		render(
			<AttachmentCard
				path="/home/user/doc.txt"
				name="doc.txt"
				size={100}
				mimeType="text/plain"
			/>,
		);
		await user.click(screen.getByRole("button"));
		expect(mockInvoke).toHaveBeenCalledWith("open_url", {
			url: "file:///home/user/doc.txt",
		});
	});

	it("does not throw on rapid clicks", async () => {
		mockInvoke.mockResolvedValue(undefined);
		const user = userEvent.setup();
		render(
			<AttachmentCard path="/f.txt" name="f.txt" size={10} mimeType="text/plain" />,
		);
		// Rapid double-click should not throw
		await user.click(screen.getByRole("button"));
		await user.click(screen.getByRole("button"));
		// Should have called open_url at least once with correct args
		expect(mockInvoke).toHaveBeenCalledWith("open_url", {
			url: "file:///f.txt",
		});
	});

	it("does not crash when invoke throws", async () => {
		mockInvoke.mockRejectedValue(new Error("permission denied"));
		const user = userEvent.setup();
		render(
			<AttachmentCard path="/secret.txt" name="secret.txt" size={50} mimeType="text/plain" />,
		);
		// Should not throw when clicked
		await expect(
			user.click(screen.getByRole("button")),
		).resolves.toBeUndefined();
	});

	it("shows full path as tooltip", () => {
		render(
			<AttachmentCard
				path="/very/deep/path/notes.md"
				name="notes.md"
				size={200}
				mimeType="text/markdown"
			/>,
		);
		const btn = screen.getByRole("button");
		expect(btn).toHaveAttribute("title", "/very/deep/path/notes.md");
	});

	it("truncates long filenames in the display", () => {
		const longName = `${'a'.repeat(60)}.txt`;
		render(
			<AttachmentCard
				path={`/${longName}`}
				name={longName}
				size={999}
				mimeType="text/plain"
			/>,
		);
		// The filename should be truncated in the button (CSS truncation)
		const nameEl = screen.getByText(/\.txt$/);
		expect(nameEl).toBeInTheDocument();
		expect(nameEl.className).toContain("truncate");
	});
});
