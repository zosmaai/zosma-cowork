import { invoke } from '@tauri-apps/api/core';

let _memToken: string | null = null;

export const tokenStore = {
	save: async (token: string): Promise<void> => {
		await invoke<void>('save_token', { token });
		_memToken = token;
	},

	load: async (): Promise<string | null> => {
		const token = await invoke<string | null>('load_token');
		_memToken = token;
		return token;
	},

	clear: async (): Promise<void> => {
		await invoke<void>('clear_token');
		_memToken = null;
	},

	/** Synchronous read of the in-memory copy — no IPC round-trip. */
	getInMemory: (): string | null => _memToken,
};
