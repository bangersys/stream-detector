/**
 * primedl — src/@types/cookies.d.ts
 *
 * Type declarations for the js/cookies/ module.
 * Provides IDE autocompletion and type safety for cookie-related functions
 * without needing to convert the source files to TypeScript.
 */

/** The three serialization format keys the cookies module supports */
type CookieFormatKey = "netscape" | "json" | "header";

/**
 * A cookie format descriptor returned by FORMAT_MAP.
 */
interface CookieFormat {
	/** File extension including the dot, e.g. ".txt" */
	ext: string;
	/** MIME type for the download Blob */
	mimeType: string;
	/** Human-readable label for UI display */
	label: string;
	/** Serializer function: cookies array → formatted string */
	serializer: (cookies: chrome.cookies.Cookie[]) => string;
}

/**
 * Return value from getCookiesForUrl() and getCookiesForPopup().
 */
interface CookieResult {
	cookies: chrome.cookies.Cookie[];
	/** Netscape-format cookies.txt string (for getCookiesForUrl) */
	netscape?: string;
	/** HTTP Cookie header string (for getCookiesForUrl) */
	cookieHeader?: string;
	/** Serialized text in the requested format (for getCookiesForPopup) */
	text?: string;
}

// ─── Module augmentations ──────────────────────────────────────────────────
// These are declared as ambient so the JS source files get typed in the IDE.

declare module "*/cookies/index.js" {
	export const FORMAT_MAP: { [key in CookieFormatKey]: CookieFormat };
	export const DEFAULT_FORMAT: CookieFormatKey;

	export function getAllCookies(
		details: chrome.cookies.GetAllDetails
	): Promise<chrome.cookies.Cookie[]>;

	export function serializeCookies(
		cookies: chrome.cookies.Cookie[],
		formatKey: CookieFormatKey
	): string;

	export function toNetscapeRows(cookies: chrome.cookies.Cookie[]): string[][];

	export function getCookiesForUrl(
		tabUrl: string | null | undefined
	): Promise<{ cookies: chrome.cookies.Cookie[]; netscape: string; cookieHeader: string }>;

	export function getCookiesForPopup(
		tabUrl: string,
		formatKey?: CookieFormatKey
	): Promise<{ cookies: chrome.cookies.Cookie[]; text: string }>;

	export function getAllBrowserCookies(
		formatKey?: CookieFormatKey
	): Promise<{ cookies: chrome.cookies.Cookie[]; text: string }>;

	export function saveCookiesFromPopup(
		text: string,
		hostname: string,
		formatKey: CookieFormatKey,
		saveAs?: boolean
	): Promise<void>;

	export function downloadCookiesFile(
		text: string,
		name: string,
		formatKey: CookieFormatKey,
		saveAs?: boolean
	): Promise<void>;
}

declare module "*/cookies/save.js" {
	export function downloadCookiesFile(
		text: string,
		name: string,
		formatKey: CookieFormatKey,
		saveAs?: boolean
	): Promise<void>;
}

declare module "*/cookies/format.js" {
	export const FORMAT_MAP: { [key in CookieFormatKey]: CookieFormat };
	export const DEFAULT_FORMAT: CookieFormatKey;
	export function serializeCookies(
		cookies: chrome.cookies.Cookie[],
		formatKey: CookieFormatKey
	): string;
	export function toNetscapeRows(cookies: chrome.cookies.Cookie[]): string[][];
}

declare module "*/cookies/get_all_cookies.js" {
	export function getAllCookies(
		details: chrome.cookies.GetAllDetails
	): Promise<chrome.cookies.Cookie[]>;
}
