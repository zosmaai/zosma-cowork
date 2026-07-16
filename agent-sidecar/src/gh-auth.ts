/**
 * Zosma Cowork — GitHub Auth Helpers
 *
 * Wraps the `gh` CLI for auth status, login (device flow), logout, and
 * organization/repo queries. Results are short-lived cached so the UI can
 * revisit the GitHub App tab without re-spawning `gh` on every mount.
 */

import { execFile, execFileSync, spawn } from "node:child_process";
import { promisify } from "node:util";
import { send, log } from "./protocol.js";

const execFileAsync = promisify(execFile);

// ── Cache ──────────────────────────────────────────────────────────────────

interface GhCacheEntry {
	data: unknown;
	at: number;
}

const ghCache = new Map<string, GhCacheEntry>();
const GH_CACHE_TTL = 60_000; // 60s

function ghCacheGet(key: string): unknown | undefined {
	const e = ghCache.get(key);
	if (e && Date.now() - e.at < GH_CACHE_TTL) return e.data;
	return undefined;
}

function ghCacheSet(key: string, data: unknown): void {
	ghCache.set(key, { data, at: Date.now() });
}

function ghCacheClear(): void {
	ghCache.clear();
}

// ── gh CLI helpers ─────────────────────────────────────────────────────────

async function ghJson(args: string[], timeout = 8000): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync("gh", args, { timeout, encoding: "utf-8" });
		return stdout.trim();
	} catch {
		return null;
	}
}

/** Tracks the in-flight `gh auth login` device-flow process, if any. */
let ghAuthProc: ReturnType<typeof spawn> | null = null;

// ── Command handlers ───────────────────────────────────────────────────────

export async function handleGhAuthStatus(id: string): Promise<void> {
	const cached = ghCacheGet("status");
	if (cached !== undefined) {
		send({ type: "result", id, data: cached });
		return;
	}
	const status = await ghJson(["auth", "status", "--json", "hosts"], 5000);
	if (!status) {
		send({ type: "result", id, data: { connected: false } });
		return;
	}
	try {
		const raw = JSON.parse(status);
		const hosts: Record<string, { user: string }> = {};
		for (const [hostname, entries] of Object.entries(raw.hosts ?? {})) {
			const arr = entries as Array<{ login?: string }>;
			if (arr.length > 0 && arr[0].login) {
				hosts[hostname] = { user: arr[0].login };
			}
		}
		const connected = Object.keys(hosts).length > 0;
		const data = { connected, hosts };
		if (connected) ghCacheSet("status", data);
		send({ type: "result", id, data });
	} catch {
		send({ type: "result", id, data: { connected: false } });
	}
}

export async function handleGhOrganizations(id: string): Promise<void> {
	const cachedOrg = ghCacheGet("organizations");
	if (cachedOrg !== undefined) {
		send({ type: "result", id, data: cachedOrg });
		return;
	}
	const [userRaw, orgsRaw, reposRaw, scopesRaw] = await Promise.all([
		ghJson(["api", "user", "--jq", "{login, name, avatar_url, email, public_repos}"], 6000),
		ghJson(
			[
				"api",
				"user/memberships/orgs",
				"--paginate",
				"--jq",
				'[.[] | select(.state == "active") | {login: .organization.login, role: .role, avatar_url: .organization.avatar_url}]',
			],
			8000,
		),
		ghJson(
			[
				"api",
				"graphql",
				"-f",
				"query={viewer{repositories{totalCount}}}",
				"--jq",
				".data.viewer.repositories.totalCount",
			],
			6000,
		),
		ghJson(
			["auth", "status", "--json", "hosts", "--jq", '.hosts["github.com"][0].scopes'],
			5000,
		),
	]);

	if (!userRaw) {
		send({ type: "error", id, message: "Not authenticated" });
		return;
	}
	try {
		const user = JSON.parse(userRaw);
		let orgs: Array<{ login: string; role: string; avatar_url: string }> = [];
		if (orgsRaw) {
			orgs = orgsRaw
				.split("\n")
				.filter((l) => l.trim().startsWith("["))
				.flatMap((l) => JSON.parse(l));
		}
		const totalRepos =
			(reposRaw && Number.parseInt(reposRaw, 10)) ||
			(typeof user.public_repos === "number" ? user.public_repos : 0);
		const scopes = scopesRaw
			? scopesRaw
					.split(",")
					.map((x) => x.trim())
					.filter(Boolean)
			: [];
		const data = { user, orgs, totalRepos, scopes };
		ghCacheSet("organizations", data);
		send({ type: "result", id, data });
	} catch (err: unknown) {
		const errMsg = err instanceof Error ? err.message : String(err);
		log("gh_organizations parse error: %s", errMsg);
		send({ type: "error", id, message: "Not authenticated" });
	}
}

export async function handleGhAuthLogin(id: string, scopesArg?: string): Promise<void> {
	try {
		ghCacheClear();
		if (ghAuthProc && !ghAuthProc.killed) {
			try {
				ghAuthProc.kill();
			} catch {
				/* ignore */
			}
			ghAuthProc = null;
		}

		const scopes = scopesArg?.trim() || "repo,read:org,gist,workflow,read:user,project";

		const child = spawn(
			"gh",
			[
				"auth",
				"login",
				"--hostname",
				"github.com",
				"--git-protocol",
				"https",
				"--web",
				"--scopes",
				scopes,
			],
			{ stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } },
		);
		ghAuthProc = child;

		let buf = "";
		let responded = false;
		const tryRespond = () => {
			if (responded) return;
			const codeMatch = buf.match(/one-time code:\s*([A-Z0-9-]+)/i);
			if (!codeMatch) return;
			const urlMatch = buf.match(/(https:\/\/\S*github\.com\/login\/device)/i);
			responded = true;
			log("gh_auth_login: device code obtained");
			send({
				type: "result",
				id,
				data: {
					code: codeMatch[1],
					url: urlMatch ? urlMatch[1] : "https://github.com/login/device",
					scopes,
				},
			});
		};
		child.stdout?.on("data", (c: Buffer) => {
			buf += c.toString();
			tryRespond();
		});
		child.stderr?.on("data", (c: Buffer) => {
			buf += c.toString();
			tryRespond();
		});
		child.on("error", (err: Error) => {
			log("gh_auth_login spawn error: %s", err.message);
			if (!responded) {
				responded = true;
				send({ type: "error", id, message: err.message });
			}
		});
		child.on("exit", (code) => {
			log("gh_auth_login exited code=%s", String(code));
			if (ghAuthProc === child) ghAuthProc = null;
			ghCacheClear();
		});

		setTimeout(() => {
			if (!responded) {
				responded = true;
				const tail = buf.slice(-300) || "no output";
				send({
					type: "error",
					id,
					message: `Timed out waiting for device code. gh output: ${tail}`,
				});
			}
		}, 15000);
	} catch (err: unknown) {
		const errMsg = err instanceof Error ? err.message : String(err);
		log("gh_auth_login error: %s", errMsg);
		send({ type: "error", id, message: errMsg });
	}
}

export async function handleGhAuthCancel(id: string): Promise<void> {
	if (ghAuthProc && !ghAuthProc.killed) {
		try {
			ghAuthProc.kill();
		} catch {
			/* ignore */
		}
	}
	ghAuthProc = null;
	send({ type: "result", id, data: { cancelled: true } });
}

export async function handleGhAuthLogout(id: string): Promise<void> {
	try {
		execFileSync("gh", ["auth", "logout", "--hostname", "github.com"], {
			encoding: "utf-8",
			timeout: 5000,
		});
		ghCacheClear();
		send({ type: "result", id, data: { success: true } });
	} catch (err: unknown) {
		const errMsg = err instanceof Error ? err.message : String(err);
		send({ type: "error", id, message: errMsg });
	}
}
