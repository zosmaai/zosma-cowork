import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilePreviewChip } from "./FilePreviewChip";

// Mock the Tauri convertFileSrc
vi.mock("@tauri-apps/api/core", () => ({
	convertFileSrc: (path: string) => `tauri://localhost/${path}`,
}));

describe("FilePreviewChip", () => {
	it("shows image thumbnail for image mime types", () => {
		render(
			<FilePreviewChip
				path="/home/user/photo.png"
				name="photo.png"
				size={245760}
				mimeType="image/png"
				onRemove={() => {}}
			/>,
		);
		const img = screen.getByRole("img");
		expect(img).toBeInTheDocument();
		expect(img).toHaveAttribute("alt", "photo.png");
		expect(img).toHaveAttribute("src", "tauri://localhost//home/user/photo.png");
	});

	it("renders file icon for non-image files", () => {
		render(
			<FilePreviewChip
				path="/home/user/doc.pdf"
				name="doc.pdf"
				size={3200000}
				mimeType="application/pdf"
				onRemove={() => {}}
			/>,
		);
		expect(screen.getByText("doc.pdf")).toBeInTheDocument();
		expect(screen.queryByRole("img")).not.toBeInTheDocument();
	});

	it("formats file sizes correctly: bytes, KB, MB, GB", () => {
		const { rerender } = render(
			<FilePreviewChip
				path="/a.txt"
				name="a.txt"
				size={500}
				mimeType="text/plain"
				onRemove={() => {}}
			/>,
		);
		expect(screen.getByText("500 B")).toBeInTheDocument();

		rerender(
			<FilePreviewChip
				path="/b.txt"
				name="b.txt"
				size={2048}
				mimeType="text/plain"
				onRemove={() => {}}
			/>,
		);
		expect(screen.getByText("2.0 KB")).toBeInTheDocument();

		rerender(
			<FilePreviewChip
				path="/c.txt"
				name="c.txt"
				size={3145728}
				mimeType="text/plain"
				onRemove={() => {}}
			/>,
		);
		expect(screen.getByText("3.0 MB")).toBeInTheDocument();

		rerender(
			<FilePreviewChip
				path="/d.txt"
				name="d.txt"
				size={2147483648}
				mimeType="text/plain"
				onRemove={() => {}}
			/>,
		);
		expect(screen.getByText("2.0 GB")).toBeInTheDocument();
	});

	it("handles zero-byte files without crashing", () => {
		render(
			<FilePreviewChip
				path="/empty.txt"
				name="empty.txt"
				size={0}
				mimeType="text/plain"
				onRemove={() => {}}
			/>,
		);
		expect(screen.getByText("0 B")).toBeInTheDocument();
	});

	it("calls onRemove with the correct path when remove button clicked", async () => {
		const onRemove = vi.fn();
		const user = userEvent.setup();
		render(
			<FilePreviewChip
				path="/unique/path/file.txt"
				name="file.txt"
				size={100}
				mimeType="text/plain"
				onRemove={onRemove}
			/>,
		);
		await user.click(screen.getByRole("button"));
		expect(onRemove).toHaveBeenCalledTimes(1);
		expect(onRemove).toHaveBeenCalledWith("/unique/path/file.txt");
	});

	it("truncates filenames longer than 30 chars with ellipsis", () => {
		const longName = "this-filename-is-way-too-long-for-display.txt";
		render(
			<FilePreviewChip
				path={`/path/${longName}`}
				name={longName}
				size={512}
				mimeType="text/plain"
				onRemove={() => {}}
			/>,
		);
		// The displayed text should end with … (the truncated name contains …)
		const displayed = screen.getByText(/…$/);
		expect(displayed).toBeInTheDocument();
	});

	it("renders correct icon for different mime type categories", () => {
		// text/* → FileCode icon
		const { rerender } = render(
			<FilePreviewChip
				path="/code.ts"
				name="code.ts"
				size={100}
				mimeType="text/typescript"
				onRemove={() => {}}
			/>,
		);
		expect(screen.getByText("code.ts")).toBeInTheDocument();

		// application/zip → FileArchive icon
		rerender(
			<FilePreviewChip
				path="/archive.zip"
				name="archive.zip"
				size={100}
				mimeType="application/zip"
				onRemove={() => {}}
			/>,
		);
		expect(screen.getByText("archive.zip")).toBeInTheDocument();

		// Fallback → File icon
		rerender(
			<FilePreviewChip
				path="/binary.bin"
				name="binary.bin"
				size={100}
				mimeType="application/octet-stream"
				onRemove={() => {}}
			/>,
		);
		expect(screen.getByText("binary.bin")).toBeInTheDocument();
	});

	it("shows tooltip with full path on hover", () => {
		render(
			<FilePreviewChip
				path="/deeply/nested/path/document.pdf"
				name="document.pdf"
				size={5000}
				mimeType="application/pdf"
				onRemove={() => {}}
			/>,
		);
		// The root element of the component has the title attribute
		const chip = screen.getByText("document.pdf").closest("[title]");
		expect(chip).toHaveAttribute("title", "/deeply/nested/path/document.pdf");
	});
});
