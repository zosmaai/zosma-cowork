import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useArtifactLoader } from "./useArtifactLoader";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("useArtifactLoader", () => {
	beforeEach(() => invoke.mockReset());

	it("distinguishes loading, loaded, and unavailable", async () => {
		invoke.mockResolvedValueOnce({ bytes: [104, 105], mimeType: "text/plain" });
		const { result, rerender } = renderHook(
			({ path }) => useArtifactLoader(path, "/work"),
			{ initialProps: { path: "/work/a.txt" as string | null } },
		);
		expect(result.current.status).toBe("loading");
		await waitFor(() => expect(result.current.status).toBe("loaded"));
		expect(result.current.artifact?.fileContent).toBe("hi");
		invoke.mockRejectedValueOnce(new Error("outside workspace"));
		rerender({ path: "/outside/no.txt" });
		await waitFor(() => expect(result.current.status).toBe("unavailable"));
	});

	it("ignores a late result for the previously selected path", async () => {
		let release!: (value: unknown) => void;
		invoke.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
		invoke.mockResolvedValueOnce({ bytes: [98], mimeType: "text/plain" });
		const { result, rerender } = renderHook(
			({ path }) => useArtifactLoader(path, "/work"),
			{ initialProps: { path: "/work/a.txt" } },
		);
		rerender({ path: "/work/b.txt" });
		await waitFor(() => expect(result.current.artifact?.fileContent).toBe("b"));
		act(() => release({ bytes: [97], mimeType: "text/plain" }));
		await Promise.resolve();
		expect(result.current.artifact?.filePath).toBe("/work/b.txt");
	});
});