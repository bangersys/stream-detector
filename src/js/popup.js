/**
 * primedl — popup.js
 * Shared logic for popup.html and sidebar.html.
 *
 * Fixed from original:
 *   [1] Removed deprecated document.execCommand("copy") fallback
 *   [2] Added primedl relay connection status indicator
 *   [3] chrome.action compat shim
 */

import notifIcon from "../img/icon-dark-96.png";
import { getStorage, saveOptionStorage, setStorage } from "./components/storage.js";

// FIX [3]: MV3/MV2 action compat
const _browserAction = chrome.action ?? chrome.browserAction;
const isChrome = chrome.runtime.getURL("").startsWith("chrome-extension://");

const _ = chrome.i18n.getMessage;

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

// ─── Copy URL(s) to clipboard ─────────────────────────────────────────────
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
			const headerUserAgent =
				e.headers?.find((h) => h.name.toLowerCase() === "user-agent")?.value ?? navigator.userAgent;

			let headerCookieRaw = e.headers?.find(
				(h) => h.name.toLowerCase() === "cookie" || h.name.toLowerCase() === "set-cookie"
			)?.value;

			// Double quotes break shell commands — replace with single
			if (headerCookieRaw) {
				headerCookieRaw = headerCookieRaw.replace(/"/g, "'");
			}

			let headerReferer =
				e.headers?.find((h) => h.name.toLowerCase() === "referer")?.value ??
				(e.originUrl || e.documentUrl || e.initiator || e.tabData?.url);

			if (headerReferer?.startsWith("about:") || headerReferer?.startsWith("chrome:")) {
				headerReferer = undefined;
			}

			if (headerUserAgent) {
				if (fileMethod === "kodiUrl") code += `|User-Agent=${encodeURIComponent(headerUserAgent)}`;
				else if (fileMethod === "ffmpeg") code += ` -user_agent "${headerUserAgent}"`;
				else if (fileMethod === "streamlink") code += ` --http-header "User-Agent=${headerUserAgent}"`;
				else if (fileMethod === "ytdlp") code += ` --user-agent "${headerUserAgent}"`;
				else if (fileMethod === "hlsdl") code += ` -u "${headerUserAgent}"`;
				else if (fileMethod === "nm3u8dl") code += ` --header "User-Agent: ${headerUserAgent}"`;
				else if (fileMethod.startsWith("user")) code = code.replace(/%useragent%/g, headerUserAgent);
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
				// No cookie header captured — try to pull from browser
				code += isChrome ? " --cookies-from-browser chrome" : " --cookies-from-browser firefox";
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

	// ─── FIX [1]: clipboard — navigator.clipboard only, no execCommand ────
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

// ─── Build URL list table ──────────────────────────────────────────────────
const insertPlaceholder = () => {
	const row = table.insertRow();
	const cell = row.insertCell();
	cell.colSpan = 2;
	cell.textContent = _("placeholderCell");
};

const insertList = (urls) => {
	for (const e of urls) {
		const row = table.insertRow();
		const cellName = row.insertCell();
		const cellDel = row.insertCell();

		const contentSize = e.headers?.find((h) => h.name.toLowerCase() === "content-length")?.value;

		const source = titlePref && e.tabData?.title ? e.tabData.title : e.hostname;

		cellName.innerHTML = `
			<span class="urlSource">${source}</span>
			<span class="urlFilename">${e.filename}</span>
			<span class="urlInfo">
				${e.type}
				${contentSize ? ` · ${formatBytes(Number(contentSize))}` : ""}
				· ${getTimestamp(e.timeStamp)}
			</span>
		`;

		cellName.title = _("deleteTooltip");
		cellDel.textContent = "✖";

		// Click filename → copy URL
		cellName.addEventListener("click", async () => {
			if (downloadDirectPref && e.category !== "stream" && e.category !== "subtitles") {
				downloadURL(e);
			} else {
				await copyURL([e]);
			}
		});

		// Click X → delete
		cellDel.addEventListener("click", async () => {
			const isPrev = document.getElementById("tabPrevious").checked;
			chrome.runtime.sendMessage({ delete: [e], previous: isPrev });
			row.remove();
			if (table.rows.length === 0) insertPlaceholder();
		});
	}
};

// ─── Rebuild the URL list ──────────────────────────────────────────────────
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

// ─── Boot ─────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
	await restoreOptions();
	await createList();

	// Tell background the popup is open (for badge clear on close)
	const _port = chrome.runtime.connect({ name: "popup" });

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

	// Disable toggle
	document.getElementById("disablePref")?.addEventListener("change", async (e) => {
		saveOptionStorage(e);
	});

	// i18n labels
	const labels = document.getElementsByTagName("label");
	for (const label of labels) {
		if (label.htmlFor) label.textContent = _(label.htmlFor);
	}
	const selectOptions = document.getElementsByTagName("option");
	for (const opt of selectOptions) {
		if (!opt.textContent) opt.textContent = _(opt.value);
	}

	// Message listener — live updates from background
	chrome.runtime.onMessage.addListener((message) => {
		if (message.urlStorage) createList();
		if (message.options) restoreOptions();
		if (message.primedlStatus) updateRelayIndicator(message.primedlStatus);
		if (message.primedlProgress) {
			// TODO: show per-file progress in UI
			console.log("[primedl] progress:", message.primedlProgress);
		}
	});
});
