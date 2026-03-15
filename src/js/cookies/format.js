/**
 * primedl — cookies/format.js
 *
 * Cookie serialization formats. Ported and extended from
 * kairi003/Get-cookies.txt-LOCALLY (MIT).
 *
 * Supported formats:
 *   netscape — Netscape cookies.txt, compatible with yt-dlp, curl, wget
 *   json     — Raw JSON array, useful for debugging / custom tooling
 *   header   — Cookie HTTP header string (name=value; name=value2)
 *
 * For yt-dlp specifically, the Netscape format is what you pass to
 * --cookies <file> or embed in the relay payload so primedl can write it
 * to a temp file before invoking yt-dlp.
 */

/**
 * All available cookie format keys.
 * @type {Record<string, { ext: string, mimeType: string, label: string, serializer: (cookies: chrome.cookies.Cookie[]) => string }>}
 */
export const FORMAT_MAP = {
	netscape: {
		ext: ".txt",
		mimeType: "text/plain",
		label: "Netscape (.txt)",
		serializer: serializeNetscape
	},
	json: {
		ext: ".json",
		mimeType: "application/json",
		label: "JSON",
		serializer: serializeJson
	},
	header: {
		ext: ".txt",
		mimeType: "text/plain",
		label: "Header string",
		serializer: serializeHeader
	}
};

/** Default format key */
export const DEFAULT_FORMAT = "netscape";

/**
 * Serialize cookies using the named format.
 *
 * @param {chrome.cookies.Cookie[]} cookies
 * @param {string} formatKey - one of "netscape", "json", "header"
 * @returns {string}
 */
export function serializeCookies(cookies, formatKey) {
	const format = FORMAT_MAP[formatKey];
	if (!format) throw new Error(`Unknown cookie format: "${formatKey}"`);
	return format.serializer(cookies);
}

/**
 * Convert cookies to a 2D string array in Netscape format.
 * Useful for rendering a cookie table in the popup UI.
 *
 * Each row: [domain, includeSubdomains, path, secure, expiry, name, value]
 *
 * @param {chrome.cookies.Cookie[]} cookies
 * @returns {string[][]}
 */
export function toNetscapeRows(cookies) {
	return cookies.map(({ domain, expirationDate, path, secure, name, value }) => {
		const includeSubDomain = !!domain?.startsWith(".");
		// .toFixed() prevents scientific notation on large timestamps
		const expiry = expirationDate != null ? expirationDate.toFixed() : "0";
		const row = [domain, includeSubDomain, path, secure, expiry, name, value];
		// Convert booleans to uppercase strings (TRUE/FALSE) as Netscape spec requires
		return row.map((v) => (typeof v === "boolean" ? v.toString().toUpperCase() : String(v ?? "")));
	});
}

// ─── Serializers ───────────────────────────────────────────────────────────

/**
 * Netscape cookies.txt — compatible with yt-dlp, curl, wget, MozillaCookieJar.
 * @param {chrome.cookies.Cookie[]} cookies
 * @returns {string}
 */
function serializeNetscape(cookies) {
	const rows = toNetscapeRows(cookies);
	return [
		"# Netscape HTTP Cookie File",
		"# https://curl.haxx.se/rfc/cookie_spec.html",
		"# This is a generated file! Do not edit.",
		"",
		...rows.map((row) => row.join("\t")),
		"" // trailing newline
	].join("\n");
}

/**
 * Raw JSON array — the full chrome.cookies.Cookie object per entry.
 * @param {chrome.cookies.Cookie[]} cookies
 * @returns {string}
 */
function serializeJson(cookies) {
	return JSON.stringify(cookies, null, 2);
}

/**
 * HTTP Cookie header string — "name=value; name2=value2"
 * Ready to paste into curl -H "Cookie: ..." or yt-dlp --add-header.
 * @param {chrome.cookies.Cookie[]} cookies
 * @returns {string}
 */
function serializeHeader(cookies) {
	return cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
}
