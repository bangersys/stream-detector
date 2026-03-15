/**
 * primedl — src/@types/cookies.d.ts
 *
 * Type declarations for the js/cookies/ module.
 * Provides IDE autocompletion and type safety for cookie-related functions
 * without converting the source files to TypeScript.
 *
 * Note on total-typescript warnings:
 * The `passing-generics-to-types` hints for Promise<T> return types are
 * false positives in .d.ts files — TypeScript cannot infer return types in
 * declaration files, so they must be explicit. These are non-blocking
 * style hints, not errors.
 */

// ─── Shared types ─────────────────────────────────────────────────────────

/** The three serialization format keys the cookies module supports */
type CookieFormatKey = "netscape" | "json" | "header";

/** A cookie format descriptor returned by FORMAT_MAP */
interface CookieFormat {
	/** File extension including the dot, e.g. ".txt" */
	ext: string;
	/** MIME type for the download Blob */
	mimeType: string;
	/** Human-readable label for UI display */
	label: string;
	/** Serializer: cookies array → formatted string */
	serializer: (cookies: chrome.cookies.Cookie[]) => string;
}

/**
 * Explicit shape of FORMAT_MAP — avoids mapped-type warnings while
 * keeping full type safety on each key.
 */
interface CookieFormatMap {
	netscape: CookieFormat;
	json: CookieFormat;
	header: CookieFormat;
}

/** Return value of getCookiesForUrl() — all three formats ready to use */
interface CookiesForUrl {
	cookies: chrome.cookies.Cookie[];
	/** Netscape cookies.txt string for yt-dlp / curl */
	netscape: string;
	/** Cookie: header string for direct HTTP injection */
	cookieHeader: string;
}

/** Return value of getCookiesForPopup() and getAllBrowserCookies() */
interface CookiesForPopup {
	cookies: chrome.cookies.Cookie[];
	/** Serialized text in the requested format */
	text: string;
}

// ─── Module declarations ──────────────────────────────────────────────────

declare module "*/cookies/index.js" {
	export const FORMAT_MAP: CookieFormatMap;
	export const DEFAULT_FORMAT: CookieFormatKey;

	export function getAllCookies(
		details: chrome.cookies.GetAllDetails
	): Promise<chrome.cookies.Cookie[]>;

	export function serializeCookies(
		cookies: chrome.cookies.Cookie[],
		formatKey: CookieFormatKey
	): string;

	export function toNetscapeRows(
		cookies: chrome.cookies.Cookie[]
	): string[][];

	export function getCookiesForUrl(
		tabUrl: string | null | undefined
	): Promise<CookiesForUrl>;

	export function getCookiesForPopup(
		tabUrl: string,
		formatKey?: CookieFormatKey
	): Promise<CookiesForPopup>;

	export function getAllBrowserCookies(
		formatKey?: CookieFormatKey
	): Promise<CookiesForPopup>;

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
	export const FORMAT_MAP: CookieFormatMap;
	export const DEFAULT_FORMAT: CookieFormatKey;

	export function serializeCookies(
		cookies: chrome.cookies.Cookie[],
		formatKey: CookieFormatKey
	): string;

	export function toNetscapeRows(
		cookies: chrome.cookies.Cookie[]
	): string[][];
}

declare module "*/cookies/get_all_cookies.js" {
	export function getAllCookies(
		details: chrome.cookies.GetAllDetails
	): Promise<chrome.cookies.Cookie[]>;
}