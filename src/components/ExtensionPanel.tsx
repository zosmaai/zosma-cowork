/**
 * ExtensionPanel — app-store style marketplace for pi extensions.
 *
 * Top search hits the npm registry (scoped to pi packages). A
 * "Discover / Installed" switch toggles between a curated featured set
 * (filterable by category, paginated) and installed extensions. Installed
 * tiles open a detail view with enable/disable, configuration, and uninstall.
 */

import { useExtensions } from "@/hooks/useExtensions";
import { getExtensionSetup } from "@/lib/extension-setup-registry";
import { openExternalUrl } from "@/lib/utils";
import type { ZemExtension } from "@/types";
import {
	AlertCircle,
	ChevronLeft,
	ExternalLink,
	Package,
	RefreshCw,
	Search as SearchIcon,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	EXTENSION_CATEGORIES,
	FEATURED_EXTENSIONS,
	extensionDisplayName,
} from "../lib/extensionBrowse";
import { pageCount, paginate } from "../lib/skillBrowse";
import { ExtensionTile, FeaturedExtensionTile } from "./store/ExtensionTile";
import {
	FilterChips,
	Pagination,
	SectionHeader,
	StoreEmpty,
	StoreLoading,
	StoreSearch,
	StoreTabs,
} from "./store/StoreUI";

type View = "discover" | "installed";
const PER_PAGE = 9;

interface ExtensionPanelProps {
	onReload: () => void;
}

export function ExtensionPanel({ onReload }: ExtensionPanelProps) {
	const {
		extensions,
		loading,
		error,
		refresh,
		install,
		uninstall,
		setEnabled,
		searchDiscover,
		installing,
	} = useExtensions();

	const [query, setQuery] = useState("");
	const [view, setView] = useState<View>("discover");
	const [category, setCategory] = useState("All");
	const [page, setPage] = useState(0);
	const [selectedExt, setSelectedExt] = useState<string | null>(null);

	const [searchResults, setSearchResults] = useState<
		Array<{ name: string; description: string; version: string; score: number }>
	>([]);
	const [searching, setSearching] = useState(false);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Debounced npm discovery search
	useEffect(() => {
		if (debounceRef.current) clearTimeout(debounceRef.current);
		if (!query.trim()) {
			setSearchResults([]);
			setSearching(false);
			return;
		}
		setSearching(true);
		debounceRef.current = setTimeout(async () => {
			try {
				setSearchResults(await searchDiscover(query.trim()));
			} catch {
				setSearchResults([]);
			} finally {
				setSearching(false);
			}
		}, 450);
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, [query, searchDiscover]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset paging on dataset change
	useEffect(() => {
		setPage(0);
	}, [view, category, query]);

	useEffect(() => {
		if (query.trim()) setView("discover");
	}, [query]);

	const installedKeys = useMemo(() => {
		const s = new Set<string>();
		for (const e of extensions) {
			s.add(e.id);
			if (e.source?.value) s.add(e.source.value);
		}
		return s;
	}, [extensions]);

	const isInstalled = useCallback((pkg: string) => installedKeys.has(pkg), [installedKeys]);

	const openNpm = useCallback((pkg: string) => {
		openExternalUrl(`https://www.npmjs.com/package/${pkg}`).catch(() => {});
	}, []);

	const handleInstall = useCallback(
		async (pkg: string) => {
			try {
				await install(pkg);
				onReload();
			} catch {
				/* handled by hook error state */
			}
		},
		[install, onReload],
	);

	const handleUninstall = useCallback(
		async (ext: ZemExtension) => {
			if (!confirm(`Uninstall "${ext.name}"?`)) return;
			await uninstall(ext.id);
			if (selectedExt === ext.id) setSelectedExt(null);
			onReload();
		},
		[uninstall, selectedExt, onReload],
	);

	const handleToggle = useCallback(
		async (ext: ZemExtension) => {
			await setEnabled(ext.id, !ext.enabled);
			onReload();
		},
		[setEnabled, onReload],
	);

	const selected = extensions.find((e) => e.id === selectedExt) || null;

	// ── Featured (filtered + paged) ───────────────────────────────────
	const featured = useMemo(
		() =>
			category === "All"
				? FEATURED_EXTENSIONS
				: FEATURED_EXTENSIONS.filter((f) => f.category === category),
		[category],
	);

	// Active dataset length for pagination
	const discoverLen = query.trim() ? searchResults.length : featured.length;
	const installedLen = extensions.length;
	const activeLen = view === "discover" ? discoverLen : installedLen;
	const totalPages = pageCount(activeLen, PER_PAGE);
	const safePage = Math.min(page, totalPages - 1);

	// Detail view short-circuits the grid
	if (selected) {
		return (
			<div className="flex flex-col">
				<ExtensionDetail
					ext={selected}
					onBack={() => setSelectedExt(null)}
					onToggle={() => handleToggle(selected)}
					onUninstall={() => handleUninstall(selected)}
				/>
			</div>
		);
	}

	return (
		<div className="flex flex-col">
			<div className="mb-4 flex items-start justify-between gap-3">
				<p className="text-xs text-muted-foreground">
					Add tools and integrations from the{" "}
					<span className="font-medium text-foreground/80">pi ecosystem</span>.
				</p>
				<button
					type="button"
					onClick={refresh}
					className="shrink-0 p-1.5 rounded-lg text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors"
					aria-label="Refresh"
					title="Refresh installed extensions"
				>
					<RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
				</button>
			</div>

			<StoreSearch
				value={query}
				onChange={setQuery}
				busy={searching}
				placeholder="Search pi extensions..."
			/>

			<div className="flex flex-wrap items-center justify-between gap-3 mt-4 mb-4">
				<StoreTabs<View>
					value={view}
					onChange={setView}
					tabs={[
						{ value: "discover", label: "Discover" },
						{ value: "installed", label: "Installed", count: extensions.length },
					]}
				/>
				{view === "discover" && !query.trim() && (
					<FilterChips
						options={EXTENSION_CATEGORIES.map((c) => ({ value: c, label: c }))}
						value={category}
						onChange={setCategory}
					/>
				)}
			</div>

			{error && (
				<div className="mb-4 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20 flex items-center gap-2">
					<AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
					<p className="text-xs text-destructive">{error}</p>
				</div>
			)}

			{view === "discover" ? (
				<section>
					<SectionHeader
						title={query.trim() ? "Search results" : "Featured extensions"}
						count={query.trim() && !searching ? searchResults.length : undefined}
					/>
					{searching && query.trim() ? (
						<StoreLoading label="Searching npm…" />
					) : discoverLen === 0 ? (
						<StoreEmpty
							icon={<SearchIcon className="w-5 h-5" />}
							title={
								query.trim()
									? `No extensions found for "${query}"`
									: "No extensions in this category"
							}
							hint={query.trim() ? "Try a different search term." : undefined}
						/>
					) : query.trim() ? (
						<>
							<div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
								{paginate(searchResults, safePage, PER_PAGE).map((pkg) => (
									<ExtensionTile
										key={pkg.name}
										seed={pkg.name}
										name={extensionDisplayName(pkg.name)}
										subtitle={pkg.name}
										version={pkg.version}
										description={pkg.description}
										onOpen={() => openNpm(pkg.name)}
										action={
											isInstalled(pkg.name) ? (
												<span className="px-2.5 py-1 text-[11px] font-medium rounded-lg bg-primary/10 text-primary">
													Installed
												</span>
											) : (
												<button
													type="button"
													disabled={installing === pkg.name}
													onClick={(e) => {
														e.stopPropagation();
														handleInstall(pkg.name);
													}}
													className="px-3 py-1 text-[11px] font-semibold rounded-lg bg-primary text-primary-foreground hover:brightness-110 disabled:opacity-50 transition-all"
												>
													{installing === pkg.name ? "…" : "Install"}
												</button>
											)
										}
									/>
								))}
							</div>
							<Pagination page={safePage} pageCount={totalPages} onPage={setPage} />
						</>
					) : (
						<>
							<div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
								{paginate(featured, safePage, PER_PAGE).map((f) => (
									<FeaturedExtensionTile
										key={f.pkg}
										pkg={f.pkg}
										label={f.label}
										category={f.category}
										blurb={f.blurb}
										installed={isInstalled(f.pkg)}
										installing={installing === f.pkg}
										onInstall={handleInstall}
										onOpenExternal={openNpm}
									/>
								))}
							</div>
							<Pagination page={safePage} pageCount={totalPages} onPage={setPage} />
						</>
					)}
				</section>
			) : (
				<section>
					<SectionHeader title="Installed extensions" count={extensions.length} />
					{loading ? (
						<StoreLoading label="Loading extensions…" />
					) : extensions.length === 0 ? (
						<StoreEmpty
							icon={<Package className="w-5 h-5" />}
							title="No extensions installed"
							hint="Discover and install extensions to add tools and integrations."
						/>
					) : (
						<>
							<div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
								{paginate(extensions, safePage, PER_PAGE).map((ext) => (
									<ExtensionTile
										key={ext.id}
										seed={ext.id}
										name={ext.name}
										subtitle={ext.author ? `by ${ext.author}` : ext.source?.value}
										version={ext.version}
										description={ext.description}
										onOpen={() => setSelectedExt(ext.id)}
										action={
											<ToggleSwitch
												enabled={ext.enabled}
												onToggle={() => handleToggle(ext)}
												label={`${ext.enabled ? "Disable" : "Enable"} ${ext.name}`}
											/>
										}
									/>
								))}
							</div>
							<Pagination page={safePage} pageCount={totalPages} onPage={setPage} />
						</>
					)}
				</section>
			)}
		</div>
	);
}

// ─── Toggle switch ──────────────────────────────────────────────────

function ToggleSwitch({
	enabled,
	onToggle,
	label,
}: {
	enabled: boolean;
	onToggle: () => void;
	label: string;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={enabled}
			aria-label={label}
			onClick={(e) => {
				e.stopPropagation();
				onToggle();
			}}
			className="relative inline-flex items-center w-8 h-[18px] rounded-full transition-colors"
			style={{
				background: enabled ? "hsl(var(--primary))" : "hsl(var(--muted-foreground) / 0.3)",
			}}
		>
			<span
				className="absolute top-[2px] h-3.5 w-3.5 rounded-full bg-white shadow transition-all"
				style={{ left: enabled ? "calc(100% - 16px)" : "2px" }}
			/>
		</button>
	);
}

// ─── Extension Detail (installed) ───────────────────────────────────

function ExtensionDetail({
	ext,
	onBack,
	onToggle,
	onUninstall,
}: {
	ext: ZemExtension;
	onBack: () => void;
	onToggle: () => void;
	onUninstall: () => void;
}) {
	return (
		<div className="space-y-4 max-w-2xl">
			<button
				type="button"
				onClick={onBack}
				className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
			>
				<ChevronLeft className="w-3.5 h-3.5" />
				Back to Extensions
			</button>

			{/* Header */}
			<div className="flex items-start gap-3">
				<div
					className="w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-bold shrink-0"
					style={{ background: "hsl(var(--primary) / 0.15)", color: "hsl(var(--primary))" }}
				>
					{ext.icon || ext.name.charAt(0).toUpperCase()}
				</div>
				<div className="flex-1 min-w-0">
					<h3 className="text-base font-semibold text-foreground truncate">{ext.name}</h3>
					<p className="text-xs text-muted-foreground">
						v{ext.version}
						{ext.author && <> · by {ext.author}</>}
					</p>
					{ext.description && (
						<p className="text-xs text-muted-foreground mt-1.5">{ext.description}</p>
					)}
				</div>
				<ToggleSwitch
					enabled={ext.enabled}
					onToggle={onToggle}
					label={`${ext.enabled ? "Disable" : "Enable"} ${ext.name}`}
				/>
			</div>

			{/* Source */}
			<div className="glass p-3 text-[11px] text-muted-foreground space-y-1">
				<div className="flex items-center gap-1.5">
					<Package className="w-3 h-3" />
					<span className="font-medium">Source:</span>
					<span className="font-mono truncate">{ext.source.value}</span>
				</div>
				{ext.installPath && (
					<div className="flex items-center gap-1.5">
						<span className="font-medium">Path:</span>
						<span className="font-mono truncate">{ext.installPath}</span>
					</div>
				)}
				<div className="flex items-center gap-1.5">
					<span className="font-medium">Runtime:</span>
					<span className="uppercase">{ext.runtime}</span>
				</div>
				{ext.scope && (
					<div className="flex items-center gap-1.5">
						<span className="font-medium">Scope:</span>
						<span>
							{ext.scope === "project"
								? "This project (.pi)"
								: ext.scope === "user"
									? "Global (~/.pi)"
									: "Temporary"}
						</span>
					</div>
				)}
				{ext.source?.value && (
					<button
						type="button"
						onClick={() =>
							openExternalUrl(`https://www.npmjs.com/package/${ext.source.value}`).catch(() => {})
						}
						className="text-primary hover:underline flex items-center gap-1.5 pt-1"
					>
						<ExternalLink className="w-3 h-3" />
						View on npm
					</button>
				)}
			</div>

			{/* Configuration (whitelisted extensions) */}
			{(() => {
				const setup = getExtensionSetup(ext);
				if (!setup) return null;
				const SetupComponent = setup.Component;
				return (
					<div>
						<h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2">
							Configuration
						</h4>
						<SetupComponent ext={ext} configKey={setup.key} />
					</div>
				);
			})()}

			{/* Capabilities */}
			{ext.capabilities.tools && ext.capabilities.tools.length > 0 && (
				<div>
					<h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2">
						Tools
					</h4>
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
						{ext.capabilities.tools.map((tool) => (
							<div key={tool.name} className="rounded-lg p-2 bg-muted/60">
								<p className="text-xs font-mono text-foreground">{tool.name}</p>
								{tool.description && (
									<p className="text-[10px] text-muted-foreground mt-0.5">{tool.description}</p>
								)}
							</div>
						))}
					</div>
				</div>
			)}

			{ext.capabilities.skills && ext.capabilities.skills.length > 0 && (
				<div>
					<h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2">
						Skills
					</h4>
					<div className="flex flex-wrap gap-1.5">
						{ext.capabilities.skills.map((skill) => (
							<span
								key={skill}
								className="text-[11px] px-2 py-0.5 rounded-md bg-muted text-muted-foreground"
							>
								{skill}
							</span>
						))}
					</div>
				</div>
			)}

			{/* Actions */}
			<div className="flex gap-2 pt-1">
				<button
					type="button"
					onClick={onToggle}
					className="flex-1 text-xs px-3 py-2 rounded-lg border border-border text-foreground hover:bg-muted transition-colors"
				>
					{ext.enabled ? "Disable" : "Enable"}
				</button>
				<button
					type="button"
					onClick={onUninstall}
					className="flex items-center justify-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
				>
					<Trash2 className="w-3.5 h-3.5" />
					Uninstall
				</button>
			</div>
		</div>
	);
}
