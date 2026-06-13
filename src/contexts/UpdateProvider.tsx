import { type UseAppUpdate, type UseAppUpdateOptions, useAppUpdate } from "@/hooks/useAppUpdate";
import { type ReactNode, createContext, useContext } from "react";

const UpdateContext = createContext<UseAppUpdate | null>(null);

interface UpdateProviderProps extends UseAppUpdateOptions {
	children: ReactNode;
}

/**
 * Shares a single in-app update state machine across the tree so the launch
 * banner (App) and Settings → About stay in sync (issue #271).
 */
export function UpdateProvider({ children, ...options }: UpdateProviderProps) {
	const update = useAppUpdate(options);
	return <UpdateContext.Provider value={update}>{children}</UpdateContext.Provider>;
}

export function useUpdate(): UseAppUpdate {
	const ctx = useContext(UpdateContext);
	if (!ctx) {
		throw new Error("useUpdate must be used within an UpdateProvider");
	}
	return ctx;
}
