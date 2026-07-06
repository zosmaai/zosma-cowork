/**
 * ExtensionConfigForm — generic, schema-driven settings form for an extension
 * (issue #178). Renders one control per field parsed from `ext.configSchema`,
 * pre-filled from `ext.config`, and persists edits via the `set_extension_config`
 * command (passed in as `onSave` by the panel).
 *
 * Secret-typed fields (tokens/keys/passwords) are masked with a show/hide
 * toggle; when a value is already saved we show a "saved" placeholder and only
 * overwrite it if the user types something new — so we never echo secrets back.
 */

import { type ConfigField, missingRequiredConfig, parseConfigSchema } from "@/lib/extensionConfigSchema";
import type { ZemExtension } from "@/types";
import { AlertCircle, Check, Eye, EyeOff } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

interface ExtensionConfigFormProps {
	ext: ZemExtension;
	/** Persist the merged config. Resolve on success so we can show "Saved". */
	onSave: (config: Record<string, unknown>) => Promise<void> | void;
}

/** Sentinel meaning "a secret is already saved but not shown in this form". */
const SECRET_KEPT = Symbol("secret-kept");
type FieldValue = string | number | boolean | typeof SECRET_KEPT;

function initialValue(field: ConfigField, saved: unknown): FieldValue {
	if (field.type === "boolean") {
		if (typeof saved === "boolean") return saved;
		return typeof field.default === "boolean" ? field.default : false;
	}
	if (field.type === "secret") {
		// Don't hydrate the actual secret into the input; mark it as kept.
		return saved !== undefined && saved !== null && saved !== "" ? SECRET_KEPT : "";
	}
	if (saved !== undefined && saved !== null) return saved as string | number;
	if (field.default !== undefined) return field.default;
	return "";
}

export function ExtensionConfigForm({ ext, onSave }: ExtensionConfigFormProps) {
	const fields = useMemo(() => parseConfigSchema(ext.configSchema), [ext.configSchema]);

	const [values, setValues] = useState<Record<string, FieldValue>>(() => {
		const init: Record<string, FieldValue> = {};
		for (const f of fields) init[f.key] = initialValue(f, ext.config?.[f.key]);
		return init;
	});
	const [revealed, setRevealed] = useState<Record<string, boolean>>({});
	const [dirty, setDirty] = useState(false);
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const setField = useCallback((key: string, value: FieldValue) => {
		setValues((prev) => ({ ...prev, [key]: value }));
		setDirty(true);
		setSaved(false);
	}, []);

	// Required fields still empty (a "kept" secret counts as satisfied).
	const missing = useMemo(() => {
		const effective: Record<string, unknown> = {};
		for (const f of fields) {
			const v = values[f.key];
			effective[f.key] = v === SECRET_KEPT ? "kept" : v;
		}
		return missingRequiredConfig(fields, effective);
	}, [fields, values]);

	const handleSave = useCallback(async () => {
		setError(null);
		setSaving(true);
		try {
			// Merge onto existing config so kept secrets and unknown keys survive.
			const next: Record<string, unknown> = { ...(ext.config ?? {}) };
			for (const f of fields) {
				const v = values[f.key];
				if (v === SECRET_KEPT) continue; // leave the stored secret untouched
				if (f.type === "number") {
					if (v === "" || v === undefined) {
						delete next[f.key];
					} else {
						const n = typeof v === "number" ? v : Number(v);
						next[f.key] = Number.isNaN(n) ? v : n;
					}
					continue;
				}
				next[f.key] = v;
			}
			await onSave(next);
			setDirty(false);
			setSaved(true);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	}, [ext.config, fields, values, onSave]);

	if (fields.length === 0) return null;

	return (
		<div className="space-y-4">
			<div>
				<h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
					Configuration
				</h4>
				<p className="text-[11px] text-muted-foreground/70 mt-0.5">
					Settings for {ext.name}. Stored with the extension.
				</p>
			</div>

			<div className="space-y-3.5">
				{fields.map((field) => (
					<ConfigControl
						key={field.key}
						field={field}
						value={values[field.key]}
						revealed={!!revealed[field.key]}
						missing={missing.includes(field.key)}
						onChange={(v) => setField(field.key, v)}
						onToggleReveal={() =>
							setRevealed((prev) => ({ ...prev, [field.key]: !prev[field.key] }))
						}
					/>
				))}
			</div>

			{error && (
				<div className="flex items-start gap-2 text-[11px] text-destructive">
					<AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" />
					<span>{error}</span>
				</div>
			)}

			<div className="flex items-center gap-3 pt-1">
				<button
					type="button"
					disabled={saving || !dirty || missing.length > 0}
					onClick={handleSave}
					className="text-xs font-semibold px-4 py-1.5 rounded-lg bg-primary text-primary-foreground hover:brightness-110 disabled:opacity-50 transition-all"
				>
					{saving ? "Saving…" : "Save configuration"}
				</button>
				{saved && !dirty && (
					<span className="flex items-center gap-1 text-[11px] text-primary">
						<Check className="w-3.5 h-3.5" />
						Saved
					</span>
				)}
				{missing.length > 0 && (
					<span className="text-[11px] text-muted-foreground/70">
						{missing.length} required field{missing.length > 1 ? "s" : ""} left
					</span>
				)}
			</div>
		</div>
	);
}

// ─── Single control ─────────────────────────────────────────────────

function ConfigControl({
	field,
	value,
	revealed,
	missing,
	onChange,
	onToggleReveal,
}: {
	field: ConfigField;
	value: FieldValue;
	revealed: boolean;
	missing: boolean;
	onChange: (v: FieldValue) => void;
	onToggleReveal: () => void;
}) {
	const id = `ext-cfg-${field.key}`;

	if (field.type === "boolean") {
		return (
			<label htmlFor={id} className="flex items-start gap-2.5 cursor-pointer">
				<input
					id={id}
					type="checkbox"
					checked={value === true}
					onChange={(e) => onChange(e.target.checked)}
					className="mt-0.5 h-3.5 w-3.5 rounded border-border accent-primary"
				/>
				<span className="min-w-0">
					<span className="text-xs font-medium text-foreground">{field.label}</span>
					{field.description && (
						<span className="block text-[11px] text-muted-foreground/70 mt-0.5">
							{field.description}
						</span>
					)}
				</span>
			</label>
		);
	}

	const isSecret = field.type === "secret";
	const isKept = value === SECRET_KEPT;
	const inputType = isSecret && !revealed ? "password" : field.type === "number" ? "number" : "text";
	const stringValue = isKept ? "" : value === undefined ? "" : String(value);

	return (
		<div className="space-y-1">
			<Label id={id} field={field} missing={missing} />
			<div className="relative">
				{field.enumValues ? (
					<select
						id={id}
						value={stringValue}
						onChange={(e) => onChange(e.target.value)}
						className="w-full text-xs rounded-lg border border-border bg-card px-2.5 py-1.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
					>
						<option value="">Select…</option>
						{field.enumValues.map((opt) => (
							<option key={opt} value={opt}>
								{opt}
							</option>
						))}
					</select>
				) : (
					<input
						id={id}
						type={inputType}
						value={stringValue}
						placeholder={isKept ? "•••••••• (saved — type to replace)" : field.placeholder}
						onChange={(e) => onChange(e.target.value)}
						autoComplete={isSecret ? "off" : undefined}
						spellCheck={isSecret ? false : undefined}
						className="w-full text-xs rounded-lg border border-border bg-card px-2.5 py-1.5 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring/40"
					/>
				)}
				{isSecret && !field.enumValues && (
					<button
						type="button"
						onClick={onToggleReveal}
						aria-label={revealed ? "Hide value" : "Show value"}
						className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground transition-colors"
					>
						{revealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
					</button>
				)}
			</div>
			{field.description && (
				<p className="text-[11px] text-muted-foreground/70">{field.description}</p>
			)}
		</div>
	);
}

function Label({ id, field, missing }: { id: string; field: ConfigField; missing: boolean }) {
	return (
		<label htmlFor={id} className="flex items-center gap-1.5 text-xs font-medium text-foreground">
			{field.label}
			{field.required && <span className="text-destructive">*</span>}
			{missing && (
				<span className="text-[10px] font-normal text-muted-foreground/60">required</span>
			)}
		</label>
	);
}
