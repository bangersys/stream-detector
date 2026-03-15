/**
 * primedl — popup.js
 * Shared logic for popup.html and sidebar.html.
 *
 * Sections:
 *   1. Stream detection list (original stream-detector UI)
 *   2. Cookie export section (integrated from kairi003/Get-cookies.txt-LOCALLY)
 *   3. primedl relay status indicator
 *
 * Theme system is activated by importing theme.js below (side-effect only).
 * theme.js handles: data-theme attribute, tab active classes, stream type
 * attribute stamping, compact header injection, dashboard layout init,
 * and live storage change listening. No other changes to this file required.
 *
 * Coordination with theme.js:
 *   - updateCookieCount() dispatches "pd:cookiecount" for the compact header
 *   - DOMContentLoaded sets window.__pdPopupReady + dispatches "pd:popup-ready"
 *     so theme.js can safely trigger cookie panel open after all listeners
 *     are wired (fixes the dashboard cookiePanelOpen state desync)
 */

import notifIcon from "../img/icon-dark-96.png";
import { getStorage, saveOptionStorage, setStorage } from "./components/storage.js";
import {
	DEFAULT_FORMAT,
	getAllBrowserCookies,
	getCookiesForPopup,
	saveCookiesFromPopup
} from "./cookies/index.js";
// ─── Theme system (side-effect import — activates automatically) ──────────
import "./components/theme.js";

// ─── Browser detection ────────────────────────────────────────────────────
const isChrome = chrome.runtime.getURL("").startsWith("chrome-extension://");

const _ = chrome.i18n.getMessage;

// ─── Stream list state ────────────────────────────────────────────────────
const table = document.getElementById("popupUrlList");

let titlePref;
let downloadDirectPref;
let newline;
let recentPref;
let recentAmount;
let urlList = [];

// ─── Cookie section state ─────────────────────────────────────────────────
let cookiePanelOpen = false;
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
				url: file.url
			};

	chrome.downloads.download(dlOptions, (err) => {
		if (err === undefined) {
			chrome.notifications.create("error", {
				type: "basic",
				iconUrl: notifIcon,
				title: _("notifDownErrorTitle"),
				message: _("notifDownErrorText") + file.filename
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

		if (
			fileMethod.startsWith("user") &&
			(await getStorage(`userCommand${fileMethod.at(-1)}`)) === null
		) {
			fileMethod = "url";
			methodIncomp = true;
		}

		const streamURL = e.url;
		const { filename } = e;

		if (fileMethod === "url") {
			code = streamURL;
		} else if (fileMethod === "tableForm") {
			const source =
				titlePref && e.tabData?.title && !streamURL.includes(e.tabData.title)
					? e.tabData.title
					: e.hostname;
			code = [streamURL, filename, source, e.type].join("\t");
		} else if (fileMethod === "kodiUrl") {
			code = streamURL;
		} else {
			// Tool commands (ytdlp, ffmpeg, streamlink, hlsdl, nm3u8dl, user*)
			const headers = e.headers || [];
			const ua = headers.find((h) => h.name.toLowerCase() === "user-agent")?.value ?? "";
			const referer = headers.find((h) => h.name.toLowerCase() === "referer")?.value ?? "";
			const cookie = headers.find((h) => h.name.toLowerCase() === "cookie")?.value ?? "";
			const origin = headers.find((h) => h.name.toLowerCase() === "origin")?.value ?? "";
			const proxy = (await getStorage("proxyPref"))
				? `--proxy ${await getStorage("proxyCommand")}`
				: "";
			const tabTitle = e.tabData?.title ?? "";
			const timestamp = Date.now().toString();

			const headersPref = await getStorage("headersPref");
			const includeHeaders = headersPref !== false;

			const userCmd = fileMethod.startsWith("user")
				? (await getStorage(`userCommand${fileMethod.at(-1)}`)) || ""
				: "";

			if (fileMethod === "ytdlp") {
				const multithread = (await getStorage("multithreadPref"))
					? `--concurrent-fragments ${await getStorage("multithreadAmount")}`
					: "";
				const downloader = (await getStorage("downloaderPref"))
					? `--downloader ${await getStorage("downloaderCommand")}`
					: "";
				const customCmd = (await getStorage("customCommandPref"))
					? (await getStorage("customCommand")) || ""
					: "";
				const headerArgs = includeHeaders
					? [
							ua && `--add-header "User-Agent:${ua}"`,
							referer && `--add-header "Referer:${referer}"`,
							cookie && `--add-header "Cookie:${cookie}"`
						]
							.filter(Boolean)
							.join(" ")
					: "";
				code = ["yt-dlp", streamURL, headerArgs, multithread, downloader, proxy, customCmd]
					.filter(Boolean)
					.join(" ");
			} else if (fileMethod === "ffmpeg") {
				const headerArgs = includeHeaders
					? [
							ua && `-user_agent "${ua}"`,
							referer && `-referer "${referer}"`,
							cookie && `-headers "Cookie: ${cookie}"`
						]
							.filter(Boolean)
							.join(" ")
					: "";
				code = ["ffmpeg", headerArgs, `-i "${streamURL}"`, `-c copy "${filename}"`]
					.filter(Boolean)
					.join(" ");
			} else if (fileMethod === "streamlink") {
				const output =
					(await getStorage("streamlinkOutput")) === "file" ? `--output "${filename}"` : "--player vlc";
				const headerArgs = includeHeaders
					? [
							ua && `--http-header "User-Agent=${ua}"`,
							referer && `--http-header "Referer=${referer}"`,
							cookie && `--http-cookie "${cookie}"`
						]
							.filter(Boolean)
							.join(" ")
					: "";
				code = ["streamlink", streamURL, "best", output, headerArgs, proxy].filter(Boolean).join(" ");
			} else if (fileMethod === "hlsdl") {
				const headerArgs = includeHeaders
					? [ua && `-u "${ua}"`, referer && `-r "${referer}"`, cookie && `-c "${cookie}"`]
							.filter(Boolean)
							.join(" ")
					: "";
				code = ["hlsdl", streamURL, headerArgs, `-o "${filename}"`].filter(Boolean).join(" ");
			} else if (fileMethod === "nm3u8dl") {
				const headerArgs = includeHeaders
					? [
							ua && `--header "User-Agent:${ua}"`,
							referer && `--header "Referer:${referer}"`,
							cookie && `--header "Cookie:${cookie}"`
						]
							.filter(Boolean)
							.join(" ")
					: "";
				code = ["N_m3u8DL-RE", `"${streamURL}"`, headerArgs, `--save-name "${filename}"`]
					.filter(Boolean)
					.join(" ");
			} else if (fileMethod.startsWith("user") && userCmd) {
				code = userCmd
					.replace(/%url%/g, streamURL)
					.replace(/%filename%/g, filename)
					.replace(/%useragent%/g, ua)
					.replace(/%referer%/g, referer)
					.replace(/%cookie%/g, cookie)
					.replace(/%proxy%/g, proxy)
					.replace(/%origin%/g, origin)
					.replace(/%tabtitle%/g, tabTitle)
					.replace(/%timestamp%/g, timestamp);
			} else {
				code = streamURL;
				methodIncomp = true;
			}
		}

		// Regex substitution for user commands
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

	try {
		await navigator.clipboard.writeText(list.urls.join(newline));
		if ((await getStorage("notifPref")) === false) {
			chrome.notifications.create("copy", {
				type: "basic",
				iconUrl: notifIcon,
				title: _("notifCopiedTitle"),
				message:
					(list.methodIncomp ? _("notifIncompCopiedText") : _("notifCopiedText")) +
					list.filenames.join(newline)
			});
		}
	} catch (err) {
		console.error("[primedl/popup] Clipboard write failed:", err);
		chrome.notifications.create("error", {
			type: "basic",
			iconUrl: notifIcon,
			title: _("notifErrorTitle"),
			message: _("notifErrorText") + list.filenames.join(newline)
		});
	}
};

// ─── Stream list rendering ─────────────────────────────────────────────────

const insertPlaceholder = () => {
	const row = table.insertRow();
	const cell = row.insertCell();
	cell.colSpan = document.body.id === "popup" ? 6 : 2;
	cell.style.textAlign = "center";
	cell.style.padding = "1em";
	cell.style.opacity = "0.55";
	cell.textContent = _("placeholderCell");
};

const insertList = (urls) => {
	for (const e of urls) {
		const row = table.insertRow();
		row.className = "urlEntry";

		const contentSize = e.headers?.find((h) => h.name.toLowerCase() === "content-length")?.value;
		const source = titlePref && e.tabData?.title ? e.tabData.title : e.hostname;

		if (document.body.id === "popup") {
			// ── Popup: 6 cells — type | filename | size | source | timestamp | del

			const cellType = row.insertCell();
			cellType.className = "td-center";
			cellType.textContent = e.type;
			// data-stream-type enables CSS theme color-coding via theme.js observer
			cellType.dataset.streamType = e.type;

			const cellFilename = row.insertCell();
			cellFilename.className = "td-left";
			cellFilename.textContent = e.filename;
			cellFilename.title = e.filename;

			const cellSize = row.insertCell();
			cellSize.className = "td-center";
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

			const cellSource = row.insertCell();
			cellSource.className = "td-left";
			cellSource.textContent = source;
			cellSource.title = source;

			const cellTimestamp = row.insertCell();
			cellTimestamp.className = "td-left";
			cellTimestamp.textContent = getTimestamp(e.timeStamp);

			const cellDel = row.insertCell();
			cellDel.className = "td-center";
			cellDel.textContent = "✖";
			cellDel.title = _("deleteTooltip");
			cellDel.style.cursor = "pointer";
			cellDel.addEventListener("click", async (ev) => {
				ev.stopPropagation();
				const isPrev = document.getElementById("tabPrevious").checked;
				chrome.runtime.sendMessage({ delete: [e], previous: isPrev });
				row.remove();
				if (table.rows.length === 0) insertPlaceholder();
			});

			row.style.cursor = "pointer";
			row.addEventListener("click", async (ev) => {
				if (ev.target === cellDel) return;
				if (downloadDirectPref && e.category !== "stream" && e.category !== "subtitles") {
					downloadURL(e);
				} else {
					await copyURL([e]);
				}
			});
		} else {
			// ── Sidebar: 2 cells — stacked content | del
			const cellContent = row.insertCell();
			cellContent.style.cursor = "pointer";

			const spanSource = document.createElement("span");
			spanSource.className = "urlSource";
			spanSource.textContent = source;

			const spanFilename = document.createElement("span");
			spanFilename.className = "urlFilename";
			spanFilename.textContent = e.filename;

			const spanInfo = document.createElement("span");
			spanInfo.className = "urlInfo";
			spanInfo.textContent = `${e.type}${contentSize ? ` · ${formatBytes(Number(contentSize))}` : ""} · ${getTimestamp(e.timeStamp)}`;

			cellContent.append(spanSource, spanFilename, spanInfo);

			cellContent.addEventListener("click", async () => {
				if (downloadDirectPref && e.category !== "stream" && e.category !== "subtitles") {
					downloadURL(e);
				} else {
					await copyURL([e]);
				}
			});

			const cellDel = row.insertCell();
			cellDel.className = "td-center";
			cellDel.textContent = "✖";
			cellDel.title = _("deleteTooltip");
			cellDel.style.cursor = "pointer";
			cellDel.addEventListener("click", async (ev) => {
				ev.stopPropagation();
				const isPrev = document.getElementById("tabPrevious").checked;
				chrome.runtime.sendMessage({ delete: [e], previous: isPrev });
				row.remove();
				if (table.rows.length === 0) insertPlaceholder();
			});
		}
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
			urlList = tab?.[0]?.id ? urlStorage.filter((url) => url.tabId === tab[0].id) : [];
		} else if (document.getElementById("tabAll").checked) {
			urlList = urlStorage.filter((url) => url.tabData?.incognito === tab?.[0]?.incognito);
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

function getSelectedFormat() {
	return document.getElementById("cookieFormat")?.value ?? DEFAULT_FORMAT;
}

function updateCookieCount(count) {
	const el = document.getElementById("cookieCount");
	if (el) el.textContent = count >= 0 ? `(${count})` : "";

	// Notify compact theme header — theme.js listens for this event
	// to update the live cookie count pill in the compact header bar.
	document.dispatchEvent(new CustomEvent("pd:cookiecount", { detail: count >= 0 ? count : 0 }));
}

async function toggleCookiePanel() {
	cookiePanelOpen = !cookiePanelOpen;
	const panel = document.getElementById("cookiePanel");
	const icon = document.getElementById("cookieToggleIcon");
	const btn = document.getElementById("cookieToggle");

	if (!panel || !icon || !btn) return;

	panel.hidden = !cookiePanelOpen;
	icon.textContent = cookiePanelOpen ? "▼" : "▶";
	btn.setAttribute("aria-expanded", cookiePanelOpen.toString());

	if (cookiePanelOpen && currentTabUrl) {
		await refreshCookies();
	}
}

async function refreshCookies() {
	const formatKey = getSelectedFormat();
	const { cookies } = await getCookiesForPopup(currentTabUrl, formatKey);
	updateCookieCount(cookies.length);
}

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

	const { cookies } = await getCookiesForPopup(currentTabUrl, getSelectedFormat());
	updateCookieCount(cookies.length);
}

function showCookieCopied() {
	const btn = document.getElementById("cookieCopy");
	if (!btn) return;
	const defaultSpan = btn.querySelector(".copy-default");
	const doneSpan = btn.querySelector(".copy-done");
	btn.classList.add("cookie-copied");
	if (defaultSpan) defaultSpan.hidden = true;
	if (doneSpan) doneSpan.hidden = false;
	if (cookieCopyTimer) clearTimeout(cookieCopyTimer);
	cookieCopyTimer = setTimeout(() => {
		btn.classList.remove("cookie-copied");
		if (defaultSpan) defaultSpan.hidden = false;
		if (doneSpan) doneSpan.hidden = true;
	}, 2000);
}

function wireCookieButtons() {
	document.getElementById("cookieToggle")?.addEventListener("click", toggleCookiePanel);

	document.getElementById("cookieFormat")?.addEventListener("change", async () => {
		await saveOptionStorage(
			{ target: document.getElementById("cookieFormat") },
			document.getElementsByClassName("option")
		);
		if (cookiePanelOpen) await refreshCookies();
	});

	document.getElementById("cookieExport")?.addEventListener("click", async () => {
		const formatKey = getSelectedFormat();
		const { text } = await getCookiesForPopup(currentTabUrl, formatKey);
		if (text) await saveCookiesFromPopup(text, currentHostname, formatKey, false);
	});

	document.getElementById("cookieExportAs")?.addEventListener("click", async () => {
		const formatKey = getSelectedFormat();
		const { text } = await getCookiesForPopup(currentTabUrl, formatKey);
		if (text) await saveCookiesFromPopup(text, currentHostname, formatKey, true);
	});

	document.getElementById("cookieCopy")?.addEventListener("click", async () => {
		const formatKey = getSelectedFormat();
		const { text } = await getCookiesForPopup(currentTabUrl, formatKey);
		if (text) {
			await navigator.clipboard.writeText(text);
			showCookieCopied();
		}
	});

	document.getElementById("cookieExportAll")?.addEventListener("click", async () => {
		const formatKey = getSelectedFormat();
		const { text } = await getAllBrowserCookies(formatKey);
		if (text) await saveCookiesFromPopup(text, "all-cookies", formatKey, true);
	});
}

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

	const i18nEls = document.querySelectorAll("[data-i18n]");
	for (const el of i18nEls) {
		const key = el.getAttribute("data-i18n");
		if (key) {
			const msg = _(key);
			if (msg) el.textContent = msg;
		}
	}
}

// ─── saveOption ───────────────────────────────────────────────────────────

const saveOption = async (e) => {
	const el = e.target;
	if (!el.id) return;
	const val = el.type === "checkbox" || el.type === "radio" ? el.checked : el.value;
	await setStorage({ [el.id]: val });
};

// ─── initOptions ──────────────────────────────────────────────────────────

const initOptions = async () => {
	titlePref = await getStorage("titlePref");
	downloadDirectPref = await getStorage("downloadDirectPref");

	chrome.runtime.getPlatformInfo?.((info) => {
		newline = info?.os === "win" ? "\r\n" : "\n";
	});
	if (!newline) newline = "\n";

	recentPref = await getStorage("recentPref");
	recentAmount = await getStorage("recentAmount");

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

// ─── Boot ─────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
	// Reset badge + open popup port for badge clearing
	if (document.body.id === "popup") {
		const browserAction = chrome.action ?? chrome.browserAction;
		browserAction?.setBadgeText({ text: "" });

		if (isChrome) {
			try {
				chrome.runtime.connect({ name: "popup" });
			} catch (_) {}
		}
	}

	// Firefox sidebar action guard
	if (typeof chrome.sidebarAction !== "undefined" && document.body.id === "sidebar") {
		chrome.runtime.connect({ name: "sidebar" });
	}

	await initOptions();
	applyI18n();
	await createList();
	await loadCookieSection();
	wireCookieButtons();

	// Listen for relay status updates from background
	chrome.runtime.onMessage.addListener((message) => {
		if (message.urlStorage) createList();
		if (message.relayStatus !== undefined) updateRelayIndicator(message.relayStatus);
		if (message.options) {
			initOptions().then(() => createList());
		}
	});

	// ── FIX P3: signal theme.js that all event listeners are now wired ────
	// theme.js's initDashboard() listens for this to safely click the cookie
	// toggle (ensuring cookiePanelOpen state is managed by toggleCookiePanel).
	// window.__pdPopupReady guards against the race where this fires before
	// theme.js's IIFE has registered the pd:popup-ready listener.
	window.__pdPopupReady = true;
	document.dispatchEvent(new CustomEvent("pd:popup-ready"));
});
