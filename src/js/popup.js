/**
 * primedl — popup.js
 * Shared logic for popup.html and sidebar.html.
 *
 * Sections:
 *   1. Stream detection list (original stream-detector UI)
 *   2. Cookie export section (integrated from kairi003/Get-cookies.txt-LOCALLY)
 *   3. primedl relay status indicator
 */

import notifIcon from "../img/icon-dark-96.png";
import { getStorage, saveOptionStorage, setStorage } from "./components/storage.js";
import {
	FORMAT_MAP,
	DEFAULT_FORMAT,
	getCookiesForPopup,
	getAllBrowserCookies,
	saveCookiesFromPopup,
} from "./cookies/index.js";

// ─── Browser detection ────────────────────────────────────────────────────
const _browserAction = chrome.action ?? chrome.browserAction;
const isChrome = chrome.runtime.getURL("").startsWith("chrome-extension://");

const _ = chrome.i18n.getMessage;

// ─── Stream list state ────────────────────────────────────────────────────
const table = document.getElementById("popupUrlList");

let titlePref;
let _filenamePref;
let _timestampPref;
let downloadDirectPref;
let newline;
let recentPref;
let recentAmount;
let _noRestorePref;
let urlList = [];

// ─── Cookie section state ─────────────────────────────────────────────────
let cookiePanelOpen = false;
let currentCookies = [];
let currentTabUrl = "";
let currentHostname = "";
let cookieCopyTimer = null;

// ─── Helpers ──────────────────────────────────────────────────────────────

const getTimestamp = (timestamp) => {
	const date = new Date(timestamp);
	return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
};

const formatBytes = (bytes) => {
	const sizes = ["B", "KB", "MB", "GB", "TB"];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	return `${parseFloat((bytes / 1024 ** i).toFixed(2))} ${sizes[i]}`;
};

const downloadURL = (file) => {
	const dlOptions = isChrome
		? { url: file.url }
		: {
				headers: file.headers?.filter((h) => h.name.toLowerCase() === "referer") || [],
				incognito: file.tabData?.incognito || false,
				url: file.url,
		  };

	chrome.downloads.download(dlOptions, (err) => {
		if (err === undefined) {
			chrome.notifications.create("error", {
				type: "basic",
				iconUrl: notifIcon,
				title: _("notifDownErrorTitle"),
				message: _("notifDownErrorText") + file.filename,
			});
		}
	});
};

// ─── Stream URL copy to clipboard ─────────────────────────────────────────
const copyURL = async (info) => {
	const list = { urls: [], filenames: [], methodIncomp: false };

	for (const e of info) {
		let code;
		let methodIncomp = false;
		let fileMethod = (await getStorage("copyMethod")) || "url";

		// Don't use user-defined command if it's empty
		if (
			fileMethod.startsWith("user") &&
			(await getStorage(`userCommand${fileMethod.at(-1)}`)) === null
		) {
			fileMethod = "url";
			methodIncomp = true;
		}

		const streamURL = e.url;
		const { filename } = e;

		// ── Build command prefix ───────────────────────────────────────────
		if (fileMethod === "url") {
			code = streamURL;
		} else if (fileMethod === "tableForm") {
			const source =
				titlePref && e.tabData?.title && !streamURL.includes(e.tabData.title)
					? e.tabData.title
					: e.hostname;
			code = `${streamURL} | ${source} | ${getTimestamp(e.timeStamp)}`;
		} else if (fileMethod === "kodiUrl") {
			code = streamURL;
		} else if (fileMethod === "ffmpeg") {
			code = "ffmpeg";
		} else if (fileMethod === "streamlink") {
			code = "streamlink";
		} else if (fileMethod === "ytdlp") {
			code = "yt-dlp --no-part --restrict-filenames";
			if ((await getStorage("multithreadPref")) && (await getStorage("multithreadAmount"))) {
				code += ` -N ${await getStorage("multithreadAmount")}`;
			}
			if ((await getStorage("downloaderPref")) && (await getStorage("downloaderCommand"))) {
				code += ` --downloader "${await getStorage("downloaderCommand")}"`;
			}
		} else if (fileMethod === "hlsdl") {
			code = "hlsdl -b -c";
		} else if (fileMethod === "nm3u8dl") {
			code = `N_m3u8DL-RE "${streamURL}"`;
		} else if (fileMethod.startsWith("user")) {
			code = await getStorage(`userCommand${fileMethod.at(-1)}`);
		}

		// ── Custom extra params ────────────────────────────────────────────
		const prefName = `customCommand${fileMethod}`;
		if ((await getStorage("customCommandPref")) && (await getStorage(prefName))) {
			code += ` ${await getStorage(prefName)}`;
		}

		// ── Proxy ─────────────────────────────────────────────────────────
		if ((await getStorage("proxyPref")) && (await getStorage("proxyCommand"))) {
			const proxy = await getStorage("proxyCommand");
			if (fileMethod === "ffmpeg") code += ` -http_proxy "${proxy}"`;
			else if (fileMethod === "streamlink") code += ` --http-proxy "${proxy}"`;
			else if (fileMethod === "ytdlp") code += ` --proxy "${proxy}"`;
			else if (fileMethod === "hlsdl") code += ` -p "${proxy}"`;
			else if (fileMethod === "nm3u8dl") code += ` --custom-proxy "${proxy}"`;
			else if (fileMethod.startsWith("user")) code = code.replace(/%proxy%/g, proxy);
		}

		// ── Headers ───────────────────────────────────────────────────────
		if (await getStorage("headersPref")) {
			let headerUserAgent =
				e.headers?.find((h) => h.name.toLowerCase() === "user-agent")?.value ??
				navigator.userAgent;

			let headerCookieRaw = e.headers?.find(
				(h) =>
					h.name.toLowerCase() === "cookie" || h.name.toLowerCase() === "set-cookie"
			)?.value;
			if (headerCookieRaw) {
				headerCookieRaw = headerCookieRaw.replace(/"/g, "'");
			}

			let headerReferer =
				e.headers?.find((h) => h.name.toLowerCase() === "referer")?.value ??
				(e.originUrl || e.documentUrl || e.initiator || e.tabData?.url);
			if (
				headerReferer?.startsWith("about:") ||
				headerReferer?.startsWith("chrome:")
			) {
				headerReferer = undefined;
			}

			if (headerUserAgent) {
				if (fileMethod === "kodiUrl")
					code += `|User-Agent=${encodeURIComponent(headerUserAgent)}`;
				else if (fileMethod === "ffmpeg") code += ` -user_agent "${headerUserAgent}"`;
				else if (fileMethod === "streamlink")
					code += ` --http-header "User-Agent=${headerUserAgent}"`;
				else if (fileMethod === "ytdlp") code += ` --user-agent "${headerUserAgent}"`;
				else if (fileMethod === "hlsdl") code += ` -u "${headerUserAgent}"`;
				else if (fileMethod === "nm3u8dl")
					code += ` --header "User-Agent: ${headerUserAgent}"`;
				else if (fileMethod.startsWith("user"))
					code = code.replace(/%useragent%/g, headerUserAgent);
			} else if (fileMethod.startsWith("user")) {
				code = code.replace(/%useragent%/g, "");
			}

			if (headerCookieRaw) {
				if (fileMethod === "kodiUrl") {
					code += headerUserAgent ? "&" : "|";
					code += `Cookie=${encodeURIComponent(headerCookieRaw)}`;
				} else if (fileMethod === "ffmpeg") {
					code += ` -headers "Cookie: ${headerCookieRaw}"`;
				} else if (fileMethod === "streamlink") {
					code += ` --http-header "Cookie=${headerCookieRaw}"`;
				} else if (fileMethod === "ytdlp") {
					code += ` --add-header "Cookie:${headerCookieRaw}"`;
				} else if (fileMethod === "hlsdl") {
					code += ` -h "Cookie:${headerCookieRaw}"`;
				} else if (fileMethod === "nm3u8dl") {
					code += ` --header "Cookie: ${headerCookieRaw}"`;
				} else if (fileMethod.startsWith("user")) {
					code = code.replace(/%cookie%/g, headerCookieRaw);
				}
			} else if (fileMethod === "ytdlp") {
				code += isChrome
					? " --cookies-from-browser chrome"
					: " --cookies-from-browser firefox";
			} else if (fileMethod.startsWith("user")) {
				code = code.replace(/%cookie%/g, "");
			}

			if (headerReferer) {
				if (fileMethod === "kodiUrl") {
					code += headerUserAgent || headerCookieRaw ? "&" : "|";
					code += `Referer=${encodeURIComponent(headerReferer)}`;
				} else if (fileMethod === "ffmpeg") {
					code += ` -referer "${headerReferer}"`;
				} else if (fileMethod === "streamlink") {
					code += ` --http-header "Referer=${headerReferer}"`;
				} else if (fileMethod === "ytdlp") {
					code += ` --add-header "Referer:${headerReferer}"`;
				} else if (fileMethod === "hlsdl") {
					code += ` -h "Referer:${headerReferer}"`;
				} else if (fileMethod === "nm3u8dl") {
					code += ` --header "Referer: ${headerReferer}"`;
				} else if (fileMethod.startsWith("user")) {
					code = code.replace(/%referer%/g, headerReferer);
				}
			} else if (fileMethod.startsWith("user")) {
				code = code.replace(/%referer%/g, "");
				code = code.replace(/%origin%/g, "");
			}
		}

		// ── Filename + final command tail ──────────────────────────────────
		const filenamePrefVal = await getStorage("filenamePref");
		const timestampPrefVal = await getStorage("timestampPref");

		let outFilename = filenamePrefVal && e.tabData?.title ? e.tabData.title : filename;
		if (outFilename.lastIndexOf(".") !== -1) {
			outFilename = outFilename.slice(0, outFilename.lastIndexOf("."));
		}
		outFilename = outFilename.replace(/[/\\?%*:|"<>]/g, "_");

		const outExtension = (await getStorage("fileExtension")) || "ts";
		const outTimestamp = getTimestamp(e.timeStamp).replace(/[/\\?%*:|"<>]/g, "_");

		if (fileMethod === "ffmpeg") {
			code += ` -i "${streamURL}" -c copy "${outFilename}`;
			if (timestampPrefVal) code += ` ${outTimestamp}`;
			code += `.${outExtension}"`;
		} else if (fileMethod === "streamlink") {
			if ((await getStorage("streamlinkOutput")) === "file") {
				code += ` -o "${outFilename}`;
				if (timestampPrefVal) code += ` ${outTimestamp}`;
				code += `.${outExtension}"`;
			}
			code += ` "${streamURL}" best`;
		} else if (fileMethod === "ytdlp") {
			if ((filenamePrefVal && e.tabData?.title) || timestampPrefVal) {
				code += ` --output "${outFilename}`;
				if (timestampPrefVal) code += " %(epoch)s";
				code += `.%(ext)s"`;
			}
			code += ` "${streamURL}"`;
		} else if (fileMethod === "hlsdl") {
			code += ` -o "${outFilename}`;
			if (timestampPrefVal) code += ` ${outTimestamp}`;
			code += `.${outExtension}" "${streamURL}"`;
		} else if (fileMethod === "nm3u8dl") {
			code += ` --save-name "${outFilename}`;
			if (timestampPrefVal) code += ` ${outTimestamp}`;
			code += `"`;
		} else if (fileMethod.startsWith("user")) {
			code = code.replace(/%url%/g, streamURL);
			code = code.replace(/%filename%/g, filename);
			code = code.replace(/%timestamp%/g, outTimestamp);
			code = code.replace(/%tabtitle%/g, e.tabData?.title ?? "");
		}

		// ── Regex substitution for user commands ──────────────────────────
		if (fileMethod.startsWith("user") && (await getStorage("regexCommandPref"))) {
			const regexCommand = await getStorage("regexCommand");
			const regexReplace = await getStorage("regexReplace");
			if (regexCommand) {
				code = code.replace(new RegExp(regexCommand, "g"), regexReplace || "");
			}
		}

		list.urls.push(code);
		list.filenames.push(filename);
		list.methodIncomp = list.methodIncomp || methodIncomp;
	}

	// Clipboard — navigator.clipboard only, no deprecated execCommand
	try {
		await navigator.clipboard.writeText(list.urls.join(newline));
		if ((await getStorage("notifPref")) === false) {
			chrome.notifications.create("copy", {
				type: "basic",
				iconUrl: notifIcon,
				title: _("notifCopiedTitle"),
				message:
					(list.methodIncomp ? _("notifIncompCopiedText") : _("notifCopiedText")) +
					list.filenames.join(newline),
			});
		}
	} catch (err) {
		console.error("[primedl/popup] Clipboard write failed:", err);
		chrome.notifications.create("error", {
			type: "basic",
			iconUrl: notifIcon,
			title: _("notifErrorTitle"),
			message: _("notifErrorText") + list.filenames.join(newline),
		});
	}
};

// ─── Stream list rendering ─────────────────────────────────────────────────

const insertPlaceholder = () => {
	const row = table.insertRow();
	const cell = row.insertCell();
	cell.colSpan = 6;
	cell.textContent = _("placeholderCell");
};

const insertList = (urls) => {
	for (const e of urls) {
		const row = table.insertRow();
		row.className = "urlEntry";
		const cellName = row.insertCell();
		const cellDel = row.insertCell();

		const contentSize = e.headers?.find(
			(h) => h.name.toLowerCase() === "content-length"
		)?.value;
		const source = titlePref && e.tabData?.title ? e.tabData.title : e.hostname;

		// Popup (full table) vs sidebar (compact)
		if (document.body.id === "popup") {
			const cellType = row.insertCell();
			cellType.textContent = e.type;
			row.insertCell().textContent = e.filename;
			const cellSize = row.insertCell();
			if (
				(e.category === "files" || e.category === "custom") &&
				contentSize &&
				Number(contentSize) !== 0
			) {
				cellSize.textContent = formatBytes(Number(contentSize));
				cellSize.title = contentSize;
			} else {
				cellSize.textContent = "-";
			}
			row.insertCell().textContent = source;
			row.insertCell().textContent = getTimestamp(e.timeStamp);
		} else {
			// Sidebar: compact single cell
			cellName.innerHTML = `
				<span class="urlSource">${source}</span>
				<span class="urlFilename">${e.filename}</span>
				<span class="urlInfo">${e.type}${contentSize ? ` · ${formatBytes(Number(contentSize))}` : ""} · ${getTimestamp(e.timeStamp)}</span>
			`;
		}

		cellDel.textContent = "✖";
		cellDel.title = _("deleteTooltip");

		// Click row → copy URL
		const clickTarget = document.body.id === "popup" ? row : cellName;
		clickTarget.style.cursor = "pointer";
		clickTarget.addEventListener("click", async () => {
			if (downloadDirectPref && e.category !== "stream" && e.category !== "subtitles") {
				downloadURL(e);
			} else {
				await copyURL([e]);
			}
		});

		// Click X → delete
		cellDel.style.cursor = "pointer";
		cellDel.addEventListener("click", async (ev) => {
			ev.stopPropagation();
			const isPrev = document.getElementById("tabPrevious").checked;
			chrome.runtime.sendMessage({ delete: [e], previous: isPrev });
			row.remove();
			if (table.rows.length === 0) insertPlaceholder();
		});
	}
};

// ─── Rebuild stream URL list ───────────────────────────────────────────────

const createList = async () => {
	const urlStorageFilter = (await getStorage("filterInput"))?.toLowerCase();
	const urlStorageFull = await getStorage("urlStorage");
	const urlStorageRestore = await getStorage("urlStorageRestore");

	if (urlStorageFull !== null || urlStorageRestore !== null) {
		const urlStorage = urlStorageFull ?? [];
		const tab = await chrome.tabs.query({ active: true, currentWindow: true });

		if (document.getElementById("tabThis").checked) {
			urlList = tab?.[0]?.id
				? urlStorage.filter((url) => url.tabId === tab[0].id)
				: [];
		} else if (document.getElementById("tabAll").checked) {
			urlList = urlStorage.filter(
				(url) => url.tabData?.incognito === tab?.[0]?.incognito
			);
		} else if (document.getElementById("tabPrevious").checked) {
			urlList = urlStorageRestore ?? [];
		}

		urlList = urlList.length ? [...urlList].reverse() : [];

		if (urlStorageFilter) {
			urlList = urlList.filter(
				(url) =>
					url.filename.toLowerCase().includes(urlStorageFilter) ||
					url.tabData?.title?.toLowerCase().includes(urlStorageFilter) ||
					url.type.toLowerCase().includes(urlStorageFilter) ||
					url.hostname.toLowerCase().includes(urlStorageFilter)
			);
		}

		if (recentPref && urlList.length > recentAmount) {
			urlList.length = recentAmount;
		}

		table.innerHTML = "";
		urlList.length ? insertList(urlList) : insertPlaceholder();
	} else {
		table.innerHTML = "";
		insertPlaceholder();
	}
};

// ─── Cookie section ───────────────────────────────────────────────────────

/**
 * Read the currently selected format from the select element.
 */
function getSelectedFormat() {
	return document.getElementById("cookieFormat")?.value ?? DEFAULT_FORMAT;
}

/**
 * Update the cookie count badge in the toggle button header.
 */
function updateCookieCount(count) {
	const el = document.getElementById("cookieCount");
	if (!el) return;
	el.textContent = count >= 0 ? `(${count})` : "";
}

/**
 * Toggle the cookie panel open/closed.
 */
async function toggleCookiePanel() {
	cookiePanelOpen = !cookiePanelOpen;
	const panel = document.getElementById("cookiePanel");
	const icon = document.getElementById("cookieToggleIcon");
	const btn = document.getElementById("cookieToggle");

	if (!panel || !icon || !btn) return;

	panel.hidden = !cookiePanelOpen;
	icon.textContent = cookiePanelOpen ? "▼" : "▶";
	btn.setAttribute("aria-expanded", cookiePanelOpen.toString());

	// Load cookies when panel first opens
	if (cookiePanelOpen && currentTabUrl) {
		await refreshCookies();
	}
}

/**
 * Fetch cookies for the current tab and update the section state.
 * Called when the panel opens and when the tab changes.
 */
async function refreshCookies() {
	const formatKey = getSelectedFormat();
	const { cookies } = await getCookiesForPopup(currentTabUrl, formatKey);
	currentCookies = cookies;
	updateCookieCount(cookies.length);
}

/**
 * Load the current tab URL + hostname, then refresh cookie count.
 * Called on popup open and on tab/session switch.
 */
async function loadCookieSection() {
	const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
	const tab = tabs?.[0];

	if (!tab?.url || !tab.url.startsWith("http")) {
		currentTabUrl = "";
		currentHostname = "";
		updateCookieCount(-1);
		return;
	}

	currentTabUrl = tab.url;
	try {
		currentHostname = new URL(tab.url).hostname;
	} catch {
		currentHostname = "";
	}

	// Always update count (even when panel is closed) so the number is ready
	const { cookies } = await getCookiesForPopup(currentTabUrl, getSelectedFormat());
	currentCookies = cookies;
	updateCookieCount(cookies.length);
}

/**
 * Show the "Copied!" state on the copy button, then revert.
 */
function showCookieCopied() {
	const btn = document.getElementById("cookieCopy");
	if (!btn) return;
	const defaultLabel = btn.querySelector(".default-label");
	const copiedLabel = btn.querySelector(".copied-label");
	btn.classList.add("cookie-copied");
	if (defaultLabel) defaultLabel.hidden = true;
	if (copiedLabel) copiedLabel.hidden = false;
	if (cookieCopyTimer) clearTimeout(cookieCopyTimer);
	cookieCopyTimer = setTimeout(() => {
		btn.classList.remove("cookie-copied");
		if (defaultLabel) defaultLabel.hidden = false;
		if (copiedLabel) copiedLabel.hidden = true;
	}, 2000);
}

/**
 * Wire up all cookie section button handlers.
 */
function initCookieHandlers() {
	const toggleBtn = document.getElementById("cookieToggle");
	toggleBtn?.addEventListener("click", () => toggleCookiePanel());

	// Export — download with auto filename, no dialog
	document.getElementById("cookieExport")?.addEventListener("click", async () => {
		if (!currentTabUrl) return;
		const formatKey = getSelectedFormat();
		const { text } = await getCookiesForPopup(currentTabUrl, formatKey);
		if (!text) return;
		await saveCookiesFromPopup(text, currentHostname, formatKey, false);
	});

	// Export As — download with Save As dialog
	document.getElementById("cookieExportAs")?.addEventListener("click", async () => {
		if (!currentTabUrl) return;
		const formatKey = getSelectedFormat();
		const { text } = await getCookiesForPopup(currentTabUrl, formatKey);
		if (!text) return;
		await saveCookiesFromPopup(text, currentHostname, formatKey, true);
	});

	// Copy — write serialized cookies to clipboard
	document.getElementById("cookieCopy")?.addEventListener("click", async () => {
		if (!currentTabUrl) return;
		const formatKey = getSelectedFormat();
		const { text } = await getCookiesForPopup(currentTabUrl, formatKey);
		if (!text) return;
		try {
			await navigator.clipboard.writeText(text);
			showCookieCopied();
		} catch (err) {
			console.error("[primedl/popup] Cookie clipboard write failed:", err);
		}
	});

	// Export All — download ALL cookies in the browser
	document.getElementById("cookieExportAll")?.addEventListener("click", async () => {
		const formatKey = getSelectedFormat();
		const { text } = await getAllBrowserCookies(formatKey);
		if (!text) return;
		await saveCookiesFromPopup(text, "all_cookies", formatKey, false);
	});

	// Format change — persist selection and refresh count
	document.getElementById("cookieFormat")?.addEventListener("change", async (e) => {
		await setStorage({ cookieExportFormat: e.target.value });
		if (cookiePanelOpen) await refreshCookies();
	});
}

/**
 * Restore the previously selected cookie format from storage.
 */
async function restoreCookieFormat() {
	const saved = await getStorage("cookieExportFormat");
	const formatEl = document.getElementById("cookieFormat");
	if (!formatEl) return;
	if (saved && FORMAT_MAP[saved]) {
		formatEl.value = saved;
	}
}

// ─── Options / preference restore ─────────────────────────────────────────

const saveOption = (e) => {
	if (e.target.type === "radio") createList();
	saveOptionStorage(e, document.getElementsByClassName("option"));
};

const restoreOptions = async () => {
	titlePref = await getStorage("titlePref");
	_filenamePref = await getStorage("filenamePref");
	_timestampPref = await getStorage("timestampPref");
	downloadDirectPref = await getStorage("downloadDirectPref");
	newline = (await getStorage("newline")) ?? "\n";
	recentPref = await getStorage("recentPref");
	recentAmount = await getStorage("recentAmount");
	_noRestorePref = await getStorage("noRestorePref");

	const options = document.getElementsByClassName("option");
	for (const option of options) {
		option.onchange = (e) => saveOption(e);
		if ((await getStorage(option.id)) !== null) {
			if (option.type === "checkbox" || option.type === "radio") {
				option.checked = await getStorage(option.id);
			} else {
				option.value = await getStorage(option.id);
			}
		}
	}
};

// ─── Relay status indicator ────────────────────────────────────────────────

function updateRelayIndicator(status) {
	const el = document.getElementById("primedlStatus");
	if (!el) return;
	el.textContent = status === "connected" ? "● primedl connected" : "○ primedl offline";
	el.className = status === "connected" ? "relay-connected" : "relay-disconnected";
}

// ─── i18n ─────────────────────────────────────────────────────────────────

function applyI18n() {
	const labels = document.getElementsByTagName("label");
	for (const label of labels) {
		if (label.htmlFor) {
			const msg = _(label.htmlFor);
			if (msg) label.textContent = msg;
		}
	}

	const selectOptions = document.getElementsByTagName("option");
	for (const opt of selectOptions) {
		if (!opt.textContent) {
			const msg = _(opt.value);
			if (msg) opt.textContent = msg;
		}
	}
}

// ─── Boot ─────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
	// Stream detection badge reset + popup port
	if (document.body.id === "popup") {
		const browserAction = chrome.action ?? chrome.browserAction;
		browserAction.setBadgeBackgroundColor({ color: "silver" });
		browserAction.setBadgeText({ text: "" });
	}
	const _port = chrome.runtime.connect({ name: "popup" });

	await restoreOptions();
	await restoreCookieFormat();
	applyI18n();
	await createList();

	// Load cookie section data (count badge, current tab)
	await loadCookieSection();

	// Cookie section handlers
	initCookieHandlers();

	// Filter input
	const filterEl = document.getElementById("filterInput");
	if (filterEl) {
		filterEl.oninput = async (e) => {
			await setStorage({ filterInput: e.target.value.toLowerCase() });
			await createList();
		};
	}
	const clearFilterEl = document.getElementById("clearFilterInput");
	if (clearFilterEl) {
		clearFilterEl.onclick = async () => {
			if (filterEl) filterEl.value = "";
			await setStorage({ filterInput: "" });
			await createList();
		};
	}

	// Action buttons
	document.getElementById("copyAll")?.addEventListener("click", async () => {
		if (urlList.length) await copyURL(urlList);
	});

	document.getElementById("clearList")?.addEventListener("click", async () => {
		const isPrev = document.getElementById("tabPrevious").checked;
		chrome.runtime.sendMessage({ delete: urlList, previous: isPrev });
		table.innerHTML = "";
		urlList = [];
		insertPlaceholder();
	});

	document.getElementById("openOptions")?.addEventListener("click", () => {
		chrome.runtime.openOptionsPage();
	});

	document.getElementById("disablePref")?.addEventListener("change", async (e) => {
		saveOptionStorage(e);
	});

	// Hide "Previous sessions" tab if disabled in prefs
	if (_noRestorePref) {
		const prevTab = document.getElementById("tabPrevious");
		if (prevTab?.checked) document.getElementById("tabAll").checked = true;
		if (prevTab?.parentElement) prevTab.parentElement.style.display = "none";
	}

	// Message listener — live updates from background
	chrome.runtime.onMessage.addListener((message) => {
		if (message.urlStorage) createList();
		if (message.options) restoreOptions();
		if (message.primedlStatus) updateRelayIndicator(message.primedlStatus);
		if (message.primedlProgress) {
			console.log("[primedl] progress:", message.primedlProgress);
		}
	});
});