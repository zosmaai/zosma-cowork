import { type ArtifactType, detectArtifactType } from "@/lib/artifacts";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

export interface ArtifactData {
	filePath: string;
	fileContent: string;
	artifactType: ArtifactType;
}

export type ArtifactLoadState =
	| { status: "idle"; artifact: null }
	| { status: "loading"; artifact: null }
	| { status: "loaded"; artifact: ArtifactData }
	| { status: "unavailable"; artifact: null };

export function useArtifactLoader(filePath: string | null, workspace: string): ArtifactLoadState {
	const [state, setState] = useState<ArtifactLoadState>({ status: "idle", artifact: null });

	useEffect(() => {
		if (!filePath) {
			setState({ status: "idle", artifact: null });
			return;
		}

		let current = true;
		let objectUrl: string | undefined;
		setState({ status: "loading", artifact: null });
		invoke<{ bytes: number[]; mimeType: string }>("read_workspace_artifact", {
			path: filePath,
			workspace,
		})
			.then(({ bytes, mimeType }) => {
				if (!current) return;
				const artifactType = detectArtifactType(filePath);
				let fileContent: string;
				if (artifactType === "image") {
					objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeType }));
					fileContent = objectUrl;
				} else {
					fileContent = new TextDecoder().decode(new Uint8Array(bytes));
				}
				setState({ status: "loaded", artifact: { filePath, fileContent, artifactType } });
			})
			.catch(() => {
				if (current) setState({ status: "unavailable", artifact: null });
			});

		return () => {
			current = false;
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	}, [filePath, workspace]);

	return state;
}
