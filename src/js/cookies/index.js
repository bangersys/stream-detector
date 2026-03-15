/**
 * primedl — cookies/index.js
 *
 * Main public API for the cookies module.
 *
 * Internal module layout:
 *   get_all_cookies.js  — getAllCookies() with partitionKey + storeId support
 *   format.js           — cookie serializers (netscape / json / header)
 *   save.js             — chrome.downloads-based file export
 *   index.js            — high-level helpers used by background.js + popup.js
 *
 * This file is the only one that should be imported by code outside the
 * cookies/ directory. Re-exports the low-level pieces that consumers need
 * and provides two high-level helpers with sensible defaults.
 */

import { DEFAULT_FORMAT, FORMAT_MAP, serializeCookies, toNetscapeRows } from "./format.js";
import { getAllCookies } from "./get_all_cookies.js";
import { downloadCookiesFile } from "./save.js";

// Re-export everything so consumers can import from one place
export {
	DEFAULT_FORMAT,
	downloadCookiesFile,
	FORMAT_MAP,
	getAllCookies,
	serializeCookies,
	toNetscapeRows
};

// ─── Detect Firefox once at module load ───────────────────────────────────
// Consistent with the pattern used throughout the rest of the extension.
const IS_FIREFOX = !chrome.runtime.getURL("").startsWith("chrome-extension://");

// ─── High-level API ───────────────────────────────────────────────────────

/**
 * Get all cookies for a tab URL and return them in three ready-to-use formats.
 * Used by background.js when a stream is detected — the tab context (storeId)
 * is resolved automatically from the currently active tab.
 *
 * @param {string | null | undefined} tabUrl
 * @returns {Promise<{ cookies: chrome.cookies.Cookie[], netscape: string, cookieHeader: string }>}
 */
export async function getCookiesForUrl(tabUrl) {
	// Guard against about:, chrome:, moz-extension:, etc.
	if (!tabUrl || !tabUrl.startsWith("http")) {
		return { cookies: [], netscape: "", cookieHeader: "" };
	}

	let url;
	try {
		url = new URL(tabUrl);
	} catch {
		return { cookies: [], netscape: "", cookieHeader: "" };
	}

	let cookies = [];
	try {
		cookies = await getAllCookies({
			url: tabUrl,
			partitionKey: { topLevelSite: url.origin }
		});
	} catch (err) {
		console.warn("[primedl/cookies] getCookiesForUrl failed:", err);
	}

	return {
		cookies,
		netscape: serializeCookies(cookies, "netscape"),
		cookieHeader: serializeCookies(cookies, "header")
	};
}

/**
 * Get all cookies for the given URL and serialize them in the requested format.
 * Used by popup.js for the cookie export / copy UI.
 *
 * @param {string} tabUrl
 * @param {string} formatKey - "netscape" | "json" | "header"
 * @returns {Promise<{ cookies: chrome.cookies.Cookie[], text: string }>}
 */
export async function getCookiesForPopup(tabUrl, formatKey = DEFAULT_FORMAT) {
	if (!tabUrl || !tabUrl.startsWith("http")) {
		return { cookies: [], text: "" };
	}

	let url;
	try {
		url = new URL(tabUrl);
	} catch {
		return { cookies: [], text: "" };
	}

	let cookies = [];
	try {
		cookies = await getAllCookies({
			url: tabUrl,
			partitionKey: { topLevelSite: url.origin }
		});
	} catch (err) {
		console.warn("[primedl/cookies] getCookiesForPopup failed:", err);
	}

	return {
		cookies,
		text: cookies.length > 0 ? serializeCookies(cookies, formatKey) : ""
	};
}

/**
 * Get ALL cookies in the browser (every domain, all stores) and serialize them.
 * Used by the "Export All" button in the popup.
 *
 * @param {string} formatKey - "netscape" | "json" | "header"
 * @returns {Promise<{ cookies: chrome.cookies.Cookie[], text: string }>}
 */
export async function getAllBrowserCookies(formatKey = DEFAULT_FORMAT) {
	let cookies = [];
	try {
		// Empty partitionKey {} = match all partition keys (all cookies)
		cookies = await getAllCookies({ partitionKey: {} });
	} catch (err) {
		console.warn("[primedl/cookies] getAllBrowserCookies failed:", err);
	}

	return {
		cookies,
		text: cookies.length > 0 ? serializeCookies(cookies, formatKey) : ""
	};
}

/**
 * Save cookie text to a file.
 * On Firefox, popups cannot call saveAs — the download is routed through
 * the background script via chrome.runtime.sendMessage.
 * On Chrome, the popup calls chrome.downloads directly.
 *
 * @param {string} text       - serialized cookie text
 * @param {string} hostname   - used to build the default filename
 * @param {string} formatKey  - "netscape" | "json" | "header"
 * @param {boolean} saveAs    - true = show system Save As dialog
 * @returns {Promise<void>}
 */
export async function saveCookiesFromPopup(text, hostname, formatKey, saveAs = false) {
	const filename = hostname ? `${hostname}_cookies` : "cookies";

	if (IS_FIREFOX) {
		// Firefox popup cannot call saveAs — delegate to background
		await chrome.runtime.sendMessage({
			type: "cookieSave",
			target: "background",
			data: { text, filename, formatKey, saveAs }
		});
	} else {
		// Chrome popup can download directly
		await downloadCookiesFile(text, filename, formatKey, saveAs);
	}
}
