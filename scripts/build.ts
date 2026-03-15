/**
 * primedl extension build script
 * Uses Bun's native bundler — zero Parcel dependency.
 *
 * Usage:
 *   bun run scripts/build.ts --firefox
 *   bun run scripts/build.ts --chrome
 *   bun run scripts/build.ts --all
 *   bun run scripts/build.ts --firefox --watch
 *
 * File I/O strategy:
 *   - Bun.file(path).text() for reading the manifest — Bun-native
 *   - Bun.write(path, content) for writing the manifest — Bun-native
 *   - node:fs/promises for rm, mkdir, cp — no Bun-native equivalents yet
 *   - node:fs for watch — no Bun-native equivalent
 *   - node:path for path operations
 */

import { watch } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

// ─── CLI args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const buildFirefox = args.includes("--firefox") || args.includes("--all");
const buildChrome = args.includes("--chrome") || args.includes("--all");
const watchMode = args.includes("--watch");

if (!buildFirefox && !buildChrome) {
	console.error("Error: specify --firefox, --chrome, or --all");
	process.exit(1);
}

// ─── Paths ─────────────────────────────────────────────────────────────────
const SRC = path.resolve("src");
const DIST_FF = path.resolve("dist");
const DIST_CR = path.resolve("dist-chrome");

// JS entry points — each becomes its own output file
const JS_ENTRIES = ["src/js/background.js", "src/js/popup.js", "src/js/options.js"];

// Static assets to copy verbatim (relative to src/)
const STATIC_DIRS = ["css", "img", "_locales"];
// fouc.js: plain synchronous script for FOUC prevention.
// Must NOT be bundled as an ES module (no type="module", no imports).
// Chrome MV3 CSP blocks inline scripts so this must be an external file.
const STATIC_FILES = ["popup.html", "sidebar.html", "options.html", "fouc.js", "favicon.ico"];

// ─── Build one target ──────────────────────────────────────────────────────
async function buildTarget(target: "firefox" | "chrome") {
	const outDir = target === "firefox" ? DIST_FF : DIST_CR;
	const manifestSrc =
		target === "firefox" ? "src/manifest-firefox.json" : "src/manifest-chrome.json";

	console.log(`\n[primedl] Building ${target} → ${outDir}`);

	// Clean output
	await rm(outDir, { recursive: true, force: true });
	await mkdir(outDir, { recursive: true });
	await mkdir(path.join(outDir, "js"), { recursive: true });

	// Bundle JS entry points
	const result = await Bun.build({
		entrypoints: JS_ENTRIES,
		outdir: path.join(outDir, "js"),
		target: "browser",
		format: "esm",
		splitting: false,
		minify: !watchMode,
		sourcemap: watchMode ? "inline" : "none",
		define: {
			"process.env.NODE_ENV": JSON.stringify(watchMode ? "development" : "production")
		}
	});

	if (!result.success) {
		for (const msg of result.logs) {
			console.error("[build error]", msg);
		}
		throw new Error(`JS build failed for ${target}`);
	}

	// Also bundle the content script (keepalive)
	const contentResult = await Bun.build({
		entrypoints: ["src/content/keepalive.js"],
		outdir: path.join(outDir, "content"),
		target: "browser",
		format: "esm",
		splitting: false,
		minify: !watchMode,
		sourcemap: watchMode ? "inline" : "none"
	});

	if (!contentResult.success) {
		for (const msg of contentResult.logs) {
			console.error("[build error]", msg);
		}
		throw new Error(`Content script build failed for ${target}`);
	}

	// Copy manifest — read with Bun-native API, write to dest
	const manifest = await Bun.file(manifestSrc).text();
	await Bun.write(path.join(outDir, "manifest.json"), manifest);

	// Copy static HTML + JS files
	for (const file of STATIC_FILES) {
		const src = path.join(SRC, file);
		const dest = path.join(outDir, file);
		try {
			await cp(src, dest);
		} catch {
			// optional files — skip if not found
		}
	}

	// Copy static asset directories
	for (const dir of STATIC_DIRS) {
		const src = path.join(SRC, dir);
		const dest = path.join(outDir, dir);
		try {
			await cp(src, dest, { recursive: true });
		} catch {
			// skip missing dirs
		}
	}

	// Report output sizes
	for (const output of result.outputs) {
		const kb = (output.size / 1024).toFixed(1);
		console.log(`  ✓ ${path.relative(outDir, output.path)} (${kb} KB)`);
	}

	console.log(`[primedl] ${target} build complete → ${outDir}`);
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
	if (buildFirefox) await buildTarget("firefox");
	if (buildChrome) await buildTarget("chrome");

	if (watchMode) {
		const target = buildFirefox ? "firefox" : "chrome";
		console.log(`\n[primedl] Watching src/ for changes (${target})…`);

		let debounceTimer: ReturnType<typeof setTimeout> | null = null;

		watch(SRC, { recursive: true }, (_event: string, filename: string | null) => {
			if (!filename) return;
			if (debounceTimer) clearTimeout(debounceTimer);
			debounceTimer = setTimeout(async () => {
				console.log(`[primedl] Changed: ${filename} — rebuilding…`);
				try {
					await buildTarget(target);
				} catch (e) {
					console.error("[primedl] Rebuild error:", e);
				}
			}, 120);
		});
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
