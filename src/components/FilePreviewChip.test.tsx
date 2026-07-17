import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilePreviewChip } from "./FilePreviewChip";

// Mock the Tauri convertFileSrc
vi.mock("@tauri-apps/api/core", () => ({
	convertFileSrc: (path: string) => `tauri://localhost/${path}`,
}));

describe("FilePreviewChip", () => {
	it("renders image thumbnail for image mime types", () => {
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
		expect(img).toHaveAttribute("src", "tauri://localhost//home/user/photo.png");
		expect(screen.getByText("photo.png")).toBeInTheDocument();
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
		// Should show an SVG icon (lucide FileText) and filename
		expect(screen.getByText("doc.pdf")).toBeInTheDocument();
		// No img tag for non-images
		expect(screen.queryByRole("img")).not.toBeInTheDocument();
	});

	it("shows formatted file size", () => {
		render(
			<FilePreviewChip
				path="/home/user/video.mov"
				name="video.mov"
				size={524288000}
				mimeType="video/quicktime"
				onRemove={() => {}}
			/>,
		);
		expect(screen.getByText(/500\.0 MB/)).toBeInTheDocument();
	});

	it("calls onRemove with the path when X is clicked", async () => {
		const onRemove = vi.fn();
		render(
			<FilePreviewChip
				path="/home/user/file.txt"
				name="file.txt"
				size={1024}
				mimeType="text/plain"
				onRemove={onRemove}
			/>,
		);
		const user = userEvent.setup();
		await user.click(screen.getByRole("button", { name: /remove/i }));
		expect(onRemove).toHaveBeenCalledWith("/home/user/file.txt");
	});

	it("truncates filenames longer than 30 characters", () => {
		const longName = "a".repeat(40) + ".txt";
		render(
			<FilePreviewChip
				path={`/home/user/${longName}`}
				name={longName}
				size={512}
				mimeType="text/plain"
				onRemove={() => {}}
			/>,
		);
		// Should display truncated name with ellipsis (…)
		const display = screen.getByText(/…$/);
		expect(display).toBeInTheDocument();
	});
});
