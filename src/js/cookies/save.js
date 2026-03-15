/**
 * primedl — cookies/save.js
 *
 * Cookie file saving via chrome.downloads API.
 * Ported and adapted from kairi003/Get-cookies.txt-LOCALLY (MIT).
 *
 * Key behaviors:
 * - Creates a Blob URL and passes it to chrome.downloads.download()
 * - Waits for the download to leave "in_progress" state before revoking the
 *   Blob URL. Revoking too early causes broken downloads on Firefox.
 * - Firefox cannot call saveAs from a popup script (it silently fails).
 *   The popup detects Firefox and routes the save request through the
 *   background script instead. This module handles both cases:
 *     • downloadCookiesFile() — direct, called from background.js on Firefox
 *       or directly from popup.js on Chrome
 *   The routing itself lives in index.js / popup.js.
 */

import { FORMAT_MAP } from "./format.js";

/**
 * Download serialized cookie text as a file via chrome.downloads.
 *
 * @param {string} text        - serialized cookie content
 * @param {string} name        - base filename (without extension)
 * @param {string} formatKey   - one of "netscape", "json", "header"
 * @param {boolean} saveAs     - true = show system Save As dialog
 * @returns {Promise<void>}
 */
export async function downloadCookiesFile(text, name, formatKey, saveAs = false) {
	const format = FORMAT_MAP[formatKey];
	if (!format) throw new Error(`Unknown format: "${formatKey}"`);

	const blob = new Blob([text], { type: format.mimeType });
	const filename = sanitizeFilename(name) + format.ext;
	const url = URL.createObjectURL(blob);

	let downloadId;
	try {
		downloadId = await chrome.downloads.download({ url, filename, saveAs });
	} catch (err) {
		URL.revokeObjectURL(url);
		throw err;
	}

	// Revoke the Blob URL only AFTER the download has left in_progress.
	// Firefox fails silently if the URL is revoked while still downloading.
	const onChanged = (delta) => {
		if (delta.id !== downloadId) return;
		const state = delta.state?.current;
		if (state && state !== "in_progress") {
			chrome.downloads.onChanged.removeListener(onChanged);
			URL.revokeObjectURL(url);
		}
	};

	chrome.downloads.onChanged.addListener(onChanged);
}

/**
 * Sanitize a string for use as a filename.
 * Replaces characters that are invalid on Windows / macOS / Linux.
 *
 * @param {string} name
 * @returns {string}
 */
function sanitizeFilename(name) {
	return name.replace(/[/\\?%*:|"<>]/g, "_");
}