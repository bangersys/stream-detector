/**
 * primedl — background.js
 *
 * Core stream detection engine.
 * Works as:
 *   - Firefox MV2 non-persistent background script
 *   - Chrome MV3 service worker
 *
 * Fixed from original stream-detector:
 *   [1] chrome.action compat shim (MV3 Chrome vs MV2 Firefox)
 *   [2] chrome.sidebarAction guarded (Firefox-only API)
 *   [3] MSS detection via dedicated URL path check (not fragile ext match)
 *   [4] keepalive port handler for Chrome MV3 SW persistence
 *   [5] primedl relay integration — detected streams sent to Rust server
 *   [6] Cookie extraction integrated into detection flow
 */

import iconDark16 from "../img/icon-dark-16.png";
import iconDark48 from "../img/icon-dark-48.png";
import iconDark96 from "../img/icon-dark-96.png";
import iconDarkEnabled16 from "../img/icon-dark-enabled-16.png";
import iconDarkEnabled48 from "../img/icon-dark-enabled-48.png";
import iconDarkEnabled96 from "../img/icon-dark-enabled-96.png";

// ─── Icon imports (handled by Bun bundler as data URLs) ───────────────────
import iconLight16 from "../img/icon-light-16.png";
import iconLight48 from "../img/icon-light-48.png";
import iconLight96 from "../img/icon-light-96.png";
import iconLightEnabled16 from "../img/icon-light-enabled-16.png";
import iconLightEnabled48 from "../img/icon-light-enabled-48.png";
import iconLightEnabled96 from "../img/icon-light-enabled-96.png";
import { getCookiesForUrl } from "./components/cookies.js";
import defaults from "./components/defaults.js";
import { reconnect as relayReconnect, sendDetection, setRelayEnabled } from "./components/relay.js";
import { clearStorage, getStorage, setStorage } from "./components/storage.js";
import supported from "./components/supported.js";
import { downloadCookiesFile } from "./cookies/save.js";

// ─── FIX [1]: chrome.action / chrome.browserAction compat shim ────────────
// MV3 Chrome uses chrome.action; MV2 Firefox uses chrome.browserAction.
// The ?? ensures whichever one exists is used.
const browserAction = chrome.action ?? chrome.browserAction;

const _ = chrome.i18n.getMessage;

const isChrome = chrome.runtime.getURL("").startsWith("chrome-extension://");
const isDarkMode = () =>
	typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;

// ─── State ────────────────────────────────────────────────────────────────
const queue = [];
const allRequestDetails = [];
let urlStorage = [];
let urlStorageRestore = [];
let requestTimeoutId = -1;

// User preference vars (populated by updateVars)
let subtitlePref;
let filePref;
let fileSizePref;
let fileSizeAmount;
let manifestPref;
let blacklistPref;
let blacklistEntries;
let customExtPref;
let customCtPref;
let noRestorePref;
let disablePref;
let notifDetectPref;
let notifPref;
let downloadDirectPref;
let autoDownloadPref;
let primedlRelayEnabled;
let newline;

const customSupported = { ext: [], ct: [], type: "CUSTOM", category: "custom" };

// ─── Preference loader ────────────────────────────────────────────────────
const updateVars = async () => {
	subtitlePref = await getStorage("subtitlePref");
	filePref = await getStorage("filePref");
	fileSizePref = await getStorage("fileSizePref");
	fileSizeAmount = await getStorage("fileSizeAmount");
	manifestPref = await getStorage("manifestPref");
	blacklistPref = await getStorage("blacklistPref");
	blacklistEntries = await getStorage("blacklistEntries");
	customExtPref = await getStorage("customExtPref");
	customSupported.ext = (await getStorage("customExtEntries")) ?? [];
	customCtPref = await getStorage("customCtPref");
	customSupported.ct = (await getStorage("customCtEntries")) ?? [];
	noRestorePref = await getStorage("noRestorePref");
	disablePref = await getStorage("disablePref");
	notifDetectPref = await getStorage("notifDetectPref");
	notifPref = await getStorage("notifPref");
	downloadDirectPref = await getStorage("downloadDirectPref");
	autoDownloadPref = await getStorage("autoDownloadPref");
	primedlRelayEnabled = await getStorage("primedlRelayEnabled");
};

// ─── Icon update ──────────────────────────────────────────────────────────
const updateIcons = () => {
	if (disablePref !== true) {
		browserAction.setIcon({
			path: {
				16: isDarkMode() ? iconDarkEnabled16 : iconLightEnabled16,
				48: isDarkMode() ? iconDarkEnabled48 : iconLightEnabled48,
				96: isDarkMode() ? iconDarkEnabled96 : iconLightEnabled96
			}
		});
	} else {
		browserAction.setIcon({
			path: {
				16: isDarkMode() ? iconDark16 : iconLight16,
				48: isDarkMode() ? iconDark48 : iconLight48,
				96: isDarkMode() ? iconDark96 : iconLight96
			}
		});
	}
};

// ─── Tab data helper ──────────────────────────────────────────────────────
const getTabData = async (tabId) =>
	new Promise((resolve) => chrome.tabs.get(tabId, (data) => resolve(data)));

// ─── URL validator — gate before storing ──────────────────────────────────
const urlValidator = (e, requestDetails, headerSize, headerCt) => {
	if (!e) return false;
	if (requestDetails.tabId === -1) return false;

	const isExistingUrl = urlStorage.find((u) => u.url === requestDetails.url);
	if (
		isExistingUrl &&
		(isExistingUrl.requestId !== requestDetails.requestId ||
			!queue.includes(requestDetails.requestId))
	)
		return false;

	if (subtitlePref && e.category === "subtitles") return false;
	if (filePref && e.category === "files") return false;

	if (
		fileSizePref &&
		(e.category === "files" || e.category === "custom") &&
		headerSize &&
		Math.floor(headerSize.value / 1024 / 1024) < Number(fileSizeAmount)
	)
		return false;

	if (manifestPref && e.category === "stream") return false;

	if (
		blacklistPref &&
		blacklistEntries?.some(
			(entry) =>
				requestDetails.url.toLowerCase().includes(entry.toLowerCase()) ||
				(requestDetails.documentUrl || requestDetails.originUrl || requestDetails.initiator)
					?.toLowerCase()
					.includes(entry.toLowerCase()) ||
				headerCt?.value?.toLowerCase().includes(entry.toLowerCase()) ||
				e.type.toLowerCase().includes(entry.toLowerCase())
		)
	)
		return false;

	return true;
};

// ─── Main URL filter — called by webRequest listeners ─────────────────────
const urlFilter = (requestDetails) => {
	let ext;
	let head;

	const urlPath = new URL(requestDetails.url).pathname.toLowerCase();

	// FIX [3]: MSS — dedicated path check, not fragile .ext substring
	// Matches any URL with .ism/manifest or .isml/manifest in the path
	const isMSS = urlPath.includes(".ism/manifest") || urlPath.includes(".isml/manifest");

	if (isMSS) {
		ext = supported.find((f) => f.mssMatch === true);
	}

	// Custom extension check
	if (!ext && customExtPref && customSupported.ext?.length > 0) {
		const matchedCustomExt = customSupported.ext.some((fe) =>
			urlPath.includes(`.${fe.toLowerCase()}`)
		);
		if (matchedCustomExt) ext = customSupported;
	}

	// Built-in extension check (skip MSS entries since handled above)
	if (!ext) {
		ext = supported.find((f) => !f.mssMatch && f.ext?.some((fe) => urlPath.includes(`.${fe}`)));
	}

	// Header detection
	requestDetails.headers = requestDetails.responseHeaders || requestDetails.requestHeaders;

	const headerCt = requestDetails.headers?.find((h) => h.name.toLowerCase() === "content-type");

	if (headerCt?.value) {
		// Custom CT check
		if (customCtPref && customSupported.ct?.length > 0) {
			const matchedCustomCt = customSupported.ct.some((fe) =>
				headerCt.value.toLowerCase().includes(fe.toLowerCase())
			);
			if (matchedCustomCt) head = customSupported;
		}

		// Built-in CT check (exact match)
		if (!head) {
			head = supported.find((f) =>
				f.ct?.some((fe) => headerCt.value.toLowerCase() === fe.toLowerCase())
			);
		}
	}

	const headerSize = requestDetails.headers?.find((h) => h.name.toLowerCase() === "content-length");

	const e = head || ext;

	if (!urlValidator(e, requestDetails, headerSize, headerCt)) return;

	queue.push(requestDetails.requestId);
	requestDetails.type = e.type;
	requestDetails.category = e.category;
	addURL(requestDetails);
};

// ─── Store detected URL, notify, and relay to primedl ─────────────────────
const addURL = async (requestDetails) => {
	const url = new URL(requestDetails.url);

	// MSS: strip the /manifest suffix to get the base stream URL
	const urlPath = url.pathname.toLowerCase().includes(".ism/manifest")
		? url.pathname.slice(0, url.pathname.toLowerCase().lastIndexOf("/manifest"))
		: url.pathname;

	const filename =
		urlPath.lastIndexOf("/") > 0
			? urlPath.slice(urlPath.lastIndexOf("/") + 1)
			: urlPath.startsWith("/")
				? urlPath.slice(1)
				: urlPath;

	const { hostname } = url;

	const tabData = await getTabData(requestDetails.tabId);

	// Slim down stored headers to only what's needed
	const filteredHeaders = requestDetails.headers?.filter(
		(h) =>
			h.name.toLowerCase() === "user-agent" ||
			h.name.toLowerCase() === "referer" ||
			h.name.toLowerCase() === "cookie" ||
			h.name.toLowerCase() === "set-cookie" ||
			h.name.toLowerCase() === "content-length"
	);

	const newRequestDetails = {
		category: requestDetails.category,
		documentUrl: requestDetails.documentUrl,
		originUrl: requestDetails.originUrl,
		initiator: requestDetails.initiator,
		requestId: requestDetails.requestId,
		tabId: requestDetails.tabId,
		timeStamp: requestDetails.timeStamp,
		type: requestDetails.type,
		url: requestDetails.url,
		headers: filteredHeaders ?? [],
		filename,
		hostname,
		tabData: {
			title: tabData?.title,
			url: tabData?.url,
			incognito: tabData?.incognito
		}
	};

	const isExistingRequest = urlStorage.find((u) => u.requestId === requestDetails.requestId);

	if (!isExistingRequest) {
		urlStorage.push(newRequestDetails);
		browserAction.getBadgeText({}, (badgeText) => {
			browserAction.setBadgeText({
				text: (Number(badgeText) + 1).toString()
			});
		});
	} else {
		// Merge headers from the second listener hit (request + response)
		const existingIndex = urlStorage.findIndex((u) => u.requestId === requestDetails.requestId);
		const mergedHeaders = [...urlStorage[existingIndex].headers, ...newRequestDetails.headers];
		urlStorage[existingIndex].headers = mergedHeaders;
	}

	// Debounce rapid batch detections into one notification
	clearTimeout(requestTimeoutId);
	allRequestDetails.push({
		requestId: newRequestDetails.requestId,
		filename: newRequestDetails.filename,
		type: newRequestDetails.type
	});

	requestTimeoutId = setTimeout(async () => {
		await setStorage({ urlStorage });
		chrome.runtime.sendMessage({ urlStorage: true }).catch(() => {});

		// Clear processed batch from queue
		allRequestDetails.map((d) => d.requestId).forEach((id) => queue.splice(queue.indexOf(id), 1));

		// Show notification
		if (!notifDetectPref && !notifPref && (!autoDownloadPref || (autoDownloadPref && filePref))) {
			if (allRequestDetails.length > 1) {
				chrome.notifications.create("add", {
					type: "basic",
					iconUrl: iconDark96,
					title: _("notifManyTitle"),
					message: _("notifManyText") + allRequestDetails.map((d) => d.filename).join(newline)
				});
			} else {
				chrome.notifications.create("add", {
					type: "basic",
					iconUrl: iconDark96,
					title: _("notifTitle"),
					message: _("notifText", newRequestDetails.type) + filename
				});
			}
		}

		allRequestDetails.length = 0;
	}, 100);

	// ─── FWD to primedl Rust server via WebSocket relay ───────────────────
	if (primedlRelayEnabled !== false) {
		// Get cookies asynchronously — don't block detection flow
		const tabUrl = newRequestDetails.tabData?.url;
		getCookiesForUrl(tabUrl)
			.then((cookieData) => {
				sendDetection({
					url: newRequestDetails.url,
					filename: newRequestDetails.filename,
					type: newRequestDetails.type,
					category: newRequestDetails.category,
					site: newRequestDetails.hostname,
					tabTitle: newRequestDetails.tabData?.title ?? "",
					tabUrl: tabUrl ?? "",
					timestamp: newRequestDetails.timeStamp,
					headers: newRequestDetails.headers,
					cookies: cookieData.netscape,
					cookieHeader: cookieData.cookieHeader
				}).catch((e) => console.warn("[primedl/relay] sendDetection error:", e));
			})
			.catch((e) => console.warn("[primedl/cookies] getCookiesForUrl error:", e));
	}

	// Auto-download non-manifest files if configured
	if (
		(newRequestDetails.category === "files" || newRequestDetails.category === "custom") &&
		downloadDirectPref &&
		autoDownloadPref
	) {
		const dlOptions = isChrome
			? { filename: newRequestDetails.filename, url: newRequestDetails.url, saveAs: false }
			: {
					filename: newRequestDetails.filename,
					headers: newRequestDetails.headers?.filter((h) => h.name.toLowerCase() === "referer") || [],
					incognito: newRequestDetails.tabData?.incognito || false,
					url: newRequestDetails.url,
					saveAs: false
				};

		chrome.downloads.download(dlOptions);
	}
};

// ─── URL deletion (from popup/sidebar) ────────────────────────────────────
const deleteURL = async (message) => {
	if (message.previous !== true) {
		urlStorage = urlStorage.filter(
			(url) => !message.delete.map((u) => u.requestId).includes(url.requestId)
		);
	} else {
		urlStorageRestore = urlStorageRestore.filter(
			(url) => !message.delete.map((u) => u.requestId).includes(url.requestId)
		);
	}
	await setStorage({ urlStorage });
	await setStorage({ urlStorageRestore });
	chrome.runtime.sendMessage({ urlStorage: true }).catch(() => {});
};

// ─── webRequest listener registration ─────────────────────────────────────
const addListeners = () => {
	chrome.webRequest.onBeforeSendHeaders.addListener(
		urlFilter,
		{ urls: ["<all_urls>"] },
		isChrome ? ["requestHeaders", "extraHeaders"] : ["requestHeaders"]
	);

	chrome.webRequest.onHeadersReceived.addListener(
		urlFilter,
		{ urls: ["<all_urls>"] },
		isChrome ? ["responseHeaders", "extraHeaders"] : ["responseHeaders"]
	);
};

// ─── Initialisation ───────────────────────────────────────────────────────
const init = async () => {
	// Write missing defaults to storage
	for (const option in defaults) {
		if ((await getStorage(option)) === null) {
			await setStorage({ [option]: defaults[option] });
		}
	}

	// Reset filter state on every launch
	await setStorage({ filterInput: "" });
	await setStorage({ version: chrome.runtime.getManifest().version });

	// Detect OS for correct newline
	chrome.runtime.getPlatformInfo(async (info) => {
		newline = info.os === "win" ? "\r\n" : "\n";
		await setStorage({ newline });
	});

	browserAction.setBadgeBackgroundColor({ color: "green" });
	browserAction.setBadgeText({ text: "" });

	// Middle-click toolbar button → open popup in new tab
	browserAction.onClicked.addListener((_tab, onClickData) => {
		if (onClickData?.button === 1) {
			chrome.tabs.create({ url: "/popup.html" });
		}
	});

	await updateVars();
};

// ─── Bootstrap ────────────────────────────────────────────────────────────
(async () => {
	await init();

	if (disablePref !== true) {
		addListeners();
		updateIcons();
	}

	// Restore previous session URLs
	urlStorage = (await getStorage("urlStorage")) ?? [];
	urlStorageRestore = (await getStorage("urlStorageRestore")) ?? [];

	if (urlStorage.length > 0 && !noRestorePref) {
		urlStorageRestore = [...urlStorageRestore, ...urlStorage];
		// Strip incognito entries — never persist those
		urlStorageRestore = urlStorageRestore.filter((url) => url.tabData?.incognito !== true);
		await setStorage({ urlStorageRestore });
	} else {
		urlStorageRestore = [];
		await setStorage({ urlStorageRestore });
	}

	urlStorage = [];
	await setStorage({ urlStorage });

	// ─── Message handler ─────────────────────────────────────────────────
	chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
		(async () => {
			if (message.delete) {
				await deleteURL(message);
			} else if (message.options) {
				await updateVars();

				if (
					disablePref === true &&
					chrome.webRequest.onBeforeSendHeaders.hasListener(urlFilter) &&
					chrome.webRequest.onHeadersReceived.hasListener(urlFilter)
				) {
					chrome.webRequest.onBeforeSendHeaders.removeListener(urlFilter);
					chrome.webRequest.onHeadersReceived.removeListener(urlFilter);
				} else if (
					disablePref !== true &&
					!chrome.webRequest.onBeforeSendHeaders.hasListener(urlFilter) &&
					!chrome.webRequest.onHeadersReceived.hasListener(urlFilter)
				) {
					addListeners();
				}
				updateIcons();

				// If relay enabled/disabled in options, connect or disconnect immediately
				await setRelayEnabled(primedlRelayEnabled !== false);
			} else if (message.reset) {
				await clearStorage();
				urlStorage = [];
				urlStorageRestore = [];
				await init();
				chrome.runtime.sendMessage({ options: true }).catch(() => {});
			} else if (message.primedlReconnect) {
				// Let popup trigger a relay reconnect
				relayReconnect();
			} else if (message.keepalive) {
				// Keepalive ping from content script — just acknowledge
				// The act of handling this message keeps the SW alive
			} else if (message.type === "cookieSave" && message.target === "background") {
				// Firefox: popup.js cannot call saveAs from a popup context.
				// The popup sends this message and background.js does the download.
				const { text, filename, formatKey, saveAs } = message.data ?? {};
				if (text && filename && formatKey) {
					await downloadCookiesFile(text, filename, formatKey, saveAs ?? false);
				}
			}

			sendResponse({ ok: true });
		})();
		// Return true to keep the message channel open for async response
		return true;
	});

	// ─── Keyboard commands ───────────────────────────────────────────────
	chrome.commands.onCommand.addListener((cmd) => {
		if (cmd === "open-popup") {
			// chrome.action.openPopup() is only available in specific contexts
			// Use tabs.create as reliable fallback
			try {
				browserAction.openPopup?.();
			} catch {
				chrome.tabs.create({ url: "/popup.html" });
			}
		}
		// FIX [2]: sidebarAction is Firefox-only — guard before calling
		if (cmd === "open-sidebar" && typeof chrome.sidebarAction !== "undefined") {
			chrome.sidebarAction.open();
		}
	});

	// ─── FIX [4]: MV3 Service Worker keepalive port handler ──────────────
	// Content script opens a port named "primedl-keepalive" every ~295s.
	// Keeping the port connection alive prevents Chrome from killing the SW.
	chrome.runtime.onConnect.addListener((port) => {
		if (port.name === "primedl-keepalive") {
			// Keep a reference — port stays open until content script disconnects
			port.onDisconnect.addListener(() => {
				// Port closed — content script will reconnect
			});
			// Popup-specific handling — clear badge on popup close
		} else if (port.name === "popup") {
			port.onDisconnect.addListener(() => {
				browserAction.setBadgeBackgroundColor({ color: "green" });
				browserAction.setBadgeText({ text: "" });
			});
		}
	});
})();
