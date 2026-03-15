/**
 * primedl — scripts/build-zip.ts
 *
 * Packages the built extension into a .zip file for store submission.
 * Must be run AFTER `bun run build:firefox` or `bun run build:chrome`.
 *
 * Usage:
 *   bun run build:zip:firefox    → dist/ → dist/primedl-firefox-x.y.z.zip
 *   bun run build:zip:chrome     → dist-chrome/ → dist/primedl-chrome-x.y.z.zip
 *   bun run build:zip            → both targets
 *
 * The zip contains only the extension files — no source, no node_modules.
 * Chrome Web Store and AMO both accept a flat zip of the extension directory.
 */

import { existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { readFile, writeFile } from "fs/promises";
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
	const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf-8"));
	return pkg.version ?? "0.0.0";
}

// ─── Collect all files recursively from a directory ───────────────────────
function collectFiles(dir: string, baseDir: string = dir): { abs: string; rel: string }[] {
	const results: { abs: string; rel: string }[] = [];

	for (const entry of readdirSync(dir)) {
		const abs = path.join(dir, entry);
		const rel = path.relative(baseDir, abs).replace(/\\/g, "/"); // normalize Windows paths
		const stat = statSync(abs);

		if (stat.isDirectory()) {
			results.push(...collectFiles(abs, baseDir));
		} else {
			results.push({ abs, rel });
		}
	}

	return results;
}

// ─── Build a zip for one target using Bun's zip-like approach ─────────────
// Bun doesn't have a built-in zip API yet, so we shell out to the system zip
// command. This works on Linux/macOS. On Windows, use WSL or PowerShell's
// Compress-Archive (rare for extension dev workflows).
async function buildZip(target: "firefox" | "chrome") {
	const srcDir = target === "firefox" ? DIST_FF : DIST_CR;
	const version = await getVersion();
	const zipName = `primedl-${target}-${version}.zip`;
	const zipPath = path.join(ZIP_OUT_DIR, zipName);

	if (!existsSync(srcDir) || readdirSync(srcDir).length === 0) {
		console.error(`[build-zip] ❌  ${srcDir} is empty — run build:${target} first`);
		process.exit(1);
	}

	mkdirSync(ZIP_OUT_DIR, { recursive: true });

	// Remove old zip if it exists
	if (existsSync(zipPath)) {
		await Bun.file(zipPath).text().then(() => {
			const { unlinkSync } = require("fs");
			unlinkSync(zipPath);
		}).catch(() => {});
	}

	console.log(`[build-zip] Packing ${target} → ${zipName}`);

	// Shell out to zip — most reliable cross-platform approach for now
	const proc = Bun.spawn(["zip", "-r", "-q", zipPath, "."], {
		cwd: srcDir,
		stdout: "pipe",
		stderr: "pipe",
	});

	const exitCode = await proc.exited;
	const stderr = await new Response(proc.stderr).text();

	if (exitCode !== 0) {
		console.error(`[build-zip] zip failed (exit ${exitCode}): ${stderr}`);

		// Fallback: try PowerShell on Windows
		if (process.platform === "win32") {
			console.log("[build-zip] Trying PowerShell fallback…");
			const ps = Bun.spawn(
				[
					"powershell",
					"-Command",
					`Compress-Archive -Path '${srcDir}\\*' -DestinationPath '${zipPath}' -Force`,
				],
				{ stdout: "pipe", stderr: "pipe" }
			);
			const psExit = await ps.exited;
			if (psExit !== 0) {
				const psErr = await new Response(ps.stderr).text();
				console.error(`[build-zip] PowerShell fallback failed: ${psErr}`);
				process.exit(1);
			}
		} else {
			process.exit(1);
		}
	}

	// Verify the zip was created and report size
	if (existsSync(zipPath)) {
		const size = statSync(zipPath).size;
		const kb = (size / 1024).toFixed(1);
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