import type { ModelInfo } from "@/types";
import { describe, expect, it } from "vitest";
import { findModel, modelKey } from "./model-key";

const mk = (provider: string, id: string, name: string): ModelInfo => ({
	id,
	name,
	provider,
	reasoning: false,
	contextWindow: 0,
	maxTokens: 0,
	input: ["text"],
});

describe("model-key", () => {
	it("formats a provider/id key", () => {
		expect(modelKey("opencode-go", "glm-4.6")).toBe("opencode-go/glm-4.6");
	});

	it("tolerates undefined parts", () => {
		expect(modelKey(undefined, "x")).toBe("/x");
		expect(modelKey("p", undefined)).toBe("p/");
	});

	it("distinguishes the same id under different providers", () => {
		const models = [
			mk("zai", "glm-4.6", "GLM 4.6 (zai)"),
			mk("opencode-go", "glm-4.6", "GLM 4.6 (oc)"),
		];
		// Bare-id matching would return the first (zai); composite keys do not.
		expect(findModel(models, modelKey("opencode-go", "glm-4.6"))?.name).toBe("GLM 4.6 (oc)");
		expect(findModel(models, modelKey("zai", "glm-4.6"))?.name).toBe("GLM 4.6 (zai)");
	});

	it("returns undefined for unknown or empty keys", () => {
		const models = [mk("zai", "glm-4.6", "GLM")];
		expect(findModel(models, undefined)).toBeUndefined();
		expect(findModel(models, "nope/none")).toBeUndefined();
		expect(findModel(undefined, "zai/glm-4.6")).toBeUndefined();
	});
});
