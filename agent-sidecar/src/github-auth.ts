/**
 * github-auth.ts — GitHub device-authorization-grant flow.
 *
 * Uses GitHub's OAuth device flow API directly, so the user gets the
 * standard "enter this code on github.com" experience instead of
 * manually creating and pasting a PAT.
 *
 * After the flow completes, the access token is saved to gh's credential
 * store via `gh auth login --with-token`, so all `gh` CLI commands work.
 *
 * Requires a GitHub OAuth App client_id. Cowork ships with a default
 * client_id (set ZOSMA_GITHUB_CLIENT_ID env var to override).
 */

import { execFileSync } from "node:child_process";

const DEFAULT_CLIENT_ID = "Iv1.8fd2b1b8b8b8b8b8"; // Zosma Cowork OAuth App

interface DeviceCodeResponse {
	device_code: string;
	user_code: string;
	verification_uri: string;
	interval: number;
}

interface TokenResponse {
	access_token?: string;
	error?: string;
	error_description?: string;
}

function clientId(): string {
	return process.env.ZOSMA_GITHUB_CLIENT_ID || DEFAULT_CLIENT_ID;
}

/**
 * Step 1: Request a device code from GitHub.
 * Returns the user_code to show, the verification_uri to link to,
 * and the device_code + interval for polling.
 */
export function requestDeviceCode(): DeviceCodeResponse {
	const url = "https://github.com/login/device/code";
	const data = `client_id=${clientId()}&scope=repo,workflow,read:org,read:user,user:email`;

	const result = execFileSync("curl", [
		"-s",
		"-X", "POST",
		url,
		"-H", "Accept: application/json",
		"-d", data,
	], {
		encoding: "utf-8",
		timeout: 10000,
	});

	const parsed: DeviceCodeResponse & { error?: string } = JSON.parse(result);
	if (parsed.error) {
		throw new Error(`GitHub device code error: ${parsed.error}`);
	}

	return parsed;
}

/**
 * Step 2: Poll for the user to authorize the device.
 * Call this repeatedly (at `interval` seconds) until it returns a token
 * or the flow times out/errors.
 */
export function pollForToken(deviceCode: string, interval: number): TokenResponse {
	const url = "https://github.com/login/oauth/access_token";
	const data = `client_id=${clientId()}&device_code=${deviceCode}&grant_type=urn:ietf:params:oauth:grant-type:device_code`;

	const result = execFileSync("curl", [
		"-s",
		"-X", "POST",
		url,
		"-H", "Accept: application/json",
		"-d", data,
	], {
		encoding: "utf-8",
		timeout: 10000,
	});

	return JSON.parse(result);
}

/**
 * Save a GitHub access token to gh's credential store.
 * After this, `gh auth status` and all gh commands work.
 */
export function saveToken(token: string): void {
	execFileSync("gh", ["auth", "login", "--with-token"], {
		input: token,
		encoding: "utf-8",
		timeout: 10000,
	});
}
