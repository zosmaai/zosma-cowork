import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { readDir } from "@tauri-apps/plugin-fs";

export interface FileEntry {
	name: string;
	path: string;
	isDirectory: boolean;
}

interface UseFileMentionReturn {
	state: "idle" | "active";
	query: string;
	results: FileEntry[];
	triggerPosition: number | null;
	breadcrumb: string;
	loading: boolean;
	onInput: (value: string, cursorPos: number) => void;
	selectFile: (entry: FileEntry) => { path: string; name: string } | null;
	cancel: () => void;
}

/** Workspace root → entries cache, keyed per session's resolved cwd. */
const workspaceCache = new Map<string, FileEntry[]>();

async function getWorkspaceFiles(sessionFile: string): Promise<FileEntry[]> {
	// The Rust relay maps get_workspace to the selected session's cwd string.
	const root: string = await invoke<string>("get_workspace", { sessionFile });
	if (!root) return [];
	const cached = workspaceCache.get(root);
	if (cached) return cached;
	const entries = await readDir(root);
	const mapped = entries.map((e) => ({
		name: e.name,
		path: `${root}/${e.name}`,
		isDirectory: e.isDirectory,
	}));
	workspaceCache.set(root, mapped);
	return mapped;
}

function fuzzyFilter(entries: FileEntry[], query: string): FileEntry[] {
	if (!query) return entries;
	const lower = query.toLowerCase();
	return entries.filter((e) => e.name.toLowerCase().includes(lower));
}

export function useFileMention(sessionFile: string): UseFileMentionReturn {
	const [state, setState] = useState<"idle" | "active">("idle");
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<FileEntry[]>([]);
	const [allEntries, setAllEntries] = useState<FileEntry[]>([]);
	const [triggerPosition, setTriggerPosition] = useState<number | null>(null);
	const [breadcrumb] = useState("");
	const [loading, setLoading] = useState(true);
	// Reset the workspace when the session changes (each session owns its cwd).
	const sessionRef = useRef(sessionFile);

	// Load the selected session's workspace files; skip while empty
	// (no active session yet — the top render boundary uses "").
	useEffect(() => {
		if (!sessionFile) {
			setLoading(false);
			return;
		}
		sessionRef.current = sessionFile;
		let cancelled = false;
		setLoading(true);
		getWorkspaceFiles(sessionFile)
			.then((entries) => {
				if (cancelled) return;
				setAllEntries(entries);
			})
			.catch(() => {})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [sessionFile]);

	const onInput = useCallback(
		(value: string, cursorPos: number) => {
			// Find the last @ before cursor
			const textBeforeCursor = value.slice(0, cursorPos);
			const atIndex = textBeforeCursor.lastIndexOf("@");
			if (atIndex === -1) {
				setState("idle");
				return;
			}
			// Check if there's whitespace before @ — if not, it's not a mention trigger
			if (
				atIndex > 0 &&
				!/\s/.test(value[atIndex - 1]) &&
				value[atIndex - 1] !== "\n"
			) {
				setState("idle");
				return;
			}
			const q = textBeforeCursor.slice(atIndex + 1);
			setState("active");
			setQuery(q);
			setTriggerPosition(atIndex);
			setResults(fuzzyFilter(allEntries, q));
		},
		[allEntries],
	);

	const selectFile = useCallback(
		(entry: FileEntry): { path: string; name: string } | null => {
			setState("idle");
			setQuery("");
			setTriggerPosition(null);
			return { path: entry.path, name: entry.name };
		},
		[],
	);

	const cancel = useCallback(() => {
		setState("idle");
		setQuery("");
		setTriggerPosition(null);
	}, []);

	return {
		state,
		query,
		results,
		triggerPosition,
		breadcrumb,
		loading,
		onInput,
		selectFile,
		cancel,
	};
}