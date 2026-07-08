import { describe, expect, it } from "vitest";
import {
	type ConfigField,
	hasConfigSchema,
	isConfigIncomplete,
	missingRequiredConfig,
	parseConfigSchema,
} from "./extensionConfigSchema";

function byKey(fields: ConfigField[], key: string): ConfigField {
	const f = fields.find((x) => x.key === key);
	if (!f) throw new Error(`no field ${key}`);
	return f;
}

describe("parseConfigSchema", () => {
	it("returns [] for missing/invalid schemas", () => {
		expect(parseConfigSchema(undefined)).toEqual([]);
		expect(parseConfigSchema(null)).toEqual([]);
		expect(parseConfigSchema("nope")).toEqual([]);
		expect(parseConfigSchema(42)).toEqual([]);
		expect(parseConfigSchema({})).toEqual([]);
	});

	it("parses a JSON-Schema-ish object with properties + required", () => {
		const fields = parseConfigSchema({
			type: "object",
			properties: {
				token: { type: "string", format: "password", title: "Discord Token" },
				port: { type: "number", default: 8080 },
				verbose: { type: "boolean" },
			},
			required: ["token"],
		});
		expect(fields.map((f) => f.key)).toEqual(["token", "port", "verbose"]);
		expect(byKey(fields, "token")).toMatchObject({
			type: "secret",
			label: "Discord Token",
			required: true,
		});
		expect(byKey(fields, "port")).toMatchObject({ type: "number", default: 8080, required: false });
		expect(byKey(fields, "verbose")).toMatchObject({ type: "boolean" });
	});

	it("parses a flat descriptor map and ignores reserved keywords", () => {
		const fields = parseConfigSchema({
			apiKey: { type: "string", secret: true },
			region: { type: "string", enum: ["us", "eu"] },
			$schema: "http://json-schema.org/draft-07/schema#",
			title: "ignored",
		});
		expect(fields.map((f) => f.key).sort()).toEqual(["apiKey", "region"]);
		expect(byKey(fields, "region").enumValues).toEqual(["us", "eu"]);
	});

	it("accepts numeric enum values and normalizes them to strings", () => {
		const fields = parseConfigSchema({
			timeout: { type: "number", enum: [30, 60, 120] },
			mode: { type: "string", enum: ["a", 2, "c"] },
		});
		expect(byKey(fields, "timeout").enumValues).toEqual(["30", "60", "120"]);
		expect(byKey(fields, "mode").enumValues).toEqual(["a", "2", "c"]);
	});

	it("infers secret from the key name when no type is declared", () => {
		const fields = parseConfigSchema({ properties: { access_token: {}, name: {} } });
		expect(byKey(fields, "access_token").type).toBe("secret");
		expect(byKey(fields, "name").type).toBe("string");
	});

	it("maps integer to a number control and humanizes labels", () => {
		const fields = parseConfigSchema({ properties: { maxRetries: { type: "integer" } } });
		expect(byKey(fields, "maxRetries")).toMatchObject({ type: "number", label: "Max Retries" });
	});
});

describe("missingRequiredConfig", () => {
	const fields = parseConfigSchema({
		properties: {
			token: { type: "string" },
			flag: { type: "boolean" },
			region: { type: "string", default: "us" },
		},
		required: ["token", "flag", "region"],
	});

	it("flags blank required text fields", () => {
		expect(missingRequiredConfig(fields, {})).toEqual(["token"]);
		expect(missingRequiredConfig(fields, { token: "" })).toEqual(["token"]);
		expect(missingRequiredConfig(fields, { token: "  " })).toEqual(["token"]);
	});

	it("treats booleans and defaulted fields as satisfied", () => {
		// flag (boolean) is never "missing"; region has a default.
		expect(missingRequiredConfig(fields, { token: "abc" })).toEqual([]);
	});
});

describe("hasConfigSchema / isConfigIncomplete", () => {
	it("hasConfigSchema reflects presence of fields", () => {
		expect(hasConfigSchema(null)).toBe(false);
		expect(hasConfigSchema({ configSchema: {} })).toBe(false);
		expect(hasConfigSchema({ configSchema: { properties: { a: { type: "string" } } } })).toBe(true);
	});

	it("isConfigIncomplete is true only when required config is missing", () => {
		const configSchema = {
			properties: { token: { type: "string" } },
			required: ["token"],
		};
		expect(isConfigIncomplete({ configSchema, config: {} })).toBe(true);
		expect(isConfigIncomplete({ configSchema, config: { token: "x" } })).toBe(false);
		// no required fields → never "incomplete"
		expect(isConfigIncomplete({ configSchema: { properties: { opt: { type: "string" } } } })).toBe(
			false,
		);
	});
});
