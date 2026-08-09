import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ReactMarkdown from "react-markdown";
import { markdownComponents } from "./MarkdownComponents";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("markdownComponents", () => {
	it("renders unsafe schemes as non-navigable text", () => {
		render(<ReactMarkdown components={markdownComponents}>{"[bad](javascript:alert(1))"}</ReactMarkdown>);
		expect(screen.queryByRole("link", { name: "bad" })).toBeNull();
		expect(screen.getByText("bad")).toBeInTheDocument();
	});

	it("renders relative links as non-navigable text", () => {
		render(<ReactMarkdown components={markdownComponents}>{"[local](./report.html)"}</ReactMarkdown>);
		expect(screen.queryByRole("link", { name: "local" })).toBeNull();
		expect(screen.getByText("local")).toBeInTheDocument();
	});

	it("keeps fragment links navigable in-page", () => {
		render(<ReactMarkdown components={markdownComponents}>{"[section](#results)"}</ReactMarkdown>);
		expect(screen.getByRole("link", { name: "section" })).toHaveAttribute("href", "#results");
	});

	it("opens an https link through the validated external path", () => {
		render(<ReactMarkdown components={markdownComponents}>{"[safe](https://example.com)"}</ReactMarkdown>);
		fireEvent.click(screen.getByRole("link", { name: "safe" }));
		expect(invoke).toHaveBeenCalledWith("open_url", { url: "https://example.com" });
	});
});