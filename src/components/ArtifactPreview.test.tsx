import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ArtifactPreview } from "./ArtifactPreview";

describe("ArtifactPreview", () => {
	it("renders HTML preview in sandboxed iframe", () => {
		const { container } = render(
			<ArtifactPreview
				filePath="/tmp/test.html"
				fileContent="<h1>Hello World</h1>"
				artifactType="html"
			/>,
		);
		const iframe = container.querySelector("iframe");
		expect(iframe).toBeInTheDocument();
		expect(iframe).toHaveAttribute("sandbox", "");
		expect(screen.getByText("test.html")).toBeInTheDocument();
	});

	it("blocks scripts and remote loading in HTML previews", () => {
		const { container } = render(
			<ArtifactPreview
				filePath="/work/a.html"
				fileContent='<meta http-equiv="refresh" content="0;url=https://tracker.invalid"><script>window.pwned=1</script><a href="https://tracker.invalid/x">go</a><img src="https://tracker.invalid/x">'
				artifactType="html"
			/>,
		);
		const iframe = container.querySelector("iframe");
		expect(iframe).toHaveAttribute("sandbox", "");
		const srcdoc = iframe?.getAttribute("srcdoc") ?? "";
		expect(srcdoc).toContain("default-src 'none'");
		expect(srcdoc).not.toContain("tracker.invalid");
		expect(srcdoc).not.toContain("<script");
		expect(srcdoc).not.toContain("onload=");
	});

	it("renders sanitized SVG as an image rather than executable inline markup", () => {
		const { container } = render(
			<ArtifactPreview
				filePath="/work/a.svg"
				fileContent='<svg onload="window.pwned=1"><script>alert(1)</script><circle/></svg>'
				artifactType="svg"
			/>,
		);
		expect(container.querySelector("svg")).toBeNull();
		expect(container.querySelector("script")).toBeNull();
		const image = screen.getByRole("img", { name: "a.svg" });
		expect(decodeURIComponent(image.getAttribute("src") ?? "")).not.toContain("script");
		expect(decodeURIComponent(image.getAttribute("src") ?? "")).not.toContain("onload");
	});

	it("renders image preview with alt text", () => {
		render(
			<ArtifactPreview
				filePath="/tmp/photo.png"
				fileContent="data:image/png;base64,iVBORw0KGgo="
				artifactType="image"
			/>,
		);
		const img = screen.getByAltText("photo.png");
		expect(img).toBeInTheDocument();
		expect(img).toHaveAttribute("src", "data:image/png;base64,iVBORw0KGgo=");
	});

	it("renders code block for code files", () => {
		render(
			<ArtifactPreview filePath="/tmp/script.ts" fileContent="const x = 1;" artifactType="code" />,
		);
		expect(screen.getByTestId("artifact-filename")).toHaveTextContent("script.ts");
		expect(screen.getByText("const x = 1;")).toBeInTheDocument();
	});

	it("shows fallback message for unknown artifacts", () => {
		render(
			<ArtifactPreview filePath="/tmp/file.xyz" fileContent="some data" artifactType="unknown" />,
		);
		expect(screen.getByText(/unknown file type/i)).toBeInTheDocument();
		expect(screen.getByText("/tmp/file.xyz")).toBeInTheDocument();
	});

	it("calls onOpenFolder when Open folder button clicked", () => {
		const onOpenFolder = vi.fn();
		render(
			<ArtifactPreview
				filePath="/home/user/project/index.html"
				fileContent="<h1>Hi</h1>"
				artifactType="html"
				onOpenFolder={onOpenFolder}
			/>,
		);
		fireEvent.click(screen.getByText("📁 Open folder"));
		expect(onOpenFolder).toHaveBeenCalledWith("/home/user/project");
	});

	it("calls onCopyPath when Copy path button clicked", () => {
		const onCopyPath = vi.fn();
		render(
			<ArtifactPreview
				filePath="/tmp/test.html"
				fileContent="<h1>Hi</h1>"
				artifactType="html"
				onCopyPath={onCopyPath}
			/>,
		);
		fireEvent.click(screen.getByText("📋 Copy path"));
		expect(onCopyPath).toHaveBeenCalledWith("/tmp/test.html");
	});

	it("shows file path for nested directory structure", () => {
		render(
			<ArtifactPreview
				filePath="/home/user/projects/my-app/src/components/Header.tsx"
				fileContent="export function Header() { return null; }"
				artifactType="code"
			/>,
		);
		expect(screen.getByTestId("artifact-filename")).toHaveTextContent("Header.tsx");
	});
});
