/**
 * primedl — components/theme.js
 *
 * Pluggable theme engine. Side-effect import — activates automatically.
 *
 * Adding a new theme:
 *   1. Create src/css/themes/<name>.css with [data-theme="<name>"] overrides
 *   2. Add tokens to tokens.css [data-theme="<name>"] block
 *   3. Add <link> for the CSS in popup.html, sidebar.html, options.html
 *   4. Add <option> to the uiTheme select in options.html
 *   5. Add i18n key to all locale messages.json files
 *   6. If DOM injection needed, add a case in initThemeDOM() below
 */

import { getStorage } from "./storage.js";

const STORAGE_KEY = "uiTheme";
const LS_CACHE_KEY = "pd-theme";
const DEFAULT_THEME = "terminal";
const LAYOUT_THEMES = new Set(["compact", "dashboard"]);

// ─── Apply theme attribute ────────────────────────────────────────────────

async function applyTheme() {
	const theme = (await getStorage(STORAGE_KEY)) || DEFAULT_THEME;
	setThemeAttribute(theme);
	try {
		localStorage.setItem(LS_CACHE_KEY, theme);
	} catch (_) {}
	return theme;
}

function setThemeAttribute(theme) {
	document.documentElement.dataset.theme = theme || DEFAULT_THEME;
}

// ─── Tab active class (Firefox 89+ :has() workaround) ────────────────────

function initTabActiveClasses() {
	const tabRow = document.querySelector(".tab-row");
	if (!tabRow) return;
	const update = () => {
		tabRow.querySelectorAll(".tab-label").forEach((label) => {
			const radio = label.querySelector("input[type='radio']");
			label.classList.toggle("pd-tab-active", radio?.checked ?? false);
		});
	};
	tabRow.addEventListener("change", update);
	update();
}

// ─── data-stream-type stamping ────────────────────────────────────────────

function initStreamTypeObserver() {
	const tbody = document.getElementById("popupUrlList");
	if (!tbody) return;
	const stamp = (row) => {
		if (row.nodeType !== 1 || row.tagName !== "TR") return;
		const cell = row.querySelector("td:first-child");
		if (cell && !cell.dataset.streamType && cell.textContent.trim()) {
			cell.dataset.streamType = cell.textContent.trim();
		}
	};
	tbody.querySelectorAll("tr").forEach(stamp);
	new MutationObserver((muts) => {
		for (const m of muts) m.addedNodes.forEach(stamp);
	}).observe(tbody, { childList: true });
}

// ─── Compact theme: header injection ────────────────────────────────────

let compactStreamCount = 0;
let compactCookieCount = 0;

function injectCompactHeader() {
	if (document.getElementById("pd-compact-header")) return;
	const container = document.getElementById("container");
	if (!container) return;

	const header = document.createElement("div");
	header.id = "pd-compact-header";
	header.innerHTML = `<span id="pd-compact-site">—</span>
		<span id="pd-compact-counts">
			<span class="pd-compact-pill" id="pd-compact-streams">0 streams</span>
			<span class="pd-compact-pill" id="pd-compact-cookies">0 🍪</span>
		</span>`;
	container.insertBefore(header, container.firstChild);

	// Set site hostname
	chrome.tabs?.query({ active: true, currentWindow: true }, (tabs) => {
		const url = tabs?.[0]?.url;
		if (url) {
			try {
				const el = document.getElementById("pd-compact-site");
				if (el) el.textContent = new URL(url).hostname || "—";
			} catch (_) {}
		}
	});

	// Watch stream row count
	const tbody = document.getElementById("popupUrlList");
	if (tbody) {
		new MutationObserver(() => {
			compactStreamCount = tbody.querySelectorAll("tr.urlEntry").length;
			updateCompactCounts();
		}).observe(tbody, { childList: true });
	}

	// Cookie count from popup.js events
	document.addEventListener("pd:cookiecount", (e) => {
		compactCookieCount = e.detail ?? 0;
		updateCompactCounts();
	});
}

function updateCompactCounts() {
	const s = document.getElementById("pd-compact-streams");
	const c = document.getElementById("pd-compact-cookies");
	if (s) s.textContent = `${compactStreamCount} streams`;
	if (c) c.textContent = `${compactCookieCount} 🍪`;
}

// ─── Dashboard theme: always-open cookie panel ───────────────────────────

function initDashboard() {
	const open = () => {
		const panel = document.getElementById("cookiePanel");
		const btn = document.getElementById("cookieToggle");
		if (panel?.hidden) btn?.click();
		setupCookiePanelObserver();
	};
	if (window.__pdPopupReady) {
		open();
	} else {
		document.addEventListener("pd:popup-ready", open, { once: true });
	}
}

function setupCookiePanelObserver() {
	const panel = document.getElementById("cookiePanel");
	if (!panel) return;
	new MutationObserver(() => stampCookieFlagBadges()).observe(panel, {
		childList: true,
		subtree: true
	});
}

function stampCookieFlagBadges() {
	document.querySelectorAll("#cookiePanel tr").forEach((row) => {
		if (row.dataset.flagged) return;
		row.dataset.flagged = "1";
		const nameCell = row.querySelector("td:first-child");
		if (!nameCell) return;
		const isSecure = row.cells.length >= 4 && row.cells[3]?.textContent?.trim() === "TRUE";
		if (isSecure) {
			const badge = document.createElement("span");
			badge.className = "pd-flag-badge pd-flag-secure";
			badge.textContent = "secure";
			nameCell.appendChild(badge);
		}
	});
}

// ─── Storage change → live theme switching ───────────────────────────────

function initStorageListener() {
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area !== "local" || !changes[STORAGE_KEY]) return;
		const newTheme = changes[STORAGE_KEY].newValue || DEFAULT_THEME;
		setThemeAttribute(newTheme);
		try {
			localStorage.setItem(LS_CACHE_KEY, newTheme);
		} catch (_) {}
		if (LAYOUT_THEMES.has(newTheme)) initThemeDOM(newTheme);
	});
}

// ─── Per-theme DOM init ───────────────────────────────────────────────────

function initThemeDOM(theme) {
	switch (theme) {
		case "compact":
			injectCompactHeader();
			break;
		case "dashboard":
			initDashboard();
			break;
		default:
			break;
	}
}

// ─── Bootstrap ───────────────────────────────────────────────────────────

(async () => {
	const theme = await applyTheme();
	if (document.readyState === "loading") {
		await new Promise((res) => document.addEventListener("DOMContentLoaded", res, { once: true }));
	}
	initTabActiveClasses();
	initStreamTypeObserver();
	initStorageListener();
	initThemeDOM(theme);
})();

export { applyTheme };
