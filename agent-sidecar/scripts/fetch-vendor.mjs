// Fetch and pin vendored pi extensions used by the agent sidecar.
//
// Runs as `agent-sidecar/package.json`'s `postinstall` so every `npm ci`
// (CI, local dev, tauri's beforeBuildCommand) populates the vendor tree
// before tsc / esbuild see it. Idempotent: skips the clone when the local
// `.bridge-commit` marker already matches the resolved commit.
//
// PINNING MODEL
// -------------
// Each entry pins EITHER a release `tag` (preferred for repos we own) or a
// raw `commit` (for third-party repos without releases). Tag-pinned entries
// are tamper-evident: we resolve the tag to its commit SHA and assert it
// matches the SHA recorded in the committed lockfile (`vendor.lock.json`).
// If a tag is ever re-pointed/force-pushed to a different commit, the build
// fails loudly instead of silently shipping different code. Run
// `npm run vendor:latest` to adopt a newer release (it rewrites the tag and
// the lock entry, which then lands in a reviewed PR).
//
// WHY TAGS FOR pi-routines: we ship only *verified* releases. The
// zosmaai/pi-routines fork gates `vX.Y.Z` tags behind CI (typecheck + tests),
// so a tag is a stronger guarantee than an arbitrary commit. Source of truth:
// github.com/zosmaai/pi-routines.
//
// pi-anthropic-messages is required for Claude Pro/Max OAuth to work
// against the anthropic-messages endpoint — see
// `agent-sidecar/src/vendor/anthropic-messages/README.md` for the
// protocol details. Without the bridge, Anthropic fingerprints our
// requests as "third-party app" and rejects them with the extra-usage
// 400 error. It's third-party (no releases we control), so it stays
// commit-pinned.

import { execSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sidecarDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Committed lockfile (lives OUTSIDE the gitignored vendor tree) mapping each
// vendored name → the exact { ref, sha } we expect. Tamper-evident pin.
export const LOCKFILE = join(sidecarDir, "vendor.lock.json");

export const VENDORED = [
	{
		name: "anthropic-messages",
		repo: "https://github.com/BlackBeltTechnology/pi-anthropic-messages.git",
		// v0.3.1 — peer dep targets @earendil-works/pi-coding-agent (our fork),
		// so no type-patching is needed at build time. Third-party repo, so
		// commit-pinned rather than tag-pinned.
		commit: "5370ac3",
		// Directories/files in the upstream tree we don't need at build time.
		trim: [".git", "__tests__", "openspec", ".pi", "CHANGELOG.md"],
	},
	{
		name: "pi-routines",
		// Pinned to v0.1.2, which carries the #328 fireTask fix
		// (remove-after-success + in-flight guard + bounded retry).
		// DEPENDS ON zosmaai/pi-routines#2 — merge that first and tag v0.1.2
		// upstream before merging this PR (it's marked draft until then). If the
		// upstream v0.1.2 tag lands on a different commit than the lock records
		// (e.g. squash merge), run `npm run vendor:latest` to re-lock.
		repo: "https://github.com/zosmaai/pi-routines.git",
		// Forked scheduler fired ONLY inside Cowork (sets
		// globalThis.__PI_ROUTINES_ON_FIRE). Imported from src/index.ts; see
		// agent-sidecar/src/index.ts. Pinned to a VERIFIED release tag — bump
		// via `npm run vendor:latest` to pull the latest stable release.
		tag: "v0.1.2",
		// GitHub repo slug used by `vendor:latest` to query the latest release.
		releaseRepo: "zosmaai/pi-routines",
		trim: [".git", ".github", "src/index.test.ts", "src/cronScheduler.test.ts", "node_modules"],
		// The fork's relative imports use `.ts` extensions (jiti-friendly). The
		// sidecar's tsc *emits*, which forbids importing `.ts` extensions, so
		// rewrite them to `.js` in the cloned tree.
		rewriteTsExtensions: true,
	},
];

/** Recursively rewrite relative `.ts` import specifiers to `.js`. */
function rewriteTsImports(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			rewriteTsImports(full);
		} else if (entry.name.endsWith(".ts")) {
			const src = readFileSync(full, "utf-8");
			const out = src.replace(
				/((?:from|import)\s*\(?\s*["'])(\.[^"']*?)\.ts(["'])/g,
				"$1$2.js$3",
			);
			if (out !== src) writeFileSync(full, out, "utf-8");
		}
	}
}

/** Load the committed lockfile (or {} if it doesn't exist yet). */
export function readLock() {
	if (!existsSync(LOCKFILE)) return {};
	return JSON.parse(readFileSync(LOCKFILE, "utf-8"));
}

export function writeLock(lock) {
	// Stable key order for clean diffs.
	const ordered = Object.fromEntries(
		Object.keys(lock)
			.sort()
			.map((k) => [k, lock[k]]),
	);
	writeFileSync(LOCKFILE, `${JSON.stringify(ordered, null, "\t")}\n`, "utf-8");
}

/** Resolve a release tag to its commit SHA on the remote (annotated-tag aware). */
export function resolveTagSha(repo, tag) {
	// `--refs` strips the `^{}` peeled entry for lightweight tags; for annotated
	// tags we want the peeled (commit) SHA, so query both and prefer `^{}`.
	const out = execSync(`git ls-remote --tags ${repo} "refs/tags/${tag}" "refs/tags/${tag}^{}"`, {
		encoding: "utf-8",
	}).trim();
	if (!out) throw new Error(`tag "${tag}" not found on ${repo}`);
	const lines = out.split("\n").map((l) => l.split("\t"));
	const peeled = lines.find(([, ref]) => ref.endsWith("^{}"));
	const direct = lines.find(([, ref]) => ref === `refs/tags/${tag}`);
	const sha = (peeled ?? direct)[0];
	return sha;
}

/** Resolve the pinned ref for an entry → { ref, sha }, verifying the lock. */
function resolvePin(v, lock) {
	if (v.commit) {
		return { ref: v.commit, sha: v.commit };
	}
	if (!v.tag) throw new Error(`${v.name}: entry must pin a "tag" or "commit"`);

	const sha = resolveTagSha(v.repo, v.tag);
	const locked = lock[v.name];

	if (locked) {
		if (locked.ref !== v.tag) {
			throw new Error(
				`${v.name}: manifest tag "${v.tag}" != lock ref "${locked.ref}". ` +
					`Run \`npm run vendor:latest\` to re-lock after a deliberate bump.`,
			);
		}
		if (locked.sha !== sha) {
			throw new Error(
				`${v.name}: tag "${v.tag}" now resolves to ${sha} but the lock pins ${locked.sha}. ` +
					`The tag was re-pointed/force-pushed — refusing to ship unverified code. ` +
					`If this change is intended, re-run \`npm run vendor:latest\`.`,
			);
		}
	}
	return { ref: v.tag, sha };
}

function main() {
	const lock = readLock();
	let lockDirty = false;

	for (const v of VENDORED) {
		const { ref, sha } = resolvePin(v, lock);

		// Record/refresh the lock entry the first time we see a tag-pinned dep.
		if (v.tag && !lock[v.name]) {
			lock[v.name] = { ref, sha };
			lockDirty = true;
		}

		const dest = join(sidecarDir, "src", "vendor", v.name);
		const marker = join(dest, ".bridge-commit");
		if (existsSync(marker) && readFileSync(marker, "utf-8").trim() === sha) {
			console.log(`[fetch-vendor] ${v.name} already at ${ref} (${sha.slice(0, 9)})`);
			continue;
		}
		console.log(`[fetch-vendor] cloning ${v.name} @ ${ref} (${sha.slice(0, 9)})…`);
		rmSync(dest, { recursive: true, force: true });
		mkdirSync(dest, { recursive: true });
		// `core.longpaths=true` keeps Windows checkouts from failing on paths >260
		// chars (MAX_PATH) if a vendored repo ever carries deeply nested files.
		execSync(`git -c core.longpaths=true clone --quiet ${v.repo} "${dest}"`, {
			stdio: "inherit",
		});
		execSync(`git -C "${dest}" -c core.longpaths=true checkout --quiet ${sha}`, {
			stdio: "inherit",
		});
		for (const trash of v.trim) {
			rmSync(join(dest, trash), { recursive: true, force: true });
		}
		if (v.rewriteTsExtensions) {
			rewriteTsImports(dest);
		}
		writeFileSync(marker, `${sha}\n`, "utf-8");
		console.log(`[fetch-vendor] ${v.name} ready`);
	}

	if (lockDirty) {
		writeLock(lock);
		console.log(`[fetch-vendor] wrote ${LOCKFILE}`);
	}
}

// Only fetch when run directly (`node scripts/fetch-vendor.mjs`); stay a pure
// module when imported (e.g. by scripts/vendor-latest.mjs).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main();
}
