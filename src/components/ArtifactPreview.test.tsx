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
		expect(iframe).toHaveAttribute("sandbox", "allow-scripts");
		expect(screen.getByText("test.html")).toBeInTheDocument();
	});

	it("renders SVG inline", () => {
		const { container } = render(
			<ArtifactPreview
				filePath="/tmp/logo.svg"
				fileContent='<svg xmlns="http://www.w3.org/2000/svg"><circle cx="10" cy="10" r="5"/></svg>'
				artifactType="svg"
			/>,
		);
		expect(screen.getByText("logo.svg")).toBeInTheDocument();
		const svgEl = container.querySelector("svg");
		expect(svgEl).toBeInTheDocument();
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
