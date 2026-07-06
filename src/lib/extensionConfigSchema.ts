/**
 * extensionConfigSchema — normalize an extension's `configSchema` into a flat,
 * render-ready list of fields for the generic config form (issue #178).
 *
 * `configSchema` comes from the extension's `package.json`
 * (`pi.extensions[0].configSchema`) and is loosely a "JSON Schema with UI
 * annotations". Authors are inconsistent, so we accept two shapes:
 *
 *   1. JSON-Schema-ish object with a `properties` map (+ optional `required[]`):
 *        { "type": "object",
 *          "properties": { "token": { "type": "string", "format": "password" } },
 *          "required": ["token"] }
 *
 *   2. A flat map of field → descriptor:
 *        { "token": { "type": "string", "secret": true }, "port": { "type": "number" } }
 *
 * Everything here is pure + framework-free so it can be unit-tested in isolation
 * and reused by both the form and the "needs configuration" card indicator.
 */

/** A single, normalized config field ready to render as one form control. */
export interface ConfigField {
	/** Object key persisted back into the extension config. */
	key: string;
	/** Human label (title/label from the schema, else a prettified key). */
	label: string;
	/** Control kind. `secret` masks the value (tokens/keys/passwords). */
	type: "string" | "number" | "boolean" | "secret";
	/** Optional helper text shown under the control. */
	description?: string;
	/** Whether the field is required (from `required[]` or a per-field flag). */
	required: boolean;
	/** Default value declared by the schema, if any. */
	default?: string | number | boolean;
	/** Placeholder hint for text/number inputs. */
	placeholder?: string;
	/** Enumerated choices → rendered as a `<select>` when present. */
	enumValues?: string[];
}

type Descriptor = Record<string, unknown>;

/** Keys whose name strongly implies a secret even without an explicit flag. */
const SECRET_KEY_RE = /(token|secret|password|passwd|apikey|api[_-]?key|access[_-]?key|private[_-]?key)/i;

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Prettify a raw key ("apiToken" / "api_token") into a "Api Token" label. */
function humanizeKey(key: string): string {
	const spaced = key
		.replace(/[_-]+/g, " ")
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.trim();
	return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

function coercePrimitive(v: unknown): string | number | boolean | undefined {
	if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
	return undefined;
}

/** Decide the control type for a field from its descriptor + key name. */
function resolveType(key: string, desc: Descriptor): ConfigField["type"] {
	const rawType = typeof desc.type === "string" ? desc.type.toLowerCase() : "";
	const format = typeof desc.format === "string" ? desc.format.toLowerCase() : "";
	const secretFlag =
		desc.secret === true ||
		rawType === "secret" ||
		rawType === "password" ||
		format === "password" ||
		format === "secret";

	if (secretFlag) return "secret";
	if (rawType === "boolean") return "boolean";
	if (rawType === "number" || rawType === "integer") return "number";
	// Fall back to a masked field when the key name clearly implies a secret.
	if (!rawType && SECRET_KEY_RE.test(key)) return "secret";
	return "string";
}

/** Build a normalized field from a key + its (possibly non-object) descriptor. */
function toField(key: string, rawDesc: unknown, requiredKeys: Set<string>): ConfigField {
	const desc: Descriptor = isRecord(rawDesc) ? rawDesc : {};
	const type = resolveType(key, desc);

	const label =
		(typeof desc.title === "string" && desc.title) ||
		(typeof desc.label === "string" && desc.label) ||
		humanizeKey(key);

	const description =
		(typeof desc.description === "string" && desc.description) ||
		(typeof desc.help === "string" && desc.help) ||
		undefined;

	const enumValues = Array.isArray(desc.enum)
		? desc.enum.filter((e): e is string => typeof e === "string")
		: undefined;

	const placeholder =
		(typeof desc.placeholder === "string" && desc.placeholder) ||
		(typeof desc.example === "string" && desc.example) ||
		undefined;

	return {
		key,
		label,
		type,
		required: desc.required === true || requiredKeys.has(key),
		...(description ? { description } : {}),
		...(coercePrimitive(desc.default) !== undefined ? { default: coercePrimitive(desc.default) } : {}),
		...(placeholder ? { placeholder } : {}),
		...(enumValues && enumValues.length > 0 ? { enumValues } : {}),
	};
}

/**
 * Parse a raw `configSchema` into an ordered list of {@link ConfigField}.
 * Returns `[]` for anything unusable so callers can treat "no fields" uniformly.
 */
export function parseConfigSchema(schema: unknown): ConfigField[] {
	if (!isRecord(schema)) return [];

	// Shape 1: JSON-Schema-ish with a `properties` map.
	const props = isRecord(schema.properties) ? schema.properties : null;
	const requiredKeys = new Set<string>(
		Array.isArray(schema.required)
			? schema.required.filter((k): k is string => typeof k === "string")
			: [],
	);

	const source = props ?? schema;
	// When falling back to the whole object as the field map, ignore reserved
	// JSON-Schema keywords so we don't render them as fields.
	const RESERVED = new Set(["type", "required", "properties", "$schema", "title", "description"]);

	const fields: ConfigField[] = [];
	for (const [key, value] of Object.entries(source)) {
		if (!props && RESERVED.has(key)) continue;
		if (!props && !isRecord(value)) continue; // flat map entries must be descriptors
		fields.push(toField(key, value, requiredKeys));
	}
	return fields;
}

/** True when the extension declares any configurable fields. */
export function hasConfigSchema(ext?: { configSchema?: unknown } | null): boolean {
	return !!ext && parseConfigSchema(ext.configSchema).length > 0;
}

/** Treat empty strings / null / undefined as "no value provided". */
function isBlank(v: unknown): boolean {
	return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

/**
 * Required field keys that are still missing a value in `config`. Booleans are
 * never "missing" (false is a valid answer); a declared `default` satisfies the
 * requirement too.
 */
export function missingRequiredConfig(
	fields: ConfigField[],
	config?: Record<string, unknown> | null,
): string[] {
	const cfg = config ?? {};
	return fields
		.filter((f) => f.required && f.type !== "boolean")
		.filter((f) => isBlank(cfg[f.key]) && isBlank(f.default))
		.map((f) => f.key);
}

/**
 * True when an installed extension has required config that isn't filled in yet
 * — drives the "needs configuration" indicator on the extension card.
 */
export function isConfigIncomplete(ext?: {
	installed?: boolean;
	config?: Record<string, unknown>;
	configSchema?: unknown;
} | null): boolean {
	if (!ext) return false;
	const fields = parseConfigSchema(ext.configSchema);
	if (fields.length === 0) return false;
	return missingRequiredConfig(fields, ext.config).length > 0;
}
