import { useCallback, useEffect, useState } from "react";
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

let cachedEntries: FileEntry[] | null = null;

async function getWorkspaceFiles(): Promise<FileEntry[]> {
	if (cachedEntries) return cachedEntries;
	const root: string = await invoke("get_workspace");
	const entries = await readDir(root);
	cachedEntries = entries.map((e) => ({
		name: e.name,
		path: `${root}/${e.name}`,
		isDirectory: e.isDirectory,
	}));
	return cachedEntries;
}

function fuzzyFilter(entries: FileEntry[], query: string): FileEntry[] {
	if (!query) return entries;
	const lower = query.toLowerCase();
	return entries.filter((e) => e.name.toLowerCase().includes(lower));
}

export function useFileMention(): UseFileMentionReturn {
	const [state, setState] = useState<"idle" | "active">("idle");
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<FileEntry[]>([]);
	const [allEntries, setAllEntries] = useState<FileEntry[]>([]);
	const [triggerPosition, setTriggerPosition] = useState<number | null>(null);
	const [breadcrumb] = useState("");
	const [loading, setLoading] = useState(true);

	// Load workspace files once
	useEffect(() => {
		getWorkspaceFiles()
			.then(setAllEntries)
			.catch(() => {})
			.finally(() => setLoading(false));
	}, []);

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
