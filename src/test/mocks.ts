import { vi } from "vitest";

// Hoisted mock factories — vi.mock() callbacks are hoisted above imports,
// so they can only reference values created with vi.hoisted().
const mockInvokeFn = vi.hoisted(() => vi.fn());
const mockReadTextFileFn = vi.hoisted(() => vi.fn());
const mockReadFileFn = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
	invoke: mockInvokeFn,
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
	readTextFile: mockReadTextFileFn,
	readFile: mockReadFileFn,
}));

/**
 * Mock Tauri `invoke` function.
 * Provide an optional implementation for specific commands.
 */
export function mockInvoke(
	impl?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>,
) {
	if (impl) mockInvokeFn.mockImplementation(impl);
	return mockInvokeFn;
}

/**
 * Mock @tauri-apps/plugin-fs readTextFile.
 */
export function mockReadTextFile(impl?: (path: string) => Promise<string>) {
	if (impl) mockReadTextFileFn.mockImplementation(impl);
	return mockReadTextFileFn;
}

/**
 * Mock @tauri-apps/plugin-fs readFile (binary).
 */
export function mockReadFile(impl?: (path: string) => Promise<Uint8Array>) {
	if (impl) mockReadFileFn.mockImplementation(impl);
	return mockReadFileFn;
}

/**
 * Restore all Vitest mocks.
 */
export function cleanupMocks() {
	vi.restoreAllMocks();
}
