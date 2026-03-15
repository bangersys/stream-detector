/**
 * primedl — scripts/check-version.ts
 *
 * Validates and optionally fixes version parity across:
 *   - package.json
 *   - src/manifest-firefox.json
 *   - src/manifest-chrome.json
 *
 * All three must always be in sync. Run automatically on pre-commit
 * and during CI.
 *
 * Usage:
 *   bun run check-version         → check only, exit 1 on mismatch
 *   bun run sync-version           → fix mismatches, promote to highest version
 *
 * File I/O strategy:
 *   - Bun.file(path).json() for reads — native Bun API, faster than readFileSync
 *   - Bun.write(path, content) for writes — native Bun API, faster than writeFileSync
 *   - node:path for path operations — no Bun alternative
 */

import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const FIX_MODE = process.argv.includes("--fix");

// ─── File paths ────────────────────────────────────────────────────────────
const PACKAGE_PATH = path.join(ROOT, "package.json");
const MANIFEST_FF_PATH = path.join(ROOT, "src", "manifest-firefox.json");
const MANIFEST_CR_PATH = path.join(ROOT, "src", "manifest-chrome.json");

// ─── Helpers ───────────────────────────────────────────────────────────────

async function readJson(filePath: string): Promise<Record<string, unknown>> {
	return Bun.file(filePath).json();
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
	// Match existing style: tab-indented JSON with a trailing newline
	await Bun.write(filePath, `${JSON.stringify(data, null, "\t")}\n`);
}

/**
 * Compare two semver strings and return the higher one.
 * Falls back gracefully if either is missing.
 */
function higherVersion(a: string | undefined, b: string | undefined): string {
	if (!a) return b ?? "0.0.0";
	if (!b) return a;

	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);

	for (let i = 0; i < 3; i++) {
		const na = pa[i] ?? 0;
		const nb = pb[i] ?? 0;
		if (na > nb) return a;
		if (na < nb) return b;
	}
	return a; // equal
}

// ─── Main ──────────────────────────────────────────────────────────────────

let exitCode = 0;

try {
	const [pkg, mFF, mCR] = await Promise.all([
		readJson(PACKAGE_PATH),
		readJson(MANIFEST_FF_PATH),
		readJson(MANIFEST_CR_PATH)
	]);

	const pkgVer = pkg.version as string;
	const ffVer = mFF.version as string;
	const crVer = mCR.version as string;

	console.log(`package.json         : ${pkgVer}`);
	console.log(`manifest-firefox.json: ${ffVer}`);
	console.log(`manifest-chrome.json : ${crVer}`);

	const allMatch = pkgVer === ffVer && ffVer === crVer;

	if (allMatch) {
		console.log(`\n✅  All versions in sync: ${pkgVer}`);
		process.exit(0);
	}

	// Mismatch
	console.warn("\n⚠️  Version mismatch detected.");

	if (!FIX_MODE) {
		console.error("❌  Run `bun run sync-version` to fix.");
		process.exit(1);
	}

	// Fix mode — promote to the highest version across all three
	const latest = higherVersion(higherVersion(pkgVer, ffVer), crVer);
	console.log(`\n🔧  Promoting all versions to ${latest}…`);

	pkg.version = latest;
	await writeJson(PACKAGE_PATH, pkg);
	console.log(`   ✓ package.json → ${latest}`);

	mFF.version = latest;
	await writeJson(MANIFEST_FF_PATH, mFF);
	console.log(`   ✓ manifest-firefox.json → ${latest}`);

	mCR.version = latest;
	await writeJson(MANIFEST_CR_PATH, mCR);
	console.log(`   ✓ manifest-chrome.json → ${latest}`);

	console.log(`\n✅  Fixed — all versions now ${latest}`);
} catch (err) {
	console.error("❌  check-version error:", (err as Error).message);
	exitCode = 1;
}

process.exit(exitCode);
