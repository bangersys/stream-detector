/**
 * primedl — scripts/check-locales.ts
 *
 * Validates that all locale files in src/_locales/ have the same set of keys.
 * Exits 1 with a diff report if any locale is missing keys relative to en.
 *
 * Usage:
 *   bun run scripts/check-locales.ts
 *
 * Run automatically in CI alongside check-version.ts.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const LOCALES_DIR = path.join(ROOT, "src", "_locales");
const REFERENCE_LOCALE = "en";

async function readMessages(localeDir: string): Promise<Record<string, unknown>> {
	const p = path.join(localeDir, "messages.json");
	return JSON.parse(await readFile(p, "utf-8"));
}

async function main() {
	const entries = await readdir(LOCALES_DIR, { withFileTypes: true });
	const localeDirs = entries
		.filter((e) => e.isDirectory())
		.map((e) => ({ name: e.name, dir: path.join(LOCALES_DIR, e.name) }));

	const referenceDir = localeDirs.find((l) => l.name === REFERENCE_LOCALE);
	if (!referenceDir) {
		console.error(`[check-locales] Reference locale "${REFERENCE_LOCALE}" not found`);
		process.exit(1);
	}

	const reference = await readMessages(referenceDir.dir);
	const referenceKeys = new Set(Object.keys(reference));
	let hasErrors = false;

	console.log(`[check-locales] Reference: ${REFERENCE_LOCALE} (${referenceKeys.size} keys)\n`);

	for (const locale of localeDirs) {
		if (locale.name === REFERENCE_LOCALE) continue;

		let messages: Record<string, unknown>;
		try {
			messages = await readMessages(locale.dir);
		} catch {
			console.error(`  ✗ ${locale.name}: could not read messages.json`);
			hasErrors = true;
			continue;
		}

		const localeKeys = new Set(Object.keys(messages));
		const missing = [...referenceKeys].filter((k) => !localeKeys.has(k));
		const extra = [...localeKeys].filter((k) => !referenceKeys.has(k));

		if (missing.length === 0 && extra.length === 0) {
			console.log(`  ✓ ${locale.name}: all ${localeKeys.size} keys present`);
		} else {
			hasErrors = true;
			if (missing.length > 0) {
				console.error(`  ✗ ${locale.name}: missing ${missing.length} keys:`);
				missing.forEach((k) => {
					console.error(`      - ${k}`);
				});
			}
			if (extra.length > 0) {
				console.warn(`  ⚠ ${locale.name}: ${extra.length} extra keys not in en:`);
				extra.forEach((k) => {
					console.warn(`      + ${k}`);
				});
			}
		}
	}

	console.log();

	if (hasErrors) {
		console.error("[check-locales] ✗ Locale check failed — run merge-locale-additions.ts to sync");
		process.exit(1);
	} else {
		console.log("[check-locales] ✓ All locales in sync");
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
