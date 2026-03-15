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

const STATIC_DIRS = ["css", "img", "_locales"];
// fouc.js: synchronous FOUC-prevention script, must NOT be bundled as ESM.
// Chrome MV3 CSP blocks inline scripts so it must be an external static file.
const STATIC_FILES = ["popup.html", "sidebar.html", "options.html", "fouc.js", "favicon.ico"];

async function buildTarget(target: "firefox" | "chrome") {
	const outDir = target === "firefox" ? DIST_FF : DIST_CR;
	const manifestSrc =
		target === "firefox" ? "src/manifest-firefox.json" : "src/manifest-chrome.json";

	console.log(`\n[primedl] Building ${target} → ${outDir}`);

	await rm(outDir, { recursive: true, force: true });
	await mkdir(outDir, { recursive: true });
	await mkdir(path.join(outDir, "js"), { recursive: true });

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

	// Copy manifest — Bun native
	await Bun.write(path.join(outDir, "manifest.json"), await Bun.file(manifestSrc).text());

	// Copy static files
	for (const file of STATIC_FILES) {
		try {
			await cp(path.join(SRC, file), path.join(outDir, file));
		} catch {
			/* optional */
		}
	}

	// Copy static dirs
	for (const dir of STATIC_DIRS) {
		try {
			await cp(path.join(SRC, dir), path.join(outDir, dir), { recursive: true });
		} catch {
			/* optional */
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
