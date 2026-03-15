/**
 * primedl extension build script — Bun native bundler.
 *
 * Usage:
 *   bun run scripts/build.ts --firefox
 *   bun run scripts/build.ts --chrome
 *   bun run scripts/build.ts --all
 *   bun run scripts/build.ts --firefox --watch
 */

import { watch } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const buildFirefox = args.includes("--firefox") || args.includes("--all");
const buildChrome = args.includes("--chrome") || args.includes("--all");
const watchMode = args.includes("--watch");

if (!buildFirefox && !buildChrome) {
	console.error("Error: specify --firefox, --chrome, or --all");
	process.exit(1);
}

const SRC = path.resolve("src");
const DIST_FF = path.resolve("dist");
const DIST_CR = path.resolve("dist-chrome");

const JS_ENTRIES = ["src/js/background.js", "src/js/popup.js", "src/js/options.js"];

const STATIC_DIRS = ["css", "img", "_locales", "themes"];
// fouc.js: synchronous FOUC-prevention script, must NOT be bundled as ESM.
// Chrome MV3 CSP blocks inline scripts so it must be an external static file.
const STATIC_FILES = ["popup.html", "sidebar.html", "options.html", "fouc.js", "favicon.ico"];

async function buildTarget(target: "firefox" | "chrome") {
	const outDir = target === "firefox" ? DIST_FF : DIST_CR;
	const manifestSrc =
		target === "firefox" ? "src/manifest-firefox.json" : "src/manifest-chrome.json";

	console.log(`\n[primedl] Building ${target} → ${outDir}`);

	// Clean and recreate output directory
	await rm(outDir, { recursive: true, force: true });
	await mkdir(outDir, { recursive: true });

	// Bundle main JS
	const result = await Bun.build({
		entrypoints: JS_ENTRIES,
		outdir: path.join(outDir, "js"),
		target: "browser",
		format: "esm",
		splitting: false,
		minify: !watchMode,
		sourcemap: watchMode ? "inline" : "none",
		define: { "process.env.NODE_ENV": JSON.stringify(watchMode ? "development" : "production") }
	});

	if (!result.success) {
		for (const msg of result.logs) console.error("[build error]", msg);
		throw new Error(`JS build failed for ${target}`);
	}

	// Bundle content script
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
		for (const msg of contentResult.logs) console.error("[build error]", msg);
		throw new Error(`Content script build failed for ${target}`);
	}

	// Copy manifest — use cp for byte-perfect copy
	await cp(manifestSrc, path.join(outDir, "manifest.json"));

	// Copy static files
	for (const file of STATIC_FILES) {
		const srcPath = path.join(SRC, file);
		const destPath = path.join(outDir, file);
		try {
			await cp(srcPath, destPath);
		} catch (e) {
			console.error(`[build error] Could not copy file ${file}:`, e);
		}
	}

	// Copy static dirs
	for (const dir of STATIC_DIRS) {
		const srcPath = path.join(SRC, dir);
		const destPath = path.join(outDir, dir);
		try {
			await cp(srcPath, destPath, { recursive: true });
		} catch (e) {
			console.error(`[build error] Could not copy directory ${dir}:`, e);
		}
	}

	for (const output of result.outputs) {
		console.log(`  ✓ ${path.relative(outDir, output.path)} (${(output.size / 1024).toFixed(1)} KB)`);
	}
	console.log(`[primedl] ${target} build complete → ${outDir}`);
}

async function main() {
	if (buildFirefox) await buildTarget("firefox");
	if (buildChrome) await buildTarget("chrome");

	if (watchMode) {
		const target = buildFirefox ? "firefox" : "chrome";
		console.log(`\n[primedl] Watching src/ (${target})…`);
		let timer: ReturnType<typeof setTimeout> | null = null;
		watch(SRC, { recursive: true }, (_, filename) => {
			if (!filename) return;
			if (timer) clearTimeout(timer);
			timer = setTimeout(async () => {
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
