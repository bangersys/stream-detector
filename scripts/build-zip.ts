/**
 * primedl — scripts/build-zip.ts
 *
 * Packages the built extension into a .zip file for store submission.
 * Must be run AFTER `bun run build:firefox` or `bun run build:chrome`.
 *
 * Usage:
 *   bun run build:zip:firefox    → dist/primedl-firefox-x.y.z.zip
 *   bun run build:zip:chrome     → dist-chrome/ → dist/primedl-chrome-x.y.z.zip
 *   bun run build:zip            → both targets
 *
 * The zip contains only the extension files — no source, no node_modules.
 * Chrome Web Store and AMO both accept a flat zip of the extension directory.
 *
 * Requires: system `zip` (Linux/macOS) or PowerShell (Windows).
 */

import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "fs";
import { readFile } from "fs/promises";
import path from "path";

const ROOT = path.resolve(import.meta.dir, "..");
const DIST_FF = path.join(ROOT, "dist");
const DIST_CR = path.join(ROOT, "dist-chrome");
const ZIP_OUT_DIR = path.join(ROOT, "dist");

const args = process.argv.slice(2);
const doFirefox = args.includes("--firefox") || args.includes("--all") || args.length === 0;
const doChrome = args.includes("--chrome") || args.includes("--all") || args.length === 0;

// ─── Read version from package.json ───────────────────────────────────────
async function getVersion() {
	const raw = await readFile(path.join(ROOT, "package.json"), "utf-8");
	const pkg = JSON.parse(raw) as { version?: string };
	return pkg.version ?? "0.0.0";
}

// ─── Build a zip for one target ───────────────────────────────────────────
async function buildZip(target: "firefox" | "chrome") {
	const srcDir = target === "firefox" ? DIST_FF : DIST_CR;
	const version = await getVersion();
	const zipName = `primedl-${target}-${version}.zip`;
	const zipPath = path.join(ZIP_OUT_DIR, zipName);

	// Guard: dist directory must exist and be non-empty
	if (!existsSync(srcDir) || readdirSync(srcDir).length === 0) {
		console.error(`[build-zip] ❌  ${srcDir} is empty — run build:${target} first`);
		process.exit(1);
	}

	mkdirSync(ZIP_OUT_DIR, { recursive: true });

	// Remove previous zip for this version if it exists
	if (existsSync(zipPath)) {
		unlinkSync(zipPath);
	}

	console.log(`[build-zip] Packing ${target} → ${zipName}`);

	// Shell out to system zip (Linux/macOS) — most reliable for extension packaging
	const proc = Bun.spawn(["zip", "-r", "-q", zipPath, "."], {
		cwd: srcDir,
		stdout: "pipe",
		stderr: "pipe"
	});

	const exitCode = await proc.exited;

	if (exitCode !== 0) {
		const stderr = await new Response(proc.stderr).text();
		console.error(`[build-zip] zip failed (exit ${exitCode}): ${stderr.trim()}`);

		// Fallback for Windows developers using PowerShell
		if (process.platform === "win32") {
			console.log("[build-zip] Trying PowerShell fallback…");
			const ps = Bun.spawn(
				[
					"powershell",
					"-Command",
					`Compress-Archive -Path '${srcDir}\\*' -DestinationPath '${zipPath}' -Force`
				],
				{ stdout: "pipe", stderr: "pipe" }
			);
			const psExit = await ps.exited;
			if (psExit !== 0) {
				const psErr = await new Response(ps.stderr).text();
				console.error(`[build-zip] PowerShell fallback failed: ${psErr.trim()}`);
				process.exit(1);
			}
		} else {
			process.exit(1);
		}
	}

	// Report final size
	if (existsSync(zipPath)) {
		const kb = (statSync(zipPath).size / 1024).toFixed(1);
		console.log(`[build-zip] ✅  ${zipName} (${kb} KB)`);
	}
}

// ─── Main ──────────────────────────────────────────────────────────────────
(async () => {
	if (doFirefox) await buildZip("firefox");
	if (doChrome) await buildZip("chrome");
})().catch((e) => {
	console.error("[build-zip] Fatal:", e);
	process.exit(1);
});
