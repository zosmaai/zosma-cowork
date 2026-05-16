import { type ArtifactType, detectArtifactType } from "@/lib/artifacts";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { useEffect, useState } from "react";

export interface ArtifactData {
	filePath: string;
	fileContent: string;
	artifactType: ArtifactType;
}

/**
 * Hook that loads a file from disk via Tauri's filesystem plugin
 * and detects its artifact type for inline preview.
 *
 * Returns null while loading or on error.
 * Returns ArtifactData when the file is loaded.
 */
export function useArtifactLoader(filePath: string | null): ArtifactData | null {
	const [artifact, setArtifact] = useState<ArtifactData | null>(null);

	useEffect(() => {
		if (!filePath) {
			setArtifact(null);
			return;
		}

		let cancelled = false;
		const artifactType = detectArtifactType(filePath);

		readTextFile(filePath)
			.then((content) => {
				if (!cancelled) {
					setArtifact({ filePath, fileContent: content, artifactType });
				}
			})
			.catch(() => {
				if (!cancelled) setArtifact(null);
			});

		return () => {
			cancelled = true;
		};
	}, [filePath]);

	return artifact;
}
